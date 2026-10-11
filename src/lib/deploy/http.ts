/**
 * Requests to the deploy services' APIs (fixed hosts, not addresses a person
 * typed, so they don't go through `safeFetch`). Every failure becomes a
 * `DeployError` with a message a person can act on.
 */

export class DeployError extends Error {}

const TIMEOUT_MS = 60_000;

export interface Service {
  name: string;
  /** The setting that holds its token, for messages. */
  setting: string;
}

async function reason(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const record = body as { message?: unknown; error?: { message?: unknown } | string; errors?: { message?: unknown }[] };
    const message =
      (typeof record.error === "object" && record.error?.message) ||
      (typeof record.error === "string" && record.error) ||
      record.message ||
      record.errors?.[0]?.message;
    return typeof message === "string" ? message.slice(0, 300) : `status ${response.status}`;
  } catch {
    return `status ${response.status}`;
  }
}

/** Calls a service's API and returns the response, which is always OK. */
export async function call(
  service: Service,
  url: string,
  init: RequestInit & { token: string },
  signal: AbortSignal,
): Promise<Response> {
  const { token, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: { authorization: `Bearer ${token}`, ...rest.headers },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
  } catch {
    if (signal.aborted) throw new DeployError("Stopped.");
    throw new DeployError(`Couldn't reach ${service.name}. Check this computer's internet connection and try again.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new DeployError(
      `${service.name} refused the token (${await reason(response)}). Check ${service.setting} in .env.local and restart the app.`,
    );
  }
  if (!response.ok) throw new DeployError(`${service.name} answered: ${await reason(response)}`);
  return response;
}

export async function callJson<T>(
  service: Service,
  url: string,
  init: RequestInit & { token: string },
  signal: AbortSignal,
): Promise<T> {
  return (await (await call(service, url, init, signal)).json()) as T;
}

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DeployError("Stopped."));
      },
      { once: true },
    );
  });
}
