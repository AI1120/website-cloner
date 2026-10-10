import type { ChatEvent } from "@/types/project";

/**
 * A request the AI is working on. It keeps running when the browser tab that
 * started it goes away, and any tab can attach to it and catch up.
 */
export interface Job {
  projectId: string;
  /** Everything emitted so far, for viewers that attach later. */
  events: ChatEvent[];
  listeners: Set<(event: ChatEvent) => void>;
  finished: boolean;
  abort: AbortController;
}

// Kept on globalThis so a dev reload doesn't lose track of running work.
const globalState = globalThis as typeof globalThis & { __clonerJobs?: Map<string, Job> };
const jobs = (globalState.__clonerJobs ??= new Map<string, Job>());

export function runningJob(projectId: string): Job | null {
  const job = jobs.get(projectId);
  return job && !job.finished ? job : null;
}

/**
 * Starts work for a project. `run` reports progress through `emit`; the job
 * ends when it resolves. Returns null if the project already has work running,
 * because two runs changing the same files would overwrite each other.
 */
export function startJob(
  projectId: string,
  run: (emit: (event: ChatEvent) => void, signal: AbortSignal) => Promise<void>,
): Job | null {
  if (runningJob(projectId)) return null;

  const job: Job = {
    projectId,
    events: [],
    listeners: new Set(),
    finished: false,
    abort: new AbortController(),
  };
  jobs.set(projectId, job);

  const emit = (event: ChatEvent) => {
    if (job.finished) return;
    const last = job.events.at(-1);
    if (event.type === "text" && last?.type === "text") {
      // Keep the replay short: streamed text is one growing entry.
      job.events[job.events.length - 1] = { type: "text", text: last.text + event.text };
    } else {
      job.events.push(event);
    }
    for (const listener of job.listeners) listener(event);
  };

  void run(emit, job.abort.signal)
    .catch((error: unknown) => {
      console.error("AI job failed unexpectedly:", error);
      emit({ type: "error", message: "Something went wrong while making the change." });
    })
    .finally(() => {
      job.finished = true;
      for (const listener of job.listeners) listener({ type: "status", message: "" });
      job.listeners.clear();
      if (jobs.get(projectId) === job) jobs.delete(projectId);
    });

  return job;
}

export function stopJob(projectId: string): boolean {
  const job = runningJob(projectId);
  if (!job) return false;
  job.abort.abort();
  return true;
}

/**
 * A response body that replays what a job has done so far and then follows it
 * live, as newline-delimited JSON. Closing the response does not stop the job.
 */
export function jobStream(job: Job): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let listener: ((event: ChatEvent) => void) | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        if (listener) job.listeners.delete(listener);
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      };
      const send = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
          if (listener) job.listeners.delete(listener);
          return;
        }
        if (event.type === "done" || event.type === "error") close();
      };

      for (const event of job.events) send(event);
      if (job.finished) {
        close();
        return;
      }
      listener = (event) => {
        // The job's end is announced with an empty status when it produced no result event.
        if (job.finished && event.type === "status" && event.message === "") close();
        else send(event);
      };
      job.listeners.add(listener);
    },
    cancel() {
      if (listener) job.listeners.delete(listener);
    },
  });
}

export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
} as const;
