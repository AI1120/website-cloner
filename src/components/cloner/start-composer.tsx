"use client";

import {
  ArrowUp,
  ChevronDown,
  CircleAlert,
  Code,
  FileText,
  Frame,
  Globe,
  Image as ImageIcon,
  ListChecks,
  LoaderCircle,
  Mic,
  Palette,
  Plus,
  RefreshCw,
  SwatchBook,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";

import {
  AttachmentChips,
  IMAGE_ACCEPT,
  isImageFile,
  mergeFiles,
  TEXT_ACCEPT,
} from "@/components/cloner/attachment-chips";
import { CloneProgress } from "@/components/cloner/clone-progress";
import { DesignSystemDialog, type DesignChoice } from "@/components/cloner/design-system-dialog";
import { PageChooserDialog } from "@/components/cloner/page-chooser-dialog";
import { Segmented } from "@/components/cloner/segmented";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useCloneJob } from "@/hooks/use-clone-job";
import { useSpeech } from "@/hooks/use-speech";
import { plural } from "@/lib/format";
import { errorMessage } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import type { Framework, Project, StartMode, Styling, UiLibrary } from "@/types/project";

interface ModeInfo {
  mode: Exclude<StartMode, "prompt">;
  label: string;
  icon: LucideIcon;
}

const MODES: ModeInfo[] = [
  { mode: "figma", label: "Import Figma", icon: Frame },
  { mode: "clone", label: "Clone Website", icon: Globe },
  { mode: "brand", label: "Match a Brand", icon: Palette },
  { mode: "image", label: "Image to App", icon: ImageIcon },
];

const URL_PLACEHOLDER: Partial<Record<StartMode, string>> = {
  figma: "Paste your Figma link here",
  clone: "Paste your link here",
  brand: "Paste your brand URL here",
};

const PROMPT_PLACEHOLDER: Record<StartMode, string> = {
  prompt: "Describe what you want to build, or type / for commands",
  figma: "Anything to add or change? (optional)",
  clone: "Describe changes to make to the copy (optional)",
  brand: "What should be built in this brand's style?",
  image: "Anything to add or change? (optional)",
};

const SUGGESTIONS: Record<StartMode, string[]> = {
  prompt: [
    "A landing page for a neighbourhood coffee roaster with an online menu",
    "A portfolio for a product designer with three case studies",
    "A pricing page with monthly and yearly plans and an FAQ",
    "A waitlist page with an email sign-up that saves the entries",
    "A dashboard for tracking weekly running distance",
    "A recipe site with a searchable list and a page per recipe",
    "An event page for a small design conference with schedule and speakers",
    "A habit tracker with a weekly grid",
    "A changelog page for a software product",
  ],
  clone: [
    "Switch it to a dark theme",
    "Make every button fully rounded",
    "Translate the page into Spanish",
    "Remove the cookie banner",
    "Replace the logo text with “Northwind”",
  ],
  figma: [
    "Make it responsive down to phone width",
    "Add hover and focus states to every button",
    "Turn the card row into a swipeable row on phones",
  ],
  brand: [
    "A product launch page",
    "A newsletter sign-up page",
    "A pricing page with three plans",
    "An invitation page for a customer event",
  ],
  image: [
    "Match it closely and make it responsive",
    "Use it as a starting point, but with a dark theme",
    "Build only the top section",
  ],
};

const NO_IMAGES_NOTE =
  "The AI service in use can't read images, so Image to App isn't available with it. Describe the design in words instead.";

const PAGE_COUNTS = ["1", "5", "10", "25"] as const;
type PageCount = (typeof PAGE_COUNTS)[number];

const FRAMEWORK_LABEL: Record<Framework, string> = { react: "React", html: "HTML" };
const STYLING_LABEL: Record<Exclude<Styling, "original">, string> = {
  tailwind: "Tailwind CSS",
  inline: "Inline styles",
};

function pickSuggestions(mode: StartMode, exclude: string[] = []): string[] {
  const pool = SUGGESTIONS[mode];
  const fresh = pool.filter((item) => !exclude.includes(item));
  const source = fresh.length >= 3 ? fresh : pool;
  return [...source].sort(() => Math.random() - 0.5).slice(0, 3);
}

