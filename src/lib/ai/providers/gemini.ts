import { ApiError, FinishReason, GoogleGenAI, type Content, type Part } from "@google/genai";

import {
  AiError,
  wait,
  type AiProvider,
  type AiSession,
  type ToolCall,
  type ToolSpec,
  type TurnHooks,
  type TurnInput,
  type TurnOutput,
} from "@/lib/ai/provider";

// Best first. Each model has its own allowance, so the later ones keep the app
// usable when a key's quota for the better ones is spent; the "lite" models are
// noticeably weaker and come last.
const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 65_536;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
/** Longest single pause while every model is rate limited or busy. */
const MAX_SINGLE_WAIT_MS = 75_000;
/** Longest a turn may spend waiting and retrying before it gives up. */
const MAX_TURN_WAIT_MS = 6 * 60 * 1000;
const MAX_ATTEMPTS = 14;
const BUSY_COOLDOWN_MS = 20_000;

function modelChain(): string[] {
  const configured = (process.env.GEMINI_MODELS ?? process.env.GEMINI_MODEL ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_MODELS;
}

function requestsPerMinute(): number {
  const configured = Number(process.env.GEMINI_RPM);
  // Free keys allow five requests a minute per model.
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5;
}

interface ModelState {
  /** Start times of recent requests, oldest first. */
  recent: number[];
  /** The model is rate limited, busy, or unavailable until this time. */
  blockedUntil: number;
  /** Why it is blocked, for the message shown if every model is out. */
  reason: string;
}

// Limits are per key, so the bookkeeping is shared by every conversation. It
// lives on globalThis so dev reloads don't forget what has been used.
const globalState = globalThis as typeof globalThis & {
  __clonerGeminiModels?: Map<string, ModelState>;
};
const modelStates = (globalState.__clonerGeminiModels ??= new Map<string, ModelState>());

function stateOf(model: string): ModelState {
  let state = modelStates.get(model);
  if (!state) {
    state = { recent: [], blockedUntil: 0, reason: "" };
    modelStates.set(model, state);
  }
  return state;
}

/** When the model may next be called without tripping its per-minute limit. */
function availableAt(model: string, now: number): number {
  const state = stateOf(model);
  const rpm = requestsPerMinute();
  state.recent = state.recent.filter((time) => now - time < 60_000);
  const paced = state.recent.length >= rpm ? state.recent[state.recent.length - rpm] + 60_500 : 0;
  return Math.max(state.blockedUntil, paced);
}

function block(model: string, milliseconds: number, reason: string): void {
  const state = stateOf(model);
  state.blockedUntil = Math.max(state.blockedUntil, Date.now() + milliseconds);
  state.reason = reason;
}

/** Reads "Please retry in 1h35m40.8s" or `"retryDelay": "31s"` from an error. */
function retryDelayMs(message: string): number | null {
  const sentence = /retry in (?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?/i.exec(message);
  if (sentence && (sentence[1] || sentence[2] || sentence[3])) {
    const seconds =
      Number(sentence[1] ?? 0) * 3600 + Number(sentence[2] ?? 0) * 60 + Number(sentence[3] ?? 0);
    if (seconds > 0) return Math.ceil(seconds * 1000);
  }
  const field = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(message);
  return field ? Math.ceil(Number(field[1]) * 1000) : null;
}

function describeWait(milliseconds: number): string {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 90 ? `${minutes} minutes` : `${Math.ceil(minutes / 60)} hours`;
}

const REFUSAL_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

const MALFORMED_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.MALFORMED_FUNCTION_CALL,
  FinishReason.UNEXPECTED_TOOL_CALL,
]);

/** Signals that the same request should simply be sent again. */
class RetryTurn extends Error {}

class GeminiSession implements AiSession {
  private readonly client: GoogleGenAI;
  private readonly system: string;
  private readonly tools: ToolSpec[];
  private readonly contents: Content[] = [];
  /** Ids the API gave its function calls; absent for calls it left unnamed. */
  private readonly apiCallIds = new Map<string, string | undefined>();
  private localIds = 0;

  constructor(client: GoogleGenAI, system: string, tools: ToolSpec[]) {
    this.client = client;
    this.system = system;
    this.tools = tools;
  }

  async send(input: TurnInput, hooks: TurnHooks): Promise<TurnOutput> {
    const userContent = this.toContent(input);
    const started = Date.now();
    let malformed = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (hooks.signal.aborted) throw new AiError("Stopped.");
      const model = await this.pickModel(hooks, started);
      stateOf(model).recent.push(Date.now());

      try {
        const { parts, finish, blocked, text } = await this.request(model, userContent, hooks);

        if (blocked || (finish && REFUSAL_REASONS.has(finish))) {
          return { text: "", toolCalls: [], stop: "refusal" };
        }
        if ((finish && MALFORMED_REASONS.has(finish)) || parts.length === 0) {
          malformed += 1;
          if (malformed > 3) {
            throw new AiError("The AI gave an answer that couldn't be used. Try again.");
          }
          throw new RetryTurn();
        }

        const toolCalls: ToolCall[] = [];
        for (const part of parts) {
          if (!part.functionCall?.name) continue;
          this.localIds += 1;
          const id = part.functionCall.id ?? `call-${this.localIds}`;
          this.apiCallIds.set(id, part.functionCall.id);
          toolCalls.push({ id, name: part.functionCall.name, input: part.functionCall.args ?? {} });
        }

        // The model's parts go back exactly as received: they carry thought
        // signatures the API requires on the next request.
        this.contents.push(userContent, { role: "model", parts });
        const stop =
          finish === FinishReason.MAX_TOKENS
            ? "max_tokens"
            : toolCalls.length > 0
              ? "tool_use"
              : "end";
        return { text, toolCalls, stop };
      } catch (error) {
        if (error instanceof AiError) throw error;
        if (hooks.signal.aborted) throw new AiError("Stopped.");
        if (error instanceof RetryTurn) {
          hooks.onStatus("The AI's answer was incomplete. Trying again");
          continue;
        }
        this.handleFailure(model, error);
        hooks.onStatus("The AI service is busy. Trying again");
      }
    }

