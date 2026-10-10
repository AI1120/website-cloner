import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { createGeminiProvider } from "@/lib/ai/providers/gemini";

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ImageInput {
  mediaType: string;
  data: Buffer;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  call: ToolCall;
  content: string;
  isError: boolean;
}

export type TurnInput =
  | { kind: "user"; text: string; images?: ImageInput[] }
  | { kind: "tool_results"; results: ToolResult[] };

export interface TurnOutput {
  text: string;
  toolCalls: ToolCall[];
  /** Why the model stopped: finished, wants tools run, ran out of room, or declined. */
  stop: "end" | "tool_use" | "max_tokens" | "refusal";
}

export interface TurnHooks {
  signal: AbortSignal;
  /** Visible answer text as it streams in. */
  onText: (delta: string) => void;
  /** Progress notes such as waiting on a rate limit. Earlier streamed text of the turn is void. */
  onStatus: (message: string) => void;
  /** True when another service is ready to take over, so a struggling one should give up early. */
  hasFallback?: boolean;
}

/**
 * One conversation with a model. `send` adds the input and the model's reply
 * to the conversation only when the reply arrived completely, so a failed
 * turn can be sent again.
 */
export interface AiSession {
  send(input: TurnInput, hooks: TurnHooks): Promise<TurnOutput>;
}

export interface AiProvider {
  id: "gemini" | "anthropic";
  /** Name shown to the person, e.g. "Gemini". */
  label: string;
  /** Whether the model can look at attached images. */
  supportsImages: boolean;
  startSession(options: { system: string; tools: ToolSpec[] }): AiSession;
}

/** A failure whose message is written for the person using the editor. */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

export function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AiError("Stopped."));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiError("Stopped."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function geminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function create(id: AiProvider["id"]): AiProvider | null {
  if (id === "gemini") {
    const key = geminiKey();
    return key ? createGeminiProvider(key) : null;
  }
  if (!anthropicConfigured()) return null;
  const provider = createAnthropicProvider();
  // Some Anthropic-compatible gateways accept images but never pass them to the model.
  return gatewayReadsImages() ? provider : { ...provider, supportsImages: false };
}

/** False when `CLONER_AI_IMAGES` says the Anthropic-compatible service drops images. */
function gatewayReadsImages(): boolean {
  const setting = (process.env.CLONER_AI_IMAGES ?? "").toLowerCase();
  return !["off", "0", "false", "no"].includes(setting);
}

function providerId(value: string | undefined): AiProvider["id"] | null {
  const name = (value ?? "").toLowerCase();
  return name === "gemini" || name === "anthropic" ? name : null;
}

/**
 * The main AI service: the one named in `CLONER_AI_PROVIDER`, otherwise Gemini if it
 * has a key, otherwise the Anthropic-compatible API.
 */
function getProvider(): AiProvider | null {
  const preferred = providerId(process.env.CLONER_AI_PROVIDER);
  if (preferred) return create(preferred);
  return create("gemini") ?? create("anthropic");
}

/**
 * The services to use for a request, in order: the main one, then the one named
 * in `CLONER_AI_FALLBACK`, which takes over when the main one can't finish.
 * A request with images goes first to a service that can read them.
 */
export function providersFor(needsImages: boolean): AiProvider[] {
  const main = getProvider();
  if (!main) return [];
  const fallbackId = providerId(process.env.CLONER_AI_FALLBACK);
  const fallback = fallbackId && fallbackId !== main.id ? create(fallbackId) : null;
  const providers = fallback ? [main, fallback] : [main];
  return needsImages
    ? [...providers].sort((a, b) => Number(b.supportsImages) - Number(a.supportsImages))
    : providers;
}

/** Whether a configured service can look at images the person attaches. */
export function aiReadsImages(): boolean {
  return providersFor(true).some((provider) => provider.supportsImages);
}
export const NO_IMAGES_HINT =
  "The AI service in use can't read images, so it can't work from a screenshot. Describe the design in words, or switch to a service that reads images.";

export function isAiConfigured(): boolean {
  return getProvider() !== null;
}

export const AI_SETUP_HINT =
  "The AI isn't set up. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY) to .env.local and restart the app.";
