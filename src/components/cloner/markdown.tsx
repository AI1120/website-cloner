import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * A small Markdown renderer for chat replies: paragraphs, headings, lists,
 * quotes, code, emphasis and links. It builds React elements, never HTML, so
 * nothing in a reply can inject markup. Links open only for http(s) and mailto.
 */

type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "code"; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "rule" }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", text: heading[1] });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const quoted = lines[i].match(QUOTE);
        body.push(quoted ? quoted[1] : lines[i]);
        i += 1;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(body) });
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      const parsed = parseList(lines, i);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    const body: string[] = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !startsBlock(lines[i]) &&
      !LIST_ITEM.test(lines[i])
    ) {
      body.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: body.join("\n") });
  }

  return blocks;
}

function parseList(lines: string[], from: number): { block: Block; next: number } {
  const first = lines[from].match(LIST_ITEM);
  if (!first) throw new Error("Not a list item");
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? Number.parseInt(first[2], 10) : 1;
  const items: Block[][] = [];
  let i = from;

  const siblingAt = (index: number): RegExpMatchArray | null => {
    const match = index < lines.length ? lines[index].match(LIST_ITEM) : null;
    if (!match || match[1].length > base + 1) return null;
    return /\d/.test(match[2]) === ordered ? match : null;
  };

  while (i < lines.length) {
    const match = siblingAt(i);
    if (!match) break;
    const contentIndent = match[1].length + match[2].length + 1;
    const body = [match[3]];
    i += 1;

    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        // A blank line stays inside the item only if indented content follows.
        let next = i + 1;
        while (next < lines.length && isBlank(lines[next])) next += 1;
        if (next < lines.length && indentOf(lines[next]) >= base + 2) {
          body.push("");
          i += 1;
          continue;
        }
        break;
      }
      const indent = indentOf(line);
      if (indent >= base + 2) {
        body.push(line.slice(Math.min(indent, contentIndent)));
      } else if (LIST_ITEM.test(line) || startsBlock(line)) {
        break;
      } else {
        // A wrapped line that continues the item's text.
        body.push(line.trim());
      }
      i += 1;
    }
    items.push(parseBlocks(body));

    // Blank lines between two items of the same list.
    let next = i;
    while (next < lines.length && isBlank(lines[next])) next += 1;
    if (next !== i && siblingAt(next)) i = next;
  }

  return { block: { type: "list", ordered, start, items }, next: i };
}

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;
const BARE_URL = /^https?:\/\/[^\s<>()]*[^\s<>().,:;!?'"]/;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>~|]/;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** Where an emphasis run opened at `from` closes, or -1. */
function closingDelimiter(text: string, from: number, delimiter: string): number {
  const open = from + delimiter.length;
  if (open >= text.length || /\s/.test(text[open])) return -1;
  // "_" only marks emphasis at word boundaries, so snake_case stays as it is.
  if (delimiter[0] === "_" && isWordChar(text[from - 1])) return -1;
  let index = text.indexOf(delimiter, open + 1);
  while (index !== -1) {
    const after = text[index + delimiter.length];
    const valid =
      !/\s/.test(text[index - 1]) &&
      !(delimiter.length === 1 && after === delimiter) &&
      !(delimiter[0] === "_" && isWordChar(after));
    if (valid) return index;
    index = text.indexOf(delimiter, index + 1);
  }
  return -1;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push(buffer);
    buffer = "";
  };
  const push = (node: ReactNode) => {
    flush();
    nodes.push(<Fragment key={nodes.length}>{node}</Fragment>);
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const rest = text.slice(i);

    if (char === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (char === "\n") {
      push(<br />);
      i += 1;
      continue;
    }

    if (char === "`") {
      const run = rest.match(/^`+/)?.[0] ?? "`";
      const close = text.indexOf(run, i + run.length);
      if (close !== -1) {
        push(
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {text.slice(i + run.length, close).trim()}
          </code>,
        );
        i = close + run.length;
      } else {
        buffer += run;
        i += run.length;
      }
      continue;
    }

    if (char === "*" || char === "_" || (char === "~" && text[i + 1] === "~")) {
      const delimiter = text[i + 1] === char ? char + char : char;
      const close = closingDelimiter(text, i, delimiter);
      if (close !== -1) {
        const inner = renderInline(text.slice(i + delimiter.length, close));
        if (char === "~") push(<del>{inner}</del>);
        else if (delimiter.length === 2) push(<strong className="font-semibold">{inner}</strong>);
        else push(<em>{inner}</em>);
        i = close + delimiter.length;
        continue;
      }
    }

    if (char === "[") {
      const link = rest.match(LINK);
      if (link) {
        const label = renderInline(link[1]);
        push(
          SAFE_HREF.test(link[2]) ? (
            <a href={link[2]} target="_blank" rel="noreferrer noopener" className="font-medium text-brand underline-offset-2 hover:underline">
              {label}
            </a>
          ) : (
            label
          ),
        );
        i += link[0].length;
        continue;
      }
    }

    if (char === "h" && !isWordChar(text[i - 1])) {
      const url = rest.match(BARE_URL)?.[0];
      if (url) {
        push(
          <a href={url} target="_blank" rel="noreferrer noopener" className="font-medium break-all text-brand underline-offset-2 hover:underline">
            {url}
          </a>,
        );
        i += url.length;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return nodes;
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.type) {
      case "paragraph":
        return <p key={index}>{renderInline(block.text)}</p>;
      case "heading":
        return (
          <p key={index} className="font-semibold">
            {renderInline(block.text)}
          </p>
        );
      case "code":
        return (
          <pre key={index} className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
            <code>{block.text}</code>
          </pre>
        );
      case "quote":
        return (
          <blockquote key={index} className="space-y-2 border-l-2 pl-3 text-muted-foreground">
            {renderBlocks(block.blocks)}
          </blockquote>
        );
      case "rule":
        return <hr key={index} className="border-border" />;
      case "list": {
        const List = block.ordered ? "ol" : "ul";
        return (
          <List
            key={index}
            start={block.ordered && block.start !== 1 ? block.start : undefined}
            className={cn(
              "space-y-1 pl-5 marker:text-muted-foreground",
              block.ordered ? "list-decimal" : "list-disc",
            )}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="pl-0.5 [&>*+*]:mt-1">
                {/* A one-paragraph item renders its text directly, as a tight list. */}
                {item.length === 1 && item[0].type === "paragraph"
                  ? renderInline(item[0].text)
                  : renderBlocks(item)}
              </li>
            ))}
          </List>
        );
      }
    }
  });
}

interface MarkdownProps {
  text: string;
  className?: string;
}

export function Markdown({ text, className }: MarkdownProps) {
  return (
    <div className={cn("space-y-2 break-words", className)}>
      {renderBlocks(parseBlocks(text.split(/\r\n|\r|\n/)))}
    </div>
  );
}