    throw new AiError("The AI service kept failing. Try again in a few minutes.");
  }

  private async request(
    model: string,
    userContent: Content,
    hooks: TurnHooks,
  ): Promise<{ parts: Part[]; finish: FinishReason | undefined; blocked: boolean; text: string }> {
    const stream = await this.client.models.generateContentStream({
      model,
      contents: [...this.contents, userContent],
      config: {
        systemInstruction: this.system,
        tools:
          this.tools.length > 0
            ? [
                {
                  functionDeclarations: this.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parametersJsonSchema: tool.parameters,
                  })),
                },
              ]
            : undefined,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: hooks.signal,
        // Retries are handled here, where a different model can take over.
        httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
      },
    });

    const parts: Part[] = [];
    let finish: FinishReason | undefined;
    let blocked = false;
    let text = "";
    for await (const chunk of stream) {
      if (chunk.promptFeedback?.blockReason) blocked = true;
      const candidate = chunk.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        parts.push(part);
        if (part.text && !part.thought) {
          text += part.text;
          hooks.onText(part.text);
        }
      }
      if (candidate?.finishReason) finish = candidate.finishReason;
    }
    return { parts, finish, blocked, text };
  }

  /** Marks the model unavailable for a while, or throws if retrying can't help. */
  private handleFailure(model: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof ApiError) {
      const status = error.status;
      if (status === 429) {
        const delay = retryDelayMs(message);
        const notOnPlan = /limit:\s*0\b/.test(message);
        const daily = /PerDay/i.test(message) || (delay !== null && delay > 60 * 60 * 1000);
        console.warn(`Gemini: ${model} is rate limited (${notOnPlan ? "not on this key's plan" : daily ? "daily quota used up" : "per-minute limit"}).`);
        block(
          model,
          notOnPlan ? DAY_MS : Math.min((delay ?? 30_000) + 1000, DAY_MS),
          notOnPlan
            ? "is not included in this key's plan"
            : daily
              ? "has used up the key's quota for today"
              : "has reached its usage limit",
        );
        return;
      }
      if (status === 404) {
        block(model, 24 * 60 * 60 * 1000, "is not available for this key");
        return;
      }
      if (status === 408 || status >= 500) {
        console.warn(`Gemini: ${model} is busy (status ${status}).`);
        block(model, BUSY_COOLDOWN_MS, "is overloaded");
        return;
      }
      if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(message)) {
        throw new AiError(
          "The Gemini key was rejected. Check GEMINI_API_KEY in .env.local and restart the app.",
        );
      }
      console.error("Gemini request rejected:", status, message.slice(0, 600));
      throw new AiError("The AI service rejected the request.");
    }

    // Anything else is a dropped connection or a timeout.
    console.warn(`Gemini: ${model} could not be reached: ${message.slice(0, 200)}`);
    block(model, BUSY_COOLDOWN_MS, "could not be reached");
  }

  /** Returns a model that may be called now, waiting for one if necessary. */
  private async pickModel(hooks: TurnHooks, started: number): Promise<string> {
    const chain = modelChain();
    for (;;) {
      const now = Date.now();
      let soonest = chain[0];
      let soonestAt = Number.POSITIVE_INFINITY;
      for (const model of chain) {
        const at = availableAt(model, now);
        if (at <= now) return model;
        if (at < soonestAt) {
          soonestAt = at;
          soonest = model;
        }
      }

      const delay = soonestAt - now;
      if (delay > MAX_SINGLE_WAIT_MS || now + delay - started > MAX_TURN_WAIT_MS) {
        const reason = stateOf(soonest).reason || "has reached its usage limit";
        throw new AiError(
          `The AI can't be used right now: every Gemini model this key can use is unavailable (${soonest} ${reason}). Try again in about ${describeWait(delay)}.`,
        );
      }
      hooks.onStatus(`Waiting ${describeWait(delay)} for the AI's rate limit`);
      await wait(delay + 250, hooks.signal);
    }
  }

  private toContent(input: TurnInput): Content {
    if (input.kind === "user") {
      const parts: Part[] = (input.images ?? []).map((image) => ({
        inlineData: { mimeType: image.mediaType, data: image.data.toString("base64") },
      }));
      parts.push({ text: input.text });
      return { role: "user", parts };
    }
    return {
      role: "user",
      parts: input.results.map((result) => ({
        functionResponse: {
          id: this.apiCallIds.get(result.call.id),
          name: result.call.name,
          response: result.isError ? { error: result.content } : { output: result.content },
        },
      })),
    };
  }
}

export function createGeminiProvider(apiKey: string): AiProvider {
  const client = new GoogleGenAI({ apiKey });
  return {
    id: "gemini",
    label: "Gemini",
    supportsImages: true,
    startSession: ({ system, tools }) => new GeminiSession(client, system, tools),
  };
}
