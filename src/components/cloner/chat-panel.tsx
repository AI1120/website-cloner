"use client";

import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  MousePointer2,
  Palette,
  Plus,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  AttachmentChips,
  IMAGE_ACCEPT,
  mergeFiles,
  TEXT_ACCEPT,
} from "@/components/cloner/attachment-chips";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSpeech } from "@/hooks/use-speech";
import { plural } from "@/lib/format";
import { errorMessage, readNdjson } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import type { ChatEvent, ChatMessage, Project, SelectedElement } from "@/types/project";

const EDIT_SUGGESTIONS = [
  "Change the main headline to “Built for small teams”",
  "Make every button fully rounded",
  "Add a section with three customer quotes",
  "Use a dark background with light text",
];

const TOOL_LABELS: Record<string, string> = {
  list_files: "Looking at the project files",
  page_outline: "Reading the page structure",
  search_files: "Searching for",
  read_file: "Reading",
  replace_in_file: "Editing",
  append_css: "Adding styles",
  write_file: "Writing",
  write_files: "Writing",
  delete_file: "Removing",
  create_table: "Creating the data table",
  save_attachment: "Adding the image",
  read_brand: "Reading the brand of",
  read_figma: "Fetching the design from Figma",
};

const DETAILED_TOOLS = new Set([
  "search_files",
  "read_file",
  "replace_in_file",
  "write_file",
  "write_files",
  "delete_file",
  "create_table",
  "read_brand",
]);

function describeStep(name: string, detail: string): string {
  const label = TOOL_LABELS[name] ?? "Working";
  return DETAILED_TOOLS.has(name) && detail ? `${label} ${detail}` : label;
}

function elementLabel(element: SelectedElement): string {
  const name = element.id ? `${element.tag}#${element.id}` : element.tag;
  return element.text ? `${name} · ${element.text.slice(0, 28)}` : name;
}

interface Activity {
  steps: string[];
  text: string;
}

export interface ChatRequest {
  /** Changes for every new request, so the same prompt can be sent twice. */
  id: number;
  prompt: string;
}

interface ChatPanelProps {
  project: Project;
  initialMessages: ChatMessage[];
  /** True when the AI was already working on the project as the page loaded. */
  initiallyRunning: boolean;
  aiConfigured: boolean;
  currentPage: string;
  /** Elements picked in the preview; they travel with the next message. */
  selection: SelectedElement[];
  onRemoveSelected: (index: number) => void;
  onClearSelection: () => void;
  /** A request raised elsewhere in the workspace, e.g. "Fix with AI". */
  request: ChatRequest | null;
  onProjectChange: (project: Project) => void;
  onRunningChange: (running: boolean) => void;
  onUndo: (checkpointId: string) => Promise<boolean>;
  className?: string;
}

