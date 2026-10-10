import fs from "node:fs/promises";

import * as cheerio from "cheerio";
import type { Element } from "domhandler";

import { readAttachment } from "@/lib/ai/attachments";
import type { ToolSpec } from "@/lib/ai/provider";
import { TAILWIND_OUTPUT_FILE } from "@/lib/build";
import { ChangeRecorder, MAX_TEXT_FILE_BYTES } from "@/lib/cloner/checkpoints";
import { isTextFile } from "@/lib/cloner/mime";
import { listFiles, resolveInside, siteDir } from "@/lib/cloner/storage";
import { relativeFrom, slugify } from "@/lib/cloner/urls";
import { createTable, DataError } from "@/lib/data/store";
import type { ColumnType } from "@/types/data";
import type { ChatAttachment, Project } from "@/types/project";

const CUSTOM_STYLESHEET = "assets/css/custom.css";
const DEFAULT_READ_LENGTH = 12_000;
const MAX_READ_LENGTH = 30_000;
const MAX_SEARCH_MATCHES = 40;
const SEARCH_CONTEXT = 160;
const MAX_OUTLINE_CHARS = 14_000;

type JsonSchema = Record<string, unknown>;

function schema(
  properties: Record<string, unknown>,
  required: string[],
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * The tools the editing agent can use. They only ever touch text files inside
 * one project's site folder; there is no network or shell access.
 */
const TOOL_DEFINITIONS: ToolSpec[] = [
  {
    name: "list_files",
    description:
      "List the project's pages and other text files (CSS, JS, SVG) with their sizes, plus a count of binary assets such as images and fonts. Call this first if you don't know the project layout.",
    parameters: schema({}, []),
  },
  {
    name: "page_outline",
    description:
      "Get a compact structural outline of an HTML page: its stylesheets and the nesting of its main elements with tag, id, classes and a short text snippet. Use it to find which part of a large page to edit before reading or searching.",
    parameters: schema(
      { path: { type: "string", description: 'Page path, e.g. "index.html".' } },
      ["path"],
    ),
  },
  {
    name: "search_files",
    description:
      "Find text in the project's text files. Returns each match with its file, character offset and surrounding text. Case-insensitive. Use it to locate the exact markup or CSS rule to change.",
    parameters: schema(
      {
        query: { type: "string", description: "Literal text to find." },
        path: {
          type: "string",
          description: "Limit the search to one file. Omit to search every text file.",
        },
      },
      ["query"],
    ),
  },
  {
    name: "read_file",
    description: `Read part of a text file by character offset. Pages are often minified onto one long line, so reading is by characters, not lines. Returns up to ${MAX_READ_LENGTH} characters and the file's total length.`,
    parameters: schema(
      {
        path: { type: "string" },
        offset: { type: "integer", description: "Character offset to start at. Default 0." },
        length: {
          type: "integer",
          description: `How many characters to read. Default ${DEFAULT_READ_LENGTH}.`,
        },
      },
      ["path"],
    ),
  },
  {
    name: "replace_in_file",
    description:
      "Replace an exact piece of text in a file. `old_string` must match the file exactly, including whitespace, and must be unique unless `replace_all` is true. Use it for content, markup and targeted CSS edits.",
    parameters: schema(
      {
        path: { type: "string" },
        old_string: { type: "string", description: "Exact text to replace." },
        new_string: { type: "string", description: "Text to put in its place." },
        replace_all: {
          type: "boolean",
          description: "Replace every occurrence instead of requiring a unique match.",
        },
      },
      ["path", "old_string", "new_string"],
    ),
  },
  {
    name: "append_css",
    description: `Add CSS rules to the project's override stylesheet (${CUSTOM_STYLESHEET}), which is loaded last on every page. This is the preferred way to restyle the site: colors, fonts, spacing, sizes, hiding or repositioning elements. The stylesheet is created and linked from every page automatically.`,
    parameters: schema(
      { css: { type: "string", description: "One or more complete CSS rules." } },
      ["css"],
    ),
  },
  {
    name: "write_file",
    description:
      "Create a new text file or replace the whole content of a small one. Prefer replace_in_file for edits to existing pages; never rewrite a large page with this tool.",
    parameters: schema(
      {
        path: { type: "string", description: 'Path inside the project, e.g. "pricing.html".' },
        content: { type: "string" },
      },
      ["path", "content"],
    ),
  },
];

const SAVE_ATTACHMENT: ToolSpec = {
  name: "save_attachment",
  description:
    "Copy an image the person attached into the project so pages can show it. Returns the path to use in the page. Only needed for images that should appear in the result, not for screenshots given as a reference.",
  parameters: schema(
    {
      attachment_id: { type: "string", description: "The attachment id given with the request." },
      name: {
        type: "string",
        description: 'A short file name without extension, e.g. "team-photo".',
      },
    },
    ["attachment_id", "name"],
  ),
};

const DELETE_FILE: ToolSpec = {
  name: "delete_file",
  description: "Remove a file from the project, for example a component that is no longer used.",
  parameters: schema({ path: { type: "string" } }, ["path"]),
};

const CREATE_TABLE: ToolSpec = {
  name: "create_table",
  description:
    "Create a table in the project's database so the app can store data, such as form submissions. Afterwards the app adds rows with a POST to window.SC_DATA_URL + \"/<table>\". By default anyone using the app can add rows and only the project's owner can read them.",
  parameters: schema(
    {
      name: {
        type: "string",
        description: 'Lowercase letters, digits and underscores, e.g. "signups".',
      },
      columns: {
        type: "array",
        description: "The fields of a row. id and createdAt are added automatically.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Lowercase letters, digits and underscores." },
            type: { type: "string", enum: ["text", "number", "boolean", "date"] },
            required: { type: "boolean" },
          },
          required: ["name", "type"],
          additionalProperties: false,
        },
      },
      public_read: {
        type: "boolean",
        description:
          "Let the app read the rows back. Only for data that is meant to be public, such as a guestbook.",
      },
    },
    ["name", "columns"],
  ),
};

