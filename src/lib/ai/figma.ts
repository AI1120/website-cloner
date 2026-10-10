import type { ImageInput } from "@/lib/ai/provider";

const API = "https://api.figma.com/v1";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SUMMARY_CHARS = 30_000;
const TREE_DEPTH = 8;

/** A problem importing from Figma, worded for the person using the app. */
export class FigmaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigmaError";
  }
}

export interface FigmaReference {
  fileKey: string;
  /** Node id in the API's "1:2" form, or null for "the first frame of the file". */
  nodeId: string | null;
}

/** Reads the file key and node id out of a link copied from Figma. */
export function parseFigmaUrl(input: string): FigmaReference | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null;
  const match = /^\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,64})(?:\/|$)/.exec(url.pathname);
  if (!match) return null;
  const node = url.searchParams.get("node-id");
  return { fileKey: match[1], nodeId: node ? decodeURIComponent(node).replace(/-/g, ":") : null };
}

export function figmaToken(): string {
  return process.env.FIGMA_TOKEN || process.env.FIGMA_ACCESS_TOKEN || "";
}

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface FigmaPaint {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
}

interface FigmaNode {
  id: string;
  name?: string;
  type?: string;
  visible?: boolean;
  children?: FigmaNode[];
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  opacity?: number;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
  };
}

function hex(color: FigmaColor, opacity = 1): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  const alpha = (color.a ?? 1) * opacity;
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${alpha < 0.995 ? channel(alpha) : ""}`;
}

function solid(paints: FigmaPaint[] | undefined): string | null {
  const paint = paints?.find((item) => item.visible !== false && item.type === "SOLID" && item.color);
  return paint?.color ? hex(paint.color, paint.opacity ?? 1) : null;
}

function round(value: number | undefined): number {
  return Math.round((value ?? 0) * 10) / 10;
}

/** One line per layer: what it is, where it sits, and how it looks. */
function describeNode(node: FigmaNode, origin: { x: number; y: number }, depth: number, lines: string[]): void {
  if (node.visible === false) return;
  const box = node.absoluteBoundingBox;
  const parts: string[] = [`${"  ".repeat(depth)}${node.type ?? "NODE"} "${(node.name ?? "").slice(0, 60)}"`];
  if (box) {
    parts.push(`${round(box.width)}x${round(box.height)} at ${round(box.x - origin.x)},${round(box.y - origin.y)}`);
  }
  const fill = solid(node.fills);
  if (fill) parts.push(node.type === "TEXT" ? `color ${fill}` : `fill ${fill}`);
  const stroke = solid(node.strokes);
  if (stroke && node.strokeWeight) parts.push(`border ${round(node.strokeWeight)}px ${stroke}`);
  if (node.cornerRadius) parts.push(`radius ${round(node.cornerRadius)}`);
  if (node.opacity !== undefined && node.opacity < 1) parts.push(`opacity ${round(node.opacity)}`);
  if (node.layoutMode && node.layoutMode !== "NONE") {
    parts.push(
      `${node.layoutMode === "HORIZONTAL" ? "row" : "column"} gap ${round(node.itemSpacing)} padding ${round(node.paddingTop)}/${round(node.paddingRight)}/${round(node.paddingBottom)}/${round(node.paddingLeft)}`,
    );
  }
  if (node.type === "TEXT") {
    const style = node.style ?? {};
    parts.push(
      `font ${style.fontFamily ?? "?"} ${style.fontWeight ?? ""} ${round(style.fontSize)}px/${round(style.lineHeightPx)}px${style.textAlignHorizontal && style.textAlignHorizontal !== "LEFT" ? ` ${style.textAlignHorizontal.toLowerCase()}` : ""}`,
    );
    parts.push(`text ${JSON.stringify((node.characters ?? "").slice(0, 400))}`);
  }
  lines.push(parts.join(" | "));
  if (depth < TREE_DEPTH) {
    for (const child of node.children ?? []) describeNode(child, origin, depth + 1, lines);
  }
}

function firstFrame(document: FigmaNode): FigmaNode | null {
  for (const page of document.children ?? []) {
    const frame = (page.children ?? []).find(
      (node) => node.visible !== false && /^(?:FRAME|COMPONENT|SECTION|INSTANCE)$/.test(node.type ?? ""),
    );
    if (frame) return frame;
  }
  return null;
}

async function figmaJson<T>(pathname: string, token: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${pathname}`, { headers: { "X-Figma-Token": token }, signal });
  } catch {
    throw new FigmaError("Couldn't reach Figma. Check the internet connection.");
  }
  if (response.status === 403) {
    throw new FigmaError(
      "Figma refused the request. Check FIGMA_TOKEN in .env.local, and that its account can open this file.",
    );
  }
  if (response.status === 404) {
    throw new FigmaError("Figma couldn't find that file. Check the link and that the file is shared with you.");
  }
  if (response.status === 429) {
    throw new FigmaError("Figma is limiting requests for this token. Try again in a minute.");
  }
  if (!response.ok) throw new FigmaError(`Figma answered with an error (status ${response.status}).`);
  return (await response.json()) as T;
}

