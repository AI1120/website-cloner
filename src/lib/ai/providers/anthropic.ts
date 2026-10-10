import Anthropic from "@anthropic-ai/sdk";

import {
  AiError,
  wait,
  type AiProvider,
  type AiSession,
  type ToolSpec,
  type TurnHooks,
  type TurnInput,
  type TurnOutput,
} from "@/lib/ai/provider";

const MAX_TOKENS = 64_000;
// Gateways in front of the API can answer "busy" several times in a row before
// a request gets through, so a step is retried for a few minutes before giving up.
const MAX_RETRIES = 8;
/** With another service standing by, a few tries are enough. */
const RETRIES_WITH_FALLBACK = 3;
const RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 20_000, 30_000];
const TRANSIENT_ERROR_TYPES: ReadonlySet<string> = new Set([
  "api_error",
  "overloaded_error",
  "rate_limit_error",
  "timeout_error",
]);

function modelName(): string {
  return process.env.CLONER_AI_MODEL || "claude-opus-5-5";
}

/** True when the service was busy or unreachable, so sending the same step again can work. */
function isTransientFailure(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  if (error instanceof Anthropic.APIUserAbortError) return false;
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (error.status === undefined) {
    // Reported after the response had started streaming, where the SDK no longer retries.
    return error.type !== null && TRANSIENT_ERROR_TYPES.has(error.type);
  }
  return error.status === 429 || error.status >= 500;
}

function describeFailure(error: unknown): AiError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError(
      "The AI key was rejected. Check ANTHROPIC_API_KEY in .env.local and restart the app.",
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiError("This AI key doesn't have access to the model the editor uses.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiError(`The AI model "${modelName()}" is not available for this key.`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError("The AI service is rate limiting requests. Wait a moment and try again.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error("AI request rejected:", error.message);
    return new AiError("The AI service rejected the request.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError("Couldn't reach the AI service. Check the internet connection.");
  }
  if (error instanceof Anthropic.APIError) {
    console.error("AI request failed:", error.status, error.message);
    return new AiError("The AI service had a problem. Try again in a moment.");
  }
  if (error instanceof Anthropic.AnthropicError) {
    // Thrown by the SDK itself, e.g. when no credentials can be found.
    return new AiError(
      "The AI isn't set up. Add ANTHROPIC_API_KEY to .env.local and restart the app.",
    );
  }
  console.error("AI request failed:", error);
  return new AiError("Something went wrong while talking to the AI service.");
}

class AnthropicSession implements AiSession {
  private readonly client = new Anthropic();
  private readonly system: string;
  private readonly tools: Anthropic.Beta.BetaTool[];
  private readonly messages: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(system: string, tools: ToolSpec[]) {
    this.system = system;
    this.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Beta.BetaTool["input_schema"],
      // Large inputs (file contents) stream as they are written.
      eager_input_streaming: true,
    }));
  }

  async send(input: TurnInput, hooks: TurnHooks): Promise<TurnOutput> {
    const userMessage = this.toMessage(input);
    let retries = 0;
    let unparseable = 0;

    for (;;) {
      if (hooks.signal.aborted) throw new AiError("Stopped.");
      const pending = [...this.messages, userMessage];
      const stream = this.client.beta.messages.stream(
        {
          model: modelName(),
          max_tokens: MAX_TOKENS,
          // If a safety classifier declines the request, retry it on the
          // fallback model Anthropic recommends instead of failing the turn.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          // Caches the growing conversation so each loop step re-reads it cheaply.
          cache_control: { type: "ephemeral" },
          system: this.system,
          tools: this.tools,
          messages: pending,
        },
        { signal: hooks.signal },
      );

      let text = "";
      stream.on("text", (delta) => {
        text += delta;
        hooks.onText(delta);
      });

      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
      } catch (error) {
        if (hooks.signal.aborted) throw new AiError("Stopped.");
        // Nothing from a failed step has been applied, so a busy or
        // unreachable service is safe to retry.
        if (isTransientFailure(error) && retries < (hooks.hasFallback ? RETRIES_WITH_FALLBACK : MAX_RETRIES)) {
          const delay = RETRY_DELAYS_MS[Math.min(retries, RETRY_DELAYS_MS.length - 1)];
          retries += 1;
          hooks.onStatus("The AI service is busy. Trying again");
          await wait(delay, hooks.signal);
          continue;
        }
        // With eager input streaming, a tool input that isn't parseable JSON
        // rejects here. Re-issue that turn a couple of times; anything the API
        // itself reported is a real failure.
        if (error instanceof Anthropic.APIError || unparseable >= 2) throw describeFailure(error);
        unparseable += 1;
        hooks.onStatus("The AI's answer was incomplete. Trying again");
        continue;
      }

      const toolCalls = message.content
        .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use")
        .map((block) => ({ id: block.id, name: block.name, input: block.input }));

      this.messages.push(userMessage, { role: "assistant", content: message.content });
      const stop =
        message.stop_reason === "refusal"
          ? "refusal"
          : message.stop_reason === "max_tokens"
            ? "max_tokens"
            : toolCalls.length > 0
              ? "tool_use"
              : "end";
      return { text, toolCalls, stop };
    }
  }

  private toMessage(input: TurnInput): Anthropic.Beta.BetaMessageParam {
    if (input.kind === "user") {
      const content: Anthropic.Beta.BetaContentBlockParam[] = (input.images ?? []).map(
        (image) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: image.data.toString("base64"),
          },
        }),
      );
      content.push({ type: "text", text: input.text });
      return { role: "user", content };
    }
    return {
      role: "user",
      content: input.results.map((result) => ({
        type: "tool_result",
        tool_use_id: result.call.id,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      })),
    };
  }
}

export function createAnthropicProvider(): AiProvider {
  return {
    id: "anthropic",
    label: "Claude",
    supportsImages: true,
    startSession: ({ system, tools }) => new AnthropicSession(system, tools),
  };
}