export function ChatPanel({
  project,
  initialMessages,
  initiallyRunning,
  aiConfigured,
  currentPage,
  selection,
  onRemoveSelected,
  onClearSelection,
  request,
  onProjectChange,
  onRunningChange,
  onUndo,
  className,
}: ChatPanelProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [brandOpen, setBrandOpen] = useState(false);
  const [brandUrl, setBrandUrl] = useState("");
  const [activity, setActivity] = useState<Activity | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);
  const handledRequestRef = useRef(0);
  const running = activity !== null;
  // A request without an answer, and nothing running: the app stopped part-way.
  const interrupted = !running && !initiallyRunning && messages.at(-1)?.role === "user";
  const activeCheckpoints = new Set(project.checkpoints.map((checkpoint) => checkpoint.id));

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, activity]);

  useEffect(() => {
    onRunningChange(running);
  }, [onRunningChange, running]);

  const speech = useSpeech(
    useCallback((text: string) => {
      setPrompt((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
    }, []),
  );

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((current) =>
      current.some((item) => item.id === message.id) ? current : [...current, message],
    );
  }, []);

  const localError = useCallback(
    (text: string) =>
      addMessage({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "assistant",
        text,
        createdAt: new Date().toISOString(),
        error: true,
      }),
    [addMessage],
  );

  /** Shows the progress of a running request until it ends. */
  const follow = useCallback(
    async (response: Response) => {
      setActivity((current) => current ?? { steps: [], text: "" });
      let finished = false;
      try {
        for await (const event of readNdjson<ChatEvent>(response)) {
          if (event.type === "user") {
            addMessage(event.message);
          } else if (event.type === "text") {
            setActivity((current) =>
              current ? { ...current, text: current.text + event.text } : current,
            );
          } else if (event.type === "tool" || event.type === "status") {
            const step =
              event.type === "tool" ? describeStep(event.name, event.detail) : event.message;
            if (!step) continue;
            setActivity((current) =>
              // Narration belongs to the step before it; start fresh for the next one.
              current ? { steps: [...current.steps, step].slice(-4), text: "" } : current,
            );
          } else if (event.type === "done") {
            finished = true;
            addMessage(event.message);
            onProjectChange(event.project);
          } else if (event.type === "error") {
            finished = true;
            if (event.chatMessage) addMessage(event.chatMessage);
            else localError(event.message);
            if (event.project) onProjectChange(event.project);
          }
        }
        if (!finished) {
          // The connection dropped; the work itself carries on at the server.
          localError("Lost the connection to the app. Reload the page to see the result.");
        }
      } catch {
        localError("Lost the connection to the app. Reload the page to see the result.");
      } finally {
        setActivity(null);
      }
    },
    [addMessage, localError, onProjectChange],
  );

  /** Follows the request that is already running, if there is one. */
  const attach = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${project.id}/chat/events`);
      if (response.status === 200) await follow(response);
    } catch {
      // Nothing running, or the app is unreachable; the next action will say so.
    }
  }, [follow, project.id]);

  const send = useCallback(
    async (body: FormData) => {
      if (running) return;
      setActivity({ steps: [], text: "" });
      try {
        const response = await fetch(`/api/projects/${project.id}/chat`, { method: "POST", body });
        if (response.status === 409) {
          await attach();
          return;
        }
        if (!response.ok) {
          localError(await errorMessage(response, "The request could not be sent."));
          setActivity(null);
          return;
        }
        await follow(response);
      } catch {
        localError("Couldn't reach the app. Is it still running?");
        setActivity(null);
      }
    },
    [attach, follow, localError, project.id, running],
  );

  // A new project arrives with its first build waiting; a reload may find one in progress.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (initiallyRunning) {
      void attach();
    } else if (project.pending && aiConfigured) {
      const body = new FormData();
      body.set("start", "1");
      body.set("currentPage", currentPage);
      void send(body);
    }
    // Runs once for the project the workspace was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitText = useCallback(
    (text: string, attached: File[], elements: SelectedElement[]) => {
      const body = new FormData();
      body.set("prompt", text);
      body.set("currentPage", currentPage);
      if (elements.length > 0) body.set("elements", JSON.stringify(elements));
      for (const file of attached) body.append("attachments", file);
      void send(body);
    },
    [currentPage, send],
  );

  useEffect(() => {
    if (!request || request.id === handledRequestRef.current || running || !aiConfigured) return;
    handledRequestRef.current = request.id;
    submitText(request.prompt, [], []);
  }, [aiConfigured, request, running, submitText]);

  const submitPrompt = (event?: FormEvent) => {
    event?.preventDefault();
    const text = prompt.trim();
    if ((!text && files.length === 0) || running || !aiConfigured) return;
    submitText(text, files, selection);
    setPrompt("");
    setFiles([]);
    onClearSelection();
  };

  const submitBrand = (event: FormEvent) => {
    event.preventDefault();
    const url = brandUrl.trim();
    if (!url || running || !aiConfigured) return;
    setBrandUrl("");
    setBrandOpen(false);
    const body = new FormData();
    body.set("brandUrl", url);
    body.set("currentPage", currentPage);
    void send(body);
  };

  const stop = async () => {
    try {
      await fetch(`/api/projects/${project.id}/chat/stop`, { method: "POST" });
    } catch {
      // If the app is unreachable there is nothing left to stop.
    }
  };

  const addFiles = (added: File[]) => {
    if (added.length > 0) setFiles((current) => mergeFiles(current, added));
  };

  return (
    <section
      aria-label="Chat with the AI"
      className={cn("flex min-h-0 flex-col bg-background", className)}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-medium">Chat</h2>
        <Button
          variant={brandOpen ? "secondary" : "ghost"}
          size="sm"
          aria-expanded={brandOpen}
          onClick={() => setBrandOpen((open) => !open)}
          disabled={!aiConfigured}
        >
          <Palette data-icon="inline-start" />
          Match a brand
        </Button>
      </div>

      {brandOpen && (
        <form onSubmit={submitBrand} className="shrink-0 border-b bg-muted/40 p-3">
          <label htmlFor="brand-url" className="text-xs text-muted-foreground">
            Restyle this project with the colors, fonts and button shapes of another site.
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="brand-url"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://brand-to-match.com"
              value={brandUrl}
              onChange={(event) => setBrandUrl(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button type="submit" disabled={!brandUrl.trim() || running}>
              Apply
            </Button>
          </div>
        </form>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!aiConfigured && (
          <div className="rounded-xl border bg-muted/40 p-4 text-sm">
            <p className="font-medium">The AI needs a key</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-muted-foreground">
              <li>Create a free API key in Google AI Studio.</li>
              <li>
                In the project folder, create a file named{" "}
                <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">
                  .env.local
                </code>{" "}
                containing{" "}
                <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">
                  GEMINI_API_KEY=your-key
                </code>
                .
              </li>
              <li>Stop the app and start it again.</li>
            </ol>
            <p className="mt-3 text-muted-foreground">
              Until then you can still edit files by hand in the Code view.
            </p>
          </div>
        )}

        {aiConfigured && messages.length === 0 && !running && (
          <div>
            <p className="text-sm text-muted-foreground">
              Describe a change and the preview updates when it&apos;s done. For example:
            </p>
            <ul className="mt-3 space-y-2">
              {EDIT_SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => setPrompt(suggestion)}
                    className="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex flex-col items-end gap-1.5">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm break-words whitespace-pre-wrap text-primary-foreground">
                {message.text}
              </p>
              {(message.attachments?.length || message.elements?.length) && (
                <ul className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                  {message.attachments?.map((attachment) => (
                    <li
                      key={attachment.id}
                      className="inline-flex max-w-44 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {attachment.kind === "image" ? (
                        <ImageIcon className="size-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <FileText className="size-3 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{attachment.name}</span>
                    </li>
                  ))}
                  {message.elements?.map((label, index) => (
                    <li
                      key={`${index}-${label}`}
                      className="inline-flex max-w-44 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      <MousePointer2 className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div key={message.id} className="max-w-[92%]">
              <p
                className={cn(
                  "text-sm leading-relaxed break-words whitespace-pre-wrap",
                  message.error && "text-destructive",
                )}
              >
                {message.text}
              </p>
              {message.changed && message.changed.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span title={message.changed.join("\n")}>
                    {plural(message.changed.length, "file")} changed
                  </span>
                  {message.checkpointId &&
                    (activeCheckpoints.has(message.checkpointId) ? (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={running}
                        onClick={() => {
                          if (message.checkpointId) void onUndo(message.checkpointId);
                        }}
                      >
                        <Undo2 data-icon="inline-start" />
                        Undo
                      </Button>
                    ) : (
                      <span>· undone</span>
                    ))}
                </div>
              )}
            </div>
          ),
        )}

        {interrupted && (
          <p className="max-w-[92%] text-sm leading-relaxed text-muted-foreground">
            This request was interrupted before it finished, so the project may be half done. Send
            a message such as “continue” to pick it up.
          </p>
        )}

        {activity && (
          <div aria-live="polite" className="space-y-1.5 text-sm text-muted-foreground">
            {activity.steps.map((step, index) => (
              <p key={`${index}-${step}`} className="truncate opacity-70">
                {step}
              </p>
            ))}
            <p className="flex items-start gap-2 text-foreground">
              <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-brand" />
              <span className="break-words whitespace-pre-wrap">
                {activity.text || "Working on it…"}
              </span>
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={submitPrompt}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className="shrink-0 border-t p-3"
      >
        {selection.length > 0 && (
          <ul aria-label="Selected elements" className="mb-2 flex flex-wrap gap-1.5">
            {selection.map((element, index) => (
              <li
                key={`${index}-${element.loc ?? element.path.join(".")}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-brand/10 py-1 pr-1 pl-2 text-xs"
              >
                <MousePointer2 className="size-3 shrink-0 text-brand" aria-hidden="true" />
                <span className="truncate">{elementLabel(element)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${elementLabel(element)} from the selection`}
                  onClick={() => onRemoveSelected(index)}
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <AttachmentChips
          files={files}
          onRemove={(file) => setFiles((current) => current.filter((item) => item !== file))}
          className="mb-2"
        />

        <div className="rounded-xl border bg-background p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <label htmlFor="chat-prompt" className="sr-only">
            Describe a change
          </label>
          <textarea
            id="chat-prompt"
            rows={2}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onPaste={(event) => {
              const pasted = Array.from(event.clipboardData.files);
              if (pasted.length > 0) {
                event.preventDefault();
                addFiles(pasted);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitPrompt();
              }
            }}
            placeholder={
              !aiConfigured
                ? "Add an AI key to enable the chat"
                : selection.length > 0
                  ? "What should change about the selection?"
                  : "Describe a change…"
            }
            disabled={!aiConfigured}
            className="block max-h-40 min-h-10 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <div className="flex items-center gap-1">
            <input
              ref={imageInputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <input
              ref={textInputRef}
              type="file"
              accept={TEXT_ACCEPT}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Attach"
                    disabled={!aiConfigured}
                  />
                }
              >
                <Plus />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-52">
                <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                  <ImageIcon />
                  Image
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => textInputRef.current?.click()}>
                  <FileText />
                  Code, Markdown or text file
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {speech.supported && (
              <Button
                type="button"
                variant={speech.listening ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label={speech.listening ? "Stop dictation" : "Dictate"}
                aria-pressed={speech.listening}
                title={speech.listening ? "Stop dictation" : "Dictate"}
                disabled={!aiConfigured}
                onClick={speech.toggle}
              >
                <Mic className={cn(speech.listening && "animate-pulse text-brand")} />
              </Button>
            )}
            <span className="ml-auto" />
            {running ? (
              <Button type="button" size="icon" variant="outline" aria-label="Stop" onClick={stop}>
                <Square />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                aria-label="Send"
                disabled={!aiConfigured || (!prompt.trim() && files.length === 0)}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        {speech.error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {speech.error}
          </p>
        )}
      </form>
    </section>
  );
}