export interface FigmaDesign {
  name: string;
  /** The frame rendered as an image, for the model to look at. */
  image: ImageInput;
  /** The frame's layers as text: sizes, positions, colours, fonts and copy. */
  summary: string;
}

/**
 * Fetches a frame from Figma: a rendered image of it and a description of its
 * layers. Needs a personal access token in FIGMA_TOKEN.
 */
export async function fetchFigmaDesign(link: string, signal: AbortSignal): Promise<FigmaDesign> {
  const reference = parseFigmaUrl(link);
  if (!reference) {
    throw new FigmaError("That doesn't look like a Figma link. Copy the link to a frame from Figma.");
  }
  const token = figmaToken();
  if (!token) {
    throw new FigmaError(
      "Importing from Figma needs a Figma access token. Add FIGMA_TOKEN to .env.local and restart the app.",
    );
  }

  let frame: FigmaNode | null;
  if (reference.nodeId) {
    const body = await figmaJson<{ nodes?: Record<string, { document?: FigmaNode } | null> }>(
      `/files/${reference.fileKey}/nodes?ids=${encodeURIComponent(reference.nodeId)}&depth=${TREE_DEPTH}`,
      token,
      signal,
    );
    frame = body.nodes?.[reference.nodeId]?.document ?? null;
  } else {
    const body = await figmaJson<{ document?: FigmaNode }>(
      `/files/${reference.fileKey}?depth=${TREE_DEPTH}`,
      token,
      signal,
    );
    frame = body.document ? firstFrame(body.document) : null;
  }
  if (!frame) {
    throw new FigmaError("No frame was found at that link. Select a frame in Figma and copy its link.");
  }

  // Large frames are rendered smaller so the image stays a usable size.
  const width = frame.absoluteBoundingBox?.width ?? 1440;
  const scale = width > 2400 ? 0.5 : width > 1600 ? 0.75 : 1;
  const rendered = await figmaJson<{ images?: Record<string, string | null> }>(
    `/images/${reference.fileKey}?ids=${encodeURIComponent(frame.id)}&format=png&scale=${scale}`,
    token,
    signal,
  );
  const imageUrl = rendered.images?.[frame.id];
  if (!imageUrl) throw new FigmaError("Figma could not render that frame as an image.");

  let data: Buffer;
  try {
    const response = await fetch(imageUrl, { signal });
    if (!response.ok) throw new Error(`status ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new FigmaError("The image of the frame could not be downloaded from Figma.");
  }
  if (data.length > MAX_IMAGE_BYTES) {
    throw new FigmaError("That frame is too large to import. Try a smaller frame or one section of it.");
  }

  const lines: string[] = [];
  const box = frame.absoluteBoundingBox;
  describeNode(frame, { x: box?.x ?? 0, y: box?.y ?? 0 }, 0, lines);
  let summary = lines.join("\n");
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = `${summary.slice(0, MAX_SUMMARY_CHARS)}\n… (more layers omitted)`;
  }

  return {
    name: frame.name?.trim() || "Figma frame",
    image: { mediaType: "image/png", data },
    summary,
  };
}
