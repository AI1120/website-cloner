/**
 * Reads a newline-delimited JSON response body as it streams in, yielding one
 * parsed value per line.
 */
export async function* readNdjson<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as T;
        newline = buffer.indexOf("\n");
      }
    }
    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as T;
  } finally {
    reader.releaseLock();
  }
}

/** Extracts the `error` message from a failed JSON API response. */
export async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown } | null)?.error;
    return typeof message === "string" && message ? message : fallback;
  } catch {
    return fallback;
  }
}