/** Tools for projects that are built rather than copied: plain file work. */
const BUILDER_TOOLS: ToolSpec[] = [
  {
    name: "list_files",
    description:
      "List the project's text files with their sizes, plus a count of binary assets. The first message already has this; call it only to check for changes.",
    parameters: schema({}, []),
  },
  {
    name: "read_file",
    description: `Read part of a text file by character offset. Returns up to ${MAX_READ_LENGTH} characters and the file's total length. The first message already contains the source files, so this is only needed for files that were left out or that you want to re-check.`,
    parameters: schema(
      {
        path: { type: "string" },
        offset: { type: "integer", description: "Character offset to start at. Default 0." },
        length: {
          type: "integer",
          description: `How many characters to read. Default ${DEFAULT_READ_LENGTH}.`,
        },
      },
      ["path"],
    ),
  },
  {
    name: "search_files",
    description:
      "Find text in the project's text files. Returns each match with its file, character offset and surrounding text. Case-insensitive.",
    parameters: schema(
      {
        query: { type: "string", description: "Literal text to find." },
        path: { type: "string", description: "Limit the search to one file." },
      },
      ["query"],
    ),
  },
  {
    name: "write_file",
    description:
      "Create a text file or replace one, with its complete content. Folders are created as needed. Use this to build the project: one call per file, several calls in one step.",
    parameters: schema(
      {
        path: { type: "string", description: 'Path inside the project, e.g. "src/components/Hero.jsx".' },
        content: { type: "string", description: "The whole file." },
      },
      ["path", "content"],
    ),
  },
  {
    name: "write_files",
    description:
      "Create or replace several text files in one call, each with its complete content. This is the fastest way to build: put every file of the app, or of one page, in a single call.",
    parameters: schema(
      {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: 'Path inside the project, e.g. "src/App.jsx".' },
              content: { type: "string", description: "The whole file." },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
      ["files"],
    ),
  },
  {
    name: "replace_in_file",
    description:
      "Replace an exact piece of text in a file. `old_string` must match the file exactly, including whitespace, and must be unique unless `replace_all` is true. Use it for small changes to an existing file.",
    parameters: schema(
      {
        path: { type: "string" },
        old_string: { type: "string", description: "Exact text to replace." },
        new_string: { type: "string", description: "Text to put in its place." },
        replace_all: {
          type: "boolean",
          description: "Replace every occurrence instead of requiring a unique match.",
        },
      },
      ["path", "old_string", "new_string"],
    ),
  },
  DELETE_FILE,
  CREATE_TABLE,
];

