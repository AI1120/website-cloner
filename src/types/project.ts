export interface CloneOptions {
  /** How many pages of the site to copy, starting from the entered URL. */
  maxPages: number;
  /** Keep the source site's JavaScript. Off gives a more reliable static copy. */
  keepScripts: boolean;
}

/** How a project was started. */
export type ProjectSource = "clone" | "prompt" | "image" | "figma" | "brand" | "template";

export type Framework = "react" | "html";

/** "original" means the styles of a cloned site, kept as they were. */
export type Styling = "tailwind" | "inline" | "original";

/** A ready-made component library included in a React project. */
export type UiLibrary = "none" | "shadcn";

export interface ProjectPage {
  /** Source URL the page was copied from, or "" for pages that were generated. */
  url: string;
  /**
   * Where the page is in the preview, relative to the site root: a file such
   * as "about.html", or a route of a React app such as "index.html#/about".
   */
  path: string;
  title: string;
}

export interface ProjectStats {
  assets: number;
  bytes: number;
}

export interface ProjectCheckpoint {
  id: string;
  createdAt: string;
  /** What produced this checkpoint, e.g. the prompt that was run. */
  label: string;
  /** Files that existed before the change and were modified or removed by it. */
  modified: string[];
  /** Files the change created. */
  created: string[];
}

export interface Project {
  id: string;
  name: string;
  source: ProjectSource;
  framework: Framework;
  styling: Styling;
  uiLibrary: UiLibrary;
  /** Name of the design system the project follows; its text is stored with the project. */
  designSystem: string | null;
  /** True while a first build is waiting to be started by the workspace. */
  pending: boolean;
  /** URL as entered by the user, or "" when the project was not started from a site. */
  url: string;
  /** URL after redirects. */
  finalUrl: string;
  host: string;
  createdAt: string;
  updatedAt: string;
  options: CloneOptions;
  stats: ProjectStats;
  /** Path of the first page, relative to the site folder. */
  entry: string;
  /** Path of the site's icon inside the site folder, if one was found. */
  icon: string | null;
  pages: ProjectPage[];
  warnings: string[];
  published: { publishedAt: string } | null;
  checkpoints: ProjectCheckpoint[];
}

export type CloneEvent =
  | { type: "start"; id: string }
  | { type: "status"; message: string }
  | {
      type: "progress";
      done: number;
      total: number;
      bytes: number;
    }
  | { type: "done"; project: Project }
  | { type: "error"; message: string };

export interface ProjectFile {
  path: string;
  size: number;
  /** True when the file can be opened in the code editor. */
  text: boolean;
}

export type ExportFormat = "html" | "react" | "vue" | "source";

/** A file the person attached to a message. */
export interface ChatAttachment {
  /** File name inside the project's uploads folder. */
  id: string;
  /** Name the person's file had. */
  name: string;
  kind: "image" | "text";
  mediaType: string;
  size: number;
}

/** An element the person picked in the preview to talk about. */
export interface SelectedElement {
  tag: string;
  id: string;
  classes: string[];
  /** Visible text, shortened. */
  text: string;
  /** "file:line:column" of the element in the source, when known. */
  loc: string | null;
  /** Indexes of the element among element children, from <body> down. */
  path: number[];
  /** The element's opening markup, shortened. */
  html: string;
}

/** One changed piece of text from editing in the preview. */
export interface TextEdit {
  loc: string | null;
  path: number[];
  /** Which of the element's own text nodes changed. */
  index: number;
  before: string;
  after: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  /** Short labels of the elements the message refers to. */
  elements?: string[];
  /** Files changed by this assistant turn. */
  changed?: string[];
  /** Checkpoint that undoes this assistant turn. */
  checkpointId?: string;
  error?: boolean;
}

export type ChatEvent =
  | { type: "user"; message: ChatMessage }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "status"; message: string }
  | { type: "done"; message: ChatMessage; project: Project }
  | { type: "error"; message: string; chatMessage?: ChatMessage; project?: Project };

export interface BuildMessage {
  text: string;
  file: string | null;
  line: number | null;
  column: number | null;
}

export interface FlowScreen {
  /** Preview path of the screen, e.g. "about.html" or "index.html#/about". */
  path: string;
  title: string;
  /** Source file that defines the screen, when known. */
  file: string | null;
}

export interface FlowLink {
  from: string;
  to: string;
}

export interface Flow {
  screens: FlowScreen[];
  links: FlowLink[];
}

export interface TemplateInfo {
  slug: string;
  name: string;
  description: string;
  framework: Framework;
  styling: Styling;
  entry: string;
}

/** What the start screen sends to create a project. */
export type StartMode = "prompt" | "clone" | "figma" | "brand" | "image";