interface StartComposerProps {
  aiConfigured: boolean;
  figmaConfigured: boolean;
  /** False when the AI service in use can't look at images. */
  imagesSupported: boolean;
  /** True when the server has Chrome or Edge to load pages in before copying them. */
  browserAvailable: boolean;
  onCreated: (project: Project) => void;
}

/** The start screen's prompt box: every way of beginning a project. */
export function StartComposer({
  aiConfigured,
  figmaConfigured,
  imagesSupported,
  browserAvailable,
  onCreated,
}: StartComposerProps) {
  const router = useRouter();
  const { job, start: startClone, cancel: cancelClone, dismissError } = useCloneJob();

  const [mode, setMode] = useState<StartMode>("prompt");
  const [prompt, setPrompt] = useState("");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [framework, setFramework] = useState<Framework>("react");
  const [styling, setStyling] = useState<Exclude<Styling, "original">>("tailwind");
  const [uiLibrary, setUiLibrary] = useState<UiLibrary>("none");
  const [design, setDesign] = useState<DesignChoice>({ kind: "none" });
  const [designOpen, setDesignOpen] = useState(false);
  const [pageCount, setPageCount] = useState<PageCount>("1");
  const [chosenPages, setChosenPages] = useState<string[] | null>(null);
  const [chooserUrl, setChooserUrl] = useState<string | null>(null);
  const [keepScripts, setKeepScripts] = useState(false);
  const [renderPages, setRenderPages] = useState(true);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [snippet, setSnippet] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chosen on the client only: the server can't know what Math.random picks.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const keepScriptsId = useId();
  const renderPagesId = useId();

  const cloning = job.status === "running";
  const busy = creating || cloning;
  const needsAi = mode !== "clone";
  // The component library is built on Tailwind, so it is only offered with React and Tailwind.
  const libraryAvailable = framework === "react" && styling === "tailwind";
  const usesLibrary = libraryAvailable && uiLibrary === "shadcn";
  const commandsOpen = mode === "prompt" && prompt === "/";

  useEffect(() => {
    setSuggestions(pickSuggestions(mode));
  }, [mode]);

  const speech = useSpeech(
    useCallback((text: string) => {
      setPrompt((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
    }, []),
  );

  const addFiles = useCallback((added: File[]) => {
    if (added.length > 0) setFiles((current) => mergeFiles(current, added));
  }, []);

  const selectMode = useCallback(
    (next: StartMode) => {
      setMode(next);
      setError(null);
      dismissError();
      if (next === "image") {
        imageInputRef.current?.click();
      } else if (next === "prompt") {
        promptRef.current?.focus();
      } else {
        // The field appears with the mode; focus it once it exists.
        requestAnimationFrame(() => urlRef.current?.focus());
      }
    },
    [dismissError],
  );

  const commands = useMemo(
    () => [
      { label: "Attach an image", icon: ImageIcon, run: () => imageInputRef.current?.click() },
      { label: "Attach a text or Markdown file", icon: FileText, run: () => textInputRef.current?.click() },
      { label: "Paste a code snippet", icon: Code, run: () => setSnippetOpen(true) },
      ...MODES.map((item) => ({ label: item.label, icon: item.icon, run: () => selectMode(item.mode) })),
    ],
    [selectMode],
  );

  const runCommand = (index: number) => {
    setPrompt("");
    setCommandIndex(0);
    commands[index]?.run();
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setError(null);
    const text = prompt.trim();
    const address = url.trim();

    if (mode === "clone") {
      if (!address) {
        urlRef.current?.focus();
        return;
      }
      const project = await startClone(
        address,
        {
          maxPages: chosenPages ? chosenPages.length + 1 : Number(pageCount),
          keepScripts,
          renderPages: browserAvailable && renderPages && !keepScripts,
        },
        { pages: chosenPages ?? undefined, prompt: text },
      );
      if (!project) return;
      onCreated(project);
      router.push(`/projects/${project.id}`);
      return;
    }

    if (!aiConfigured) {
      setError("Building with AI needs an AI key. Cloning a website works without one.");
      return;
    }
    if ((mode === "figma" || mode === "brand") && !address) {
      urlRef.current?.focus();
      return;
    }
    if (mode === "image" && !imagesSupported) {
      setError(NO_IMAGES_NOTE);
      return;
    }
    if (mode === "image" && !files.some(isImageFile)) {
      imageInputRef.current?.click();
      return;
    }
    if (mode === "prompt" && !text && files.length === 0) {
      promptRef.current?.focus();
      return;
    }
    if (mode === "brand" && !text) {
      promptRef.current?.focus();
      setError("Describe what to build in this brand's style.");
      return;
    }

    const form = new FormData();
    form.set("mode", mode);
    form.set("prompt", text);
    form.set("framework", framework);
    form.set("styling", styling);
    if (usesLibrary) form.set("uiLibrary", "shadcn");
    if (address) form.set("url", address);
    if (design.kind === "preset") form.set("designSystem", design.id);
    if (design.kind === "custom") {
      form.set("designSystemName", design.name);
      form.set("designSystemContent", design.content);
    }
    for (const file of files) form.append("attachments", file);

    setCreating(true);
    try {
      const response = await fetch("/api/projects", { method: "POST", body: form });
      if (!response.ok) {
        setError(await errorMessage(response, "The project could not be created."));
        return;
      }
      const body = (await response.json()) as { project: Project };
      onCreated(body.project);
      router.push(`/projects/${body.project.id}`);
    } catch {
      setError("Couldn't reach the app. Is it still running?");
    } finally {
      setCreating(false);
    }
  };

  const shownError = error ?? (job.status === "error" ? job.message : null);
  const designLabel = design.kind === "none" ? "Design system" : design.name;

  return (
    <div className="w-full">
      <form
        onSubmit={submit}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className="relative rounded-2xl border bg-card p-2.5 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04),0_16px_48px_-16px_rgb(0_0_0/0.22)] focus-within:border-foreground/25"
      >
        {mode !== "prompt" && mode !== "image" && (
          <label className="mb-1 flex items-center gap-2.5 rounded-xl bg-muted/60 px-3">
            {mode === "figma" ? (
              <Frame className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="sr-only">{URL_PLACEHOLDER[mode]}</span>
            <input
              ref={urlRef}
              type="text"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={URL_PLACEHOLDER[mode]}
              value={url}
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value);
                setChosenPages(null);
                setError(null);
                dismissError();
              }}
              className="h-10 w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
          </label>
        )}

        <label htmlFor="start-prompt" className="sr-only">
          {PROMPT_PLACEHOLDER[mode]}
        </label>
        <textarea
          id="start-prompt"
          ref={promptRef}
          rows={mode === "prompt" ? 3 : 2}
          value={prompt}
          disabled={busy}
          placeholder={PROMPT_PLACEHOLDER[mode]}
          onChange={(event) => {
            setPrompt(event.target.value);
            setCommandIndex(0);
            setError(null);
          }}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length > 0) {
              event.preventDefault();
              addFiles(pasted);
            }
          }}
          onKeyDown={(event) => {
            if (commandsOpen) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setCommandIndex((index) => (index + step + commands.length) % commands.length);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                runCommand(commandIndex);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setPrompt("");
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          className="block max-h-60 min-h-16 w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />

        {commandsOpen && (
          <ul
            id="start-commands"
            role="listbox"
            aria-label="Commands"
            className="absolute top-14 left-3 z-20 w-72 rounded-xl bg-popover p-1 text-sm shadow-lg ring-1 ring-foreground/10"
          >
            {commands.map((command, index) => (
              <li key={command.label} role="option" aria-selected={index === commandIndex}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => runCommand(index)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left",
                    index === commandIndex && "bg-muted",
                  )}
                >
                  <command.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {command.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        <AttachmentChips
          files={files}
          onRemove={(file) => setFiles((current) => current.filter((item) => item !== file))}
          className="px-2 pt-1 pb-2"
        />

        {mode === "clone" && (
          <div className="mx-1 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-1.5 pt-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Pages</span>
              {chosenPages ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 font-medium">
                  {plural(chosenPages.length + 1, "page")} chosen
                  <button
                    type="button"
                    aria-label="Clear chosen pages"
                    onClick={() => setChosenPages(null)}
                    className="inline-flex size-4 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ) : (
                <Segmented
                  label="How many pages to copy"
                  value={pageCount}
                  onChange={setPageCount}
                  options={PAGE_COUNTS.map((count) => ({ value: count, label: count }))}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || !url.trim()}
                onClick={() => setChooserUrl(url.trim())}
              >
                <ListChecks data-icon="inline-start" />
                Choose pages
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto">
              {browserAvailable && (
                <div
                  className="flex items-center gap-2"
                  title={
                    keepScripts
                      ? "Pages that keep their JavaScript build themselves in the preview instead."
                      : "Opens each page in Chrome or Edge first, so content that scripts add is copied too."
                  }
                >
                  <Switch
                    id={renderPagesId}
                    checked={renderPages && !keepScripts}
                    onCheckedChange={setRenderPages}
                    disabled={busy || keepScripts}
                  />
                  <label
                    htmlFor={renderPagesId}
                    className={cn("text-muted-foreground", keepScripts && "opacity-50")}
                  >
                    Load in a browser
                  </label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch
                  id={keepScriptsId}
                  checked={keepScripts}
                  onCheckedChange={setKeepScripts}
                  disabled={busy}
                />
                <label htmlFor={keepScriptsId} className="text-muted-foreground">
                  Keep JavaScript
                </label>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
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
              render={<Button type="button" variant="outline" size="icon" aria-label="Attach" disabled={busy} />}
            >
              <Plus />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon />
                Image
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSnippetOpen(true)}>
                <Code />
                Code snippet
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => textInputRef.current?.click()}>
                <FileText />
                Markdown or text file
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {needsAi && (
            <>
              <Popover>
                <PopoverTrigger
                  render={<Button type="button" variant="outline" disabled={busy} />}
                  aria-label={`Framework and styling: ${FRAMEWORK_LABEL[framework]}, ${STYLING_LABEL[styling]}`}
                >
                  <span>{FRAMEWORK_LABEL[framework]}</span>
                  <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
                    ·
                  </span>
                  <span className="hidden sm:inline">
                    {STYLING_LABEL[styling]}
                    {usesLibrary ? " · shadcn/ui" : ""}
                  </span>
                  <ChevronDown data-icon="inline-end" />
                </PopoverTrigger>
                <PopoverContent className="w-auto space-y-3">
                  <div>
                    <p className="mb-1.5 text-xs text-muted-foreground">Framework</p>
                    <Segmented
                      label="Framework"
                      value={framework}
                      onChange={setFramework}
                      options={[
                        { value: "react", label: "React" },
                        { value: "html", label: "HTML" },
                      ]}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs text-muted-foreground">Styling</p>
                    <Segmented
                      label="Styling"
                      value={styling}
                      onChange={setStyling}
                      options={[
                        { value: "tailwind", label: "Tailwind CSS" },
                        { value: "inline", label: "Inline styles" },
                      ]}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs text-muted-foreground">Components</p>
                    {libraryAvailable ? (
                      <Segmented
                        label="Component library"
                        value={uiLibrary}
                        onChange={setUiLibrary}
                        options={[
                          { value: "none", label: "None" },
                          { value: "shadcn", label: "shadcn/ui" },
                        ]}
                      />
                    ) : (
                      <p className="max-w-56 text-xs text-muted-foreground">
                        shadcn/ui is available with React and Tailwind CSS.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                type="button"
                variant={design.kind === "none" ? "outline" : "secondary"}
                disabled={busy}
                onClick={() => setDesignOpen(true)}
                className="max-w-48"
              >
                <SwatchBook data-icon="inline-start" />
                <span className="truncate">{designLabel}</span>
              </Button>
            </>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {speech.supported && (
              <Button
                type="button"
                variant={speech.listening ? "secondary" : "outline"}
                size="icon"
                aria-label={speech.listening ? "Stop dictation" : "Dictate"}
                aria-pressed={speech.listening}
                title={speech.listening ? "Stop dictation" : "Dictate"}
                disabled={busy}
                onClick={speech.toggle}
              >
                <Mic className={cn(speech.listening && "animate-pulse text-brand")} />
              </Button>
            )}
            {cloning ? (
              <Button type="button" variant="outline" onClick={cancelClone}>
                <X data-icon="inline-start" />
                Cancel
              </Button>
            ) : (
              <Button type="submit" size="icon" aria-label="Start" disabled={creating}>
                {creating ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
              </Button>
            )}
          </div>
        </div>
      </form>

      <div className="mt-3.5 flex flex-wrap justify-center gap-2">
        {MODES.map(({ mode: item, label, icon: Icon }) => {
          const active = mode === item;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              disabled={busy}
              onClick={() => selectMode(active ? "prompt" : item)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "bg-background hover:bg-muted",
                mode !== "prompt" && !active && "opacity-60",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
              {active && (
                <X className="-mr-1 size-3.5 opacity-70" aria-label="(selected, click to clear)" />
              )}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="mx-auto mt-4 max-w-2xl empty:hidden">
        {cloning && <CloneProgress progress={job.progress} />}
        {creating && (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-brand" />
            Setting up your project
          </p>
        )}
        {shownError && !busy && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-left text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{shownError}</span>
          </div>
        )}
        {speech.error && !busy && (
          <p role="alert" className="text-center text-sm text-destructive">
            {speech.error}
          </p>
        )}
        {!busy && !shownError && needsAi && !aiConfigured && (
          <p className="text-center text-sm text-muted-foreground">
            Building with AI needs an AI key: add GEMINI_API_KEY to .env.local and restart the app.
            Cloning a website works without one.
          </p>
        )}
        {!busy && !shownError && mode === "image" && aiConfigured && !imagesSupported && (
          <p className="text-center text-sm text-muted-foreground">{NO_IMAGES_NOTE}</p>
        )}
        {!busy && !shownError && mode === "figma" && aiConfigured && !figmaConfigured && (
          <p className="text-center text-sm text-muted-foreground">
            Importing from Figma needs a Figma access token: add FIGMA_TOKEN to .env.local and
            restart the app.
          </p>
        )}
      </div>

      {suggestions.length > 0 && !busy && (
        <div className="mt-6">
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            Try these suggestions
            <button
              type="button"
              aria-label="Shuffle suggestions"
              title="Shuffle suggestions"
              onClick={() => setSuggestions((current) => pickSuggestions(mode, current))}
              className="inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </p>
          <ul className="mt-2 flex flex-wrap justify-center gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => {
                    setPrompt(suggestion);
                    promptRef.current?.focus();
                  }}
                  className="max-w-full rounded-full border bg-background px-3 py-1.5 text-left text-xs transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DesignSystemDialog
        open={designOpen}
        onOpenChange={setDesignOpen}
        value={design}
        onChange={setDesign}
      />

      <PageChooserDialog
        url={chooserUrl}
        initial={chosenPages ?? []}
        onClose={() => setChooserUrl(null)}
        onConfirm={(pages) => {
          setChosenPages(pages);
          setChooserUrl(null);
        }}
      />

      <Dialog open={snippetOpen} onOpenChange={setSnippetOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Paste a code snippet</DialogTitle>
            <DialogDescription>
              It is sent along with your request as reference material.
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Code snippet"
            value={snippet}
            onChange={(event) => setSnippet(event.target.value)}
            spellCheck={false}
            rows={12}
            className="min-h-40 w-full resize-y rounded-lg border bg-background p-3 font-mono text-[13px] leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnippetOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!snippet.trim()}
              onClick={() => {
                const count = files.filter((file) => file.name.startsWith("snippet")).length;
                addFiles([
                  new File([snippet], `snippet${count > 0 ? `-${count + 1}` : ""}.txt`, {
                    type: "text/plain",
                    lastModified: Date.now(),
                  }),
                ]);
                setSnippet("");
                setSnippetOpen(false);
              }}
            >
              Attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