/** The tools offered for a project. */
export function toolsFor(project: Project, hasImages: boolean): ToolSpec[] {
  const tools = project.source === "clone" ? TOOL_DEFINITIONS : BUILDER_TOOLS;
  return hasImages ? [...tools, SAVE_ATTACHMENT] : tools;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
  /** Short description for the progress display, e.g. the file touched. */
  detail: string;
}

/** Thrown when the model's tool input is missing or mistyped fields. */
class InvalidToolInput extends Error {}

function ok(content: string, detail: string): ToolOutcome {
  return { content, isError: false, detail };
}

function fail(content: string, detail = ""): ToolOutcome {
  return { content, isError: true, detail };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InvalidToolInput("The tool input must be an object.");
  }
  return input as Record<string, unknown>;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new InvalidToolInput(`"${key}" is required and must be a string.`);
  }
  return value;
}

function optionalInteger(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidToolInput(`"${key}" must be a number.`);
  }
  return Math.max(0, Math.floor(value));
}

function cleanPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^(?:\.\/|\/)+/, "");
}

/** Runs the agent's tool calls against one project and records its changes. */
export class ProjectTools {
  private readonly project: Project;
  private readonly root: string;
  readonly recorder: ChangeRecorder;
  private readonly attachments: ChatAttachment[];

  constructor(project: Project, recorder: ChangeRecorder, attachments: ChatAttachment[] = []) {
    this.project = project;
    this.root = siteDir(project.id);
    this.recorder = recorder;
    this.attachments = attachments;
  }

  async run(name: string, input: unknown): Promise<ToolOutcome> {
    try {
      const args = asRecord(input);
      switch (name) {
        case "list_files":
          return await this.listFiles();
        case "page_outline":
          return await this.pageOutline(cleanPath(requireString(args, "path")));
        case "search_files": {
          const scope = typeof args.path === "string" ? cleanPath(args.path) : null;
          return await this.searchFiles(requireString(args, "query"), scope);
        }
        case "read_file":
          return await this.readFile(
            cleanPath(requireString(args, "path")),
            optionalInteger(args, "offset", 0),
            optionalInteger(args, "length", DEFAULT_READ_LENGTH),
          );
        case "replace_in_file":
          return await this.replaceInFile(
            cleanPath(requireString(args, "path")),
            requireString(args, "old_string"),
            requireString(args, "new_string"),
            args.replace_all === true,
          );
        case "append_css":
          return await this.appendCss(requireString(args, "css"));
        case "write_file":
          return await this.writeFile(
            cleanPath(requireString(args, "path")),
            requireString(args, "content"),
          );
        case "write_files":
          return await this.writeFiles(args);
        case "delete_file":
          return await this.deleteFile(cleanPath(requireString(args, "path")));
        case "save_attachment":
          return await this.saveAttachment(
            requireString(args, "attachment_id"),
            requireString(args, "name"),
          );
        case "create_table":
          return await this.createTable(args);
        default:
          return fail(`Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof InvalidToolInput) {
        // Same shape the API uses for input it could not parse, so the model retries.
        return fail(JSON.stringify({ INVALID_JSON: error.message }));
      }
      return fail(error instanceof Error ? error.message : "The tool failed.");
    }
  }

  private async readText(relativePath: string): Promise<string> {
    const target = resolveInside(this.root, relativePath);
    if (!target || target === this.root) {
      throw new Error(`"${relativePath}" is outside the project.`);
    }
    if (!isTextFile(relativePath)) {
      throw new Error(`"${relativePath}" is not a text file and can't be read or edited.`);
    }
    let size: number;
    try {
      const stats = await fs.stat(target);
      if (!stats.isFile()) throw new Error("not a file");
      size = stats.size;
    } catch {
      throw new Error(`"${relativePath}" does not exist. Use list_files to see what does.`);
    }
    if (size > MAX_TEXT_FILE_BYTES) {
      throw new Error(`"${relativePath}" is too large to open.`);
    }
    return fs.readFile(target, "utf8");
  }

  private async listFiles(): Promise<ToolOutcome> {
    const files = await listFiles(this.root);
    const pages = new Map(this.project.pages.map((page) => [page.path, page.title]));
    const lines: string[] = [];
    const binaryCounts = new Map<string, number>();

    for (const file of files) {
      if (file.text) {
        const title = pages.get(file.path);
        lines.push(`${file.path} (${file.size} bytes)${title ? ` - page: "${title}"` : ""}`);
      } else {
        const folder = file.path.includes("/")
          ? file.path.slice(0, file.path.lastIndexOf("/"))
          : ".";
        binaryCounts.set(folder, (binaryCounts.get(folder) ?? 0) + 1);
      }
    }
    for (const [folder, count] of binaryCounts) {
      lines.push(`${folder}/ - ${count} binary file${count === 1 ? "" : "s"} (images, fonts, media)`);
    }
    return ok(lines.join("\n") || "The project has no files.", "project files");
  }

  private async pageOutline(relativePath: string): Promise<ToolOutcome> {
    const html = await this.readText(relativePath);
    const $ = cheerio.load(html);
    const lines: string[] = [];

    const stylesheets = $('link[rel~="stylesheet"]')
      .map((_, element) => element.attribs.href)
      .get();
    lines.push(`title: ${$("title").first().text().trim() || "(none)"}`);
    lines.push(`stylesheets: ${stylesheets.join(", ") || "(none)"}`);
    lines.push(`inline <style> blocks: ${$("style").length}`);
    lines.push("", "body structure:");

    const SKIP = new Set(["script", "style", "noscript", "template", "svg", "path", "br"]);
    let budget = MAX_OUTLINE_CHARS;

    const describe = (element: Element, depth: number) => {
      if (budget <= 0 || SKIP.has(element.tagName)) return;
      const attrs = element.attribs;
      const id = attrs.id ? `#${attrs.id}` : "";
      const classes = (attrs.class ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .map((name) => `.${name}`)
        .join("");
      const children = element.children.filter(
        (child): child is Element => child.type === "tag",
      );
      const ownText = element.children
        .filter((child) => child.type === "text")
        .map((child) => ("data" in child ? String(child.data) : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const text = ownText ? ` "${ownText.slice(0, 60)}${ownText.length > 60 ? "…" : ""}"` : "";
      const line = `${"  ".repeat(depth)}<${element.tagName}${id}${classes}>${text}`;
      budget -= line.length + 1;
      lines.push(line);
      // Deep wrappers add little; stop descending once the outline is detailed enough.
      if (depth < 7) children.forEach((child) => describe(child, depth + 1));
    };

    $("body")
      .children()
      .each((_, element) => describe(element, 0));
    if (budget <= 0) lines.push("… (outline truncated; use search_files to go deeper)");

    return ok(lines.join("\n"), relativePath);
  }

  private async searchFiles(query: string, scope: string | null): Promise<ToolOutcome> {
    if (!query) return fail("The search text is empty.");
    const targets = scope
      ? [scope]
      : (await listFiles(this.root)).filter((file) => file.text).map((file) => file.path);
    const needle = query.toLowerCase();
    const results: string[] = [];
    let total = 0;

    for (const target of targets) {
      let text: string;
      try {
        text = await this.readText(target);
      } catch (error) {
        if (scope) throw error;
        continue;
      }
      const haystack = text.toLowerCase();
      let index = haystack.indexOf(needle);
      while (index !== -1) {
        total += 1;
        if (results.length < MAX_SEARCH_MATCHES) {
          const start = Math.max(0, index - SEARCH_CONTEXT);
          const end = Math.min(text.length, index + query.length + SEARCH_CONTEXT);
          results.push(
            `${target} @ ${index}:\n${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`,
          );
        }
        index = haystack.indexOf(needle, index + needle.length);
      }
    }

    if (total === 0) return ok(`No matches for "${query}".`, query);
    const header =
      total > results.length
        ? `${total} matches; showing the first ${results.length}.`
        : `${total} match${total === 1 ? "" : "es"}.`;
    return ok(`${header}\n\n${results.join("\n\n")}`, query);
  }

  private async readFile(
    relativePath: string,
    offset: number,
    length: number,
  ): Promise<ToolOutcome> {
    const text = await this.readText(relativePath);
    const size = Math.min(Math.max(1, length), MAX_READ_LENGTH);
    const slice = text.slice(offset, offset + size);
    const end = offset + slice.length;
    return ok(
      `${relativePath}: characters ${offset}-${end} of ${text.length}\n\n${slice}`,
      relativePath,
    );
  }

  private async replaceInFile(
    relativePath: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
  ): Promise<ToolOutcome> {
    if (!oldString) return fail("old_string is empty.", relativePath);
    if (oldString === newString) return fail("old_string and new_string are identical.", relativePath);

    const text = await this.readText(relativePath);
    const count = text.split(oldString).length - 1;
    if (count === 0) {
      return fail(
        "old_string was not found. It must match the file exactly; read or search the file to copy the exact text.",
        relativePath,
      );
    }
    if (count > 1 && !replaceAll) {
      return fail(
        `old_string matches ${count} places. Include more surrounding text to make it unique, or set replace_all to true.`,
        relativePath,
      );
    }

    const updated = replaceAll
      ? text.split(oldString).join(newString)
      : text.replace(oldString, () => newString);
    await this.recorder.write(relativePath, updated);
    return ok(`Replaced ${count} occurrence${count === 1 ? "" : "s"} in ${relativePath}.`, relativePath);
  }

  private async appendCss(css: string): Promise<ToolOutcome> {
    if (!css.trim()) return fail("The CSS is empty.", CUSTOM_STYLESHEET);

    let existing = "";
    try {
      existing = await this.readText(CUSTOM_STYLESHEET);
    } catch {
      existing = "/* Style overrides added in the editor. Loaded last on every page. */\n";
    }
    await this.recorder.write(CUSTOM_STYLESHEET, `${existing.trimEnd()}\n\n${css.trim()}\n`);

    // Make sure every page loads the override stylesheet, after its other styles.
    const linked: string[] = [];
    for (const page of this.project.pages) {
      let html: string;
      try {
        html = await this.readText(page.path);
      } catch {
        continue;
      }
      if (html.includes('data-cloner="custom-styles"')) continue;
      const href = relativeFrom(page.path, CUSTOM_STYLESHEET);
      const tag = `<link rel="stylesheet" href="${href}" data-cloner="custom-styles">`;
      const headEnd = html.toLowerCase().lastIndexOf("</head>");
      const updated =
        headEnd === -1 ? `${tag}\n${html}` : `${html.slice(0, headEnd)}${tag}${html.slice(headEnd)}`;
      await this.recorder.write(page.path, updated);
      linked.push(page.path);
    }

    return ok(
      `Added the rules to ${CUSTOM_STYLESHEET}.${linked.length > 0 ? ` Linked it from: ${linked.join(", ")}.` : ""}`,
      CUSTOM_STYLESHEET,
    );
  }

  private async writeFiles(args: Record<string, unknown>): Promise<ToolOutcome> {
    const files = Array.isArray(args.files) ? args.files : null;
    if (!files || files.length === 0) {
      throw new InvalidToolInput('"files" is required and must list at least one file.');
    }
    const written: string[] = [];
    const problems: string[] = [];
    for (const item of files) {
      const record = asRecord(item);
      const relativePath = cleanPath(requireString(record, "path"));
      // One bad path must not hide what happened to the other files.
      try {
        const outcome = await this.writeFile(relativePath, requireString(record, "content"));
        if (outcome.isError) problems.push(outcome.content);
        else written.push(relativePath);
      } catch (error) {
        if (error instanceof InvalidToolInput) throw error;
        problems.push(error instanceof Error ? error.message : `Could not write ${relativePath}.`);
      }
    }
    const summary = written.length > 0 ? `Wrote ${written.join(", ")}.` : "No files were written.";
    const detail =
      written.length === 1 ? written[0] : `${written.length} file${written.length === 1 ? "" : "s"}`;
    return problems.length > 0
      ? fail(`${summary} Problems: ${problems.join(" ")}`, detail)
      : ok(summary, detail);
  }

  private async deleteFile(relativePath: string): Promise<ToolOutcome> {
    if (!relativePath) return fail("The path is empty.");
    if (relativePath === this.project.entry) {
      return fail(`${relativePath} is the project's entry page and can't be deleted.`, relativePath);
    }
    const removed = await this.recorder.remove(relativePath);
    return removed
      ? ok(`Deleted ${relativePath}.`, relativePath)
      : fail(`"${relativePath}" does not exist.`, relativePath);
  }

  private async saveAttachment(attachmentId: string, name: string): Promise<ToolOutcome> {
    const attachment = this.attachments.find(
      (item) => item.id === attachmentId && item.kind === "image",
    );
    if (!attachment) {
      return fail("There is no attached image with that id. Use an id listed with the request.");
    }
    const data = await readAttachment(this.project.id, attachment);
    if (!data) return fail("That attachment could not be read.");

    const extension = attachment.id.slice(attachment.id.lastIndexOf(".") + 1);
    const fileName = `${slugify(name, 40) || "image"}.${extension}`;
    // React projects serve public/ from the site root; static sites keep images in assets/img.
    const stored =
      this.project.framework === "react" ? `public/images/${fileName}` : `assets/img/${fileName}`;
    const reference = this.project.framework === "react" ? `images/${fileName}` : stored;
    await this.recorder.write(stored, data);
    return ok(`Saved as ${stored}. Use it in pages as "${reference}".`, stored);
  }

  private async createTable(args: Record<string, unknown>): Promise<ToolOutcome> {
    const name = requireString(args, "name").trim();
    const columns = Array.isArray(args.columns) ? args.columns : null;
    if (!columns || columns.length === 0) {
      throw new InvalidToolInput('"columns" is required and must list at least one column.');
    }
    const types: ColumnType[] = ["text", "number", "boolean", "date"];
    const spec = columns.map((column) => {
      const record = asRecord(column);
      const type = types.find((candidate) => candidate === record.type) ?? "text";
      return { name: requireString(record, "name").trim(), type, required: record.required === true };
    });

    try {
      const table = await createTable(this.project.id, {
        name,
        columns: spec,
        access: { create: "everyone", read: args.public_read === true ? "everyone" : "owner" },
      });
      return ok(
        `Created table "${table.name}" with columns ${table.columns.map((column) => column.name).join(", ")}. Add rows with a POST to window.SC_DATA_URL + "/${table.name}".`,
        table.name,
      );
    } catch (error) {
      if (error instanceof DataError) return fail(error.message, name);
      throw error;
    }
  }

  private async writeFile(relativePath: string, content: string): Promise<ToolOutcome> {
    if (!relativePath) return fail("The path is empty.");
    if (relativePath === TAILWIND_OUTPUT_FILE && this.project.styling === "tailwind") {
      return fail(
        `${TAILWIND_OUTPUT_FILE} is generated automatically. Put design tokens and custom CSS in tailwind.config.css instead.`,
        relativePath,
      );
    }
    if (!isTextFile(relativePath)) {
      return fail(`Only text files can be written (got "${relativePath}").`, relativePath);
    }
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_BYTES) {
      return fail("The content is too large.", relativePath);
    }
    await this.recorder.write(relativePath, content);
    return ok(`Wrote ${relativePath} (${content.length} characters).`, relativePath);
  }
}
