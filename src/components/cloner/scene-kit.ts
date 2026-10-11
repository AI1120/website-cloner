import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";

/**
 * Shared pieces of the app's three.js scenes: miniature web pages drawn on a
 * canvas from the theme's colours (finished, or as a dashed blueprint), the
 * shader that rebuilds a blueprint into its page behind a scan line, and a
 * "stage" that owns the renderer and everything a scene needs to behave well
 * (resizing, pausing off screen and in background tabs, reduced motion,
 * pointer parallax, lost WebGL contexts and clean disposal).
 *
 * Loaded on demand with three.js; nothing here runs on the server.
 */

// ---------------------------------------------------------------------------
// Page textures
// ---------------------------------------------------------------------------

/** Card size in texture pixels, and the transparent margin kept for its shadow. */
export const CARD_WIDTH = 640;
export const CARD_HEIGHT = 440;
export const MARGIN = 44;
export const CANVAS_WIDTH = CARD_WIDTH + MARGIN * 2;
export const CANVAS_HEIGHT = CARD_HEIGHT + MARGIN * 2;
const CHROME_HEIGHT = 34;

type Kind = "text" | "heading" | "block" | "panel" | "button" | "image" | "bar";

/** One element of a page, in fractions of the area below the browser bar. */
export type Shape = [kind: Kind, x: number, y: number, w: number, h: number];

function repeat(count: number, make: (index: number) => Shape): Shape[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

/** A few common page types, roughly sketched. */
export const LAYOUTS: Shape[][] = [
  // Landing page: nav, headline and call to action, hero image, logo row.
  [
    ["button", 0.05, 0.05, 0.07, 0.05],
    ...repeat(3, (i): Shape => ["text", 0.52 + i * 0.1, 0.065, 0.07, 0.025]),
    ["button", 0.84, 0.045, 0.11, 0.06],
    ["heading", 0.06, 0.22, 0.42, 0.065],
    ["heading", 0.06, 0.31, 0.32, 0.065],
    ["text", 0.06, 0.43, 0.38, 0.025],
    ["text", 0.06, 0.48, 0.3, 0.025],
    ["button", 0.06, 0.58, 0.15, 0.075],
    ["panel", 0.23, 0.58, 0.13, 0.075],
    ["image", 0.54, 0.19, 0.4, 0.5],
    ...repeat(5, (i): Shape => ["text", 0.08 + i * 0.18, 0.84, 0.1, 0.03]),
  ],
  // Pricing: three plans, the middle one highlighted.
  [
    ["heading", 0.3, 0.09, 0.4, 0.065],
    ["text", 0.35, 0.2, 0.3, 0.025],
    ...[0.06, 0.37, 0.68].flatMap((x, i): Shape[] => [
      [i === 1 ? "block" : "panel", x, 0.3, 0.26, 0.62],
      ["text", x + 0.03, 0.35, 0.1, 0.025],
      ["heading", x + 0.03, 0.42, 0.13, 0.07],
      ...repeat(3, (row): Shape => ["text", x + 0.03, 0.56 + row * 0.07, 0.18 - row * 0.03, 0.022]),
      [i === 1 ? "button" : "panel", x + 0.03, 0.81, 0.2, 0.07],
    ]),
  ],
  // Article: banner image, title, paragraphs.
  [
    ["image", 0.06, 0.06, 0.88, 0.34],
    ["heading", 0.06, 0.47, 0.62, 0.065],
    ["text", 0.06, 0.58, 0.2, 0.025],
    ...repeat(5, (i): Shape => ["text", 0.06, 0.67 + i * 0.06, i === 4 ? 0.5 : 0.86 - (i % 2) * 0.08, 0.025]),
  ],
  // Dashboard: sidebar, three figures, bar chart.
  [
    ["block", 0, 0, 0.2, 1],
    ...repeat(5, (i): Shape => ["text", 0.04, 0.08 + i * 0.09, 0.12, 0.025]),
    ...[0.25, 0.49, 0.73].flatMap((x): Shape[] => [
      ["panel", x, 0.07, 0.21, 0.2],
      ["text", x + 0.025, 0.11, 0.09, 0.022],
      ["heading", x + 0.025, 0.17, 0.12, 0.06],
    ]),
    ["panel", 0.25, 0.33, 0.69, 0.6],
    ...repeat(8, (i): Shape => {
      const height = [0.22, 0.34, 0.27, 0.42, 0.31, 0.47, 0.38, 0.5][i];
      return ["bar", 0.29 + i * 0.08, 0.88 - height, 0.05, height];
    }),
  ],
  // Sign-up: illustration panel beside a short form.
  [
    ["image", 0, 0, 0.44, 1],
    ["heading", 0.52, 0.12, 0.3, 0.065],
    ["text", 0.52, 0.23, 0.36, 0.025],
    ...[0, 1, 2].flatMap((i): Shape[] => [
      ["text", 0.52, 0.32 + i * 0.15, 0.12, 0.022],
      ["panel", 0.52, 0.36 + i * 0.15, 0.4, 0.08],
    ]),
    ["button", 0.52, 0.82, 0.4, 0.08],
  ],
];

export interface Palette {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  brand: string;
}

/** Accent colours for the miniature pages, so they read as different sites. */
export const ACCENTS = [
  "", // the app's own brand colour
  "oklch(0.76 0.15 70)",
  "oklch(0.68 0.14 165)",
  "oklch(0.66 0.19 15)",
  "oklch(0.68 0.13 235)",
];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/** Draws one page either finished ("page") or as a blueprint ("plan"). */
export function drawCard(layout: Shape[], palette: Palette, accent: string, mode: "page" | "plan"): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const x0 = MARGIN;
  const y0 = MARGIN;
  const plan = mode === "plan";

  // The window itself.
  if (plan) {
    roundRect(ctx, x0, y0, CARD_WIDTH, CARD_HEIGHT, 18);
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = palette.brand;
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.brand;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.save();
    ctx.shadowColor = "rgba(30, 27, 75, 0.16)";
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 14;
    roundRect(ctx, x0, y0, CARD_WIDTH, CARD_HEIGHT, 18);
    ctx.fillStyle = palette.background;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.border;
    ctx.stroke();
  }

  // Browser bar: three dots and an address field.
  ctx.globalAlpha = plan ? 0.5 : 1;
  ["#ff6159", "#ffbd2e", "#28c941"].forEach((color, index) => {
    ctx.beginPath();
    ctx.arc(x0 + 22 + index * 18, y0 + CHROME_HEIGHT / 2 + 2, 5, 0, Math.PI * 2);
    if (plan) {
      ctx.strokeStyle = palette.brand;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  });
  roundRect(ctx, x0 + CARD_WIDTH * 0.3, y0 + 10, CARD_WIDTH * 0.4, 16, 8);
  if (plan) {
    ctx.strokeStyle = palette.brand;
    ctx.stroke();
  } else {
    ctx.fillStyle = palette.muted;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = plan ? palette.brand : palette.border;
  ctx.globalAlpha = plan ? 0.35 : 1;
  ctx.fillRect(x0, y0 + CHROME_HEIGHT + 4, CARD_WIDTH, 1.5);
  ctx.globalAlpha = 1;

  // Page content.
  const left = x0 + 2;
  const top = y0 + CHROME_HEIGHT + 6;
  const width = CARD_WIDTH - 4;
  const height = CARD_HEIGHT - CHROME_HEIGHT - 8;
  ctx.save();
  roundRect(ctx, x0, top, CARD_WIDTH, height + 2, 16);
  ctx.clip();

  for (const [kind, fx, fy, fw, fh] of layout) {
    const x = left + fx * width;
    const y = top + fy * height;
    const w = fw * width;
    const h = fh * height;
    const isLine = kind === "text" || kind === "heading";
    const radius = isLine ? h / 2 : kind === "button" ? 7 : 10;
    roundRect(ctx, x, y, w, h, radius);

    if (plan) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.brand;
      ctx.fillStyle = palette.brand;
      if (isLine) {
        ctx.globalAlpha = kind === "heading" ? 0.4 : 0.25;
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.5;
        ctx.setLineDash(kind === "image" ? [6, 6] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        if (kind === "image") {
          // The usual "image goes here" cross.
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + w, y + h);
          ctx.moveTo(x + w, y);
          ctx.lineTo(x, y + h);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      continue;
    }

    switch (kind) {
      case "text":
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = palette.foreground;
        ctx.fill();
        break;
      case "heading":
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = palette.foreground;
        ctx.fill();
        break;
      case "block":
        ctx.fillStyle = palette.muted;
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = palette.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      case "panel":
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = palette.border;
        ctx.stroke();
        break;
      case "button":
        ctx.fillStyle = accent;
        ctx.fill();
        break;
      case "bar":
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = accent;
        ctx.fill();
        break;
      case "image": {
        const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
        gradient.addColorStop(0, accent);
        gradient.addColorStop(1, palette.muted);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = gradient;
        ctx.fill();
        // A sun over a hill, the universal picture of a picture.
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = palette.background;
        ctx.beginPath();
        ctx.arc(x + w * 0.72, y + h * 0.3, Math.min(w, h) * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.quadraticCurveTo(x + w * 0.35, y + h * 0.45, x + w * 0.7, y + h * 0.8);
        ctx.quadraticCurveTo(x + w * 0.85, y + h * 0.7, x + w, y + h * 0.78);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return canvas;
}

/** Converts any CSS colour (oklch included) to 0–1 sRGB components. */
export function cssColorToRgb(color: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [0.4, 0.35, 0.95];
  ctx.fillStyle = "#6659f2";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

export function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: token("--background", "#ffffff"),
    foreground: token("--foreground", "#1a1a1a"),
    muted: token("--muted", "#f5f5f5"),
    border: token("--border", "#e5e5e5"),
    brand: token("--brand", "#5b4be8"),
  };
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

export const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Shows the blueprint below the scan line and the finished page above it, with a
 * glow on the line. `uReset` fades a finished page back to its blueprint.
 * Colours stay in sRGB end to end, so the pages match the canvas drawing exactly.
 */
export const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPage;
  uniform sampler2D uPlan;
  uniform vec4 uCard;
  uniform vec3 uBrand;
  uniform float uProgress;
  uniform float uReset;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 page = texture2D(uPage, vUv);
    vec4 plan = texture2D(uPlan, vUv);
    float inside = step(uCard.x, vUv.x) * step(vUv.x, uCard.z);
    float y = (uCard.w - vUv.y) / (uCard.w - uCard.y);
    float built = 1.0 - smoothstep(uProgress - 0.015, uProgress + 0.015, y);
    vec4 color = mix(plan, page, built * (1.0 - uReset));

    float scanning = step(0.0, uProgress) * step(uProgress, 1.0);
    float glow = exp(-pow((y - uProgress) * 34.0, 2.0)) * scanning * inside
      * step(0.0, y) * step(y, 1.0);
    color.rgb = mix(color.rgb, uBrand, glow * 0.85);
    color.a = max(color.a, glow * 0.7);

    gl_FragColor = vec4(color.rgb, color.a * uOpacity);
  }
`;

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export interface StageOptions {
  /** Draw one still frame instead of animating. */
  reducedMotion: boolean;
  fov?: number;
  cameraZ?: number;
  /** How far the camera drifts with the pointer, in world units; 0 for none. */
  parallax?: number;
}

export interface Stage {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  palette: Palette;
  /** The brand colour as 0–1 sRGB, for shader uniforms. */
  brand: Vector3;
  reducedMotion: boolean;
  /** Size of the drawing area in CSS pixels. */
  size: () => { width: number; height: number };
  /** Half the visible width and height of the view at depth `z`. */
  viewAt: (z: number) => { halfWidth: number; halfHeight: number };
  /** A texture from a canvas, disposed with the stage. */
  texture: (source: HTMLCanvasElement) => Texture;
  /** Registers anything with `dispose()` to be disposed with the stage. */
  track: <T extends { dispose: () => void }>(item: T) => T;
  /** Runs after every resize (and once at start), to lay the scene out. */
  onResize: (layout: () => void) => void;
  /**
   * Starts drawing: `update` gets the time in seconds and runs before every
   * frame. Returns a function that stops and disposes everything.
   */
  start: (update: (time: number) => void) => () => void;
}

/** Sets up a renderer filling `host`; null when the browser has no WebGL. */
export function createStage(host: HTMLElement, options: StageOptions): Stage | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);

  const fov = options.fov ?? 35;
  const cameraZ = options.cameraZ ?? 12;
  const scene = new Scene();
  const camera = new PerspectiveCamera(fov, 1, 0.1, 100);
  camera.position.set(0, 0, cameraZ);
  const palette = readPalette();
  const brand = new Vector3(...cssColorToRgb(palette.brand));
  const disposables: { dispose: () => void }[] = [];
  const layouts: (() => void)[] = [];
  const tan = Math.tan((fov * Math.PI) / 360);

  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const size = () => ({ width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) });

  return {
    scene,
    camera,
    renderer,
    palette,
    brand,
    reducedMotion: options.reducedMotion,
    size,
    viewAt: (z) => {
      const halfHeight = tan * (cameraZ - z);
      return { halfWidth: halfHeight * camera.aspect, halfHeight };
    },
    texture: (source) => {
      const texture = new CanvasTexture(source);
      texture.colorSpace = NoColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      return track(texture);
    },
    track,
    onResize: (layout) => {
      layouts.push(layout);
    },
    start: (update) => {
      const parallax = options.parallax ?? 0.5;
      const pointer = { x: 0, y: 0 };
      const view = { x: 0, y: 0 };
      const onPointerMove = (event: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        pointer.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
        pointer.y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      };

      const resize = () => {
        const { width, height } = size();
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        for (const layout of layouts) layout();
      };

      let frame = 0;
      let onScreen = true;
      const started = performance.now();
      const render = () => {
        if (parallax > 0) {
          view.x += (pointer.x - view.x) * 0.05;
          view.y += (pointer.y - view.y) * 0.05;
          camera.position.x = view.x * parallax;
          camera.position.y = -view.y * parallax * 0.6;
          camera.lookAt(0, 0, 0);
        }
        update(options.reducedMotion ? 0 : (performance.now() - started) / 1000);
        renderer.render(scene, camera);
      };
      const loop = () => {
        frame = requestAnimationFrame(loop);
        render();
      };
      const sync = () => {
        const run = onScreen && !document.hidden && !options.reducedMotion;
        if (run && !frame) frame = requestAnimationFrame(loop);
        else if (!run && frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      };

      const resizeObserver = new ResizeObserver(() => {
        resize();
        if (!frame) render();
      });
      resizeObserver.observe(host);
      const visibilityObserver = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      });
      visibilityObserver.observe(host);
      document.addEventListener("visibilitychange", sync);
      const hover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (hover && parallax > 0 && !options.reducedMotion) window.addEventListener("pointermove", onPointerMove);
      const onContextLost = (event: Event) => {
        event.preventDefault();
        host.removeAttribute("data-ready");
        cancelAnimationFrame(frame);
        frame = 0;
      };
      canvas.addEventListener("webglcontextlost", onContextLost);

      resize();
      render();
      host.setAttribute("data-ready", "");
      sync();

      return () => {
        cancelAnimationFrame(frame);
        frame = 0;
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
        document.removeEventListener("visibilitychange", sync);
        window.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        for (const item of disposables) item.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
        host.removeAttribute("data-ready");
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export type PageMesh = Mesh<PlaneGeometry, ShaderMaterial>;

/** The card's edges in texture coordinates (left, bottom, right, top). */
const CARD_UV = new Vector4(
  MARGIN / CANVAS_WIDTH,
  MARGIN / CANVAS_HEIGHT,
  (MARGIN + CARD_WIDTH) / CANVAS_WIDTH,
  (MARGIN + CARD_HEIGHT) / CANVAS_HEIGHT,
);

/** World height of a page `width` wide (its texture includes a shadow margin). */
export function pageHeight(width: number): number {
  return (width * CANVAS_HEIGHT) / CANVAS_WIDTH;
}

/**
 * A miniature web page that can be shown as a blueprint, a finished page, or
 * anywhere between with `uProgress` (the scan line, -0.1 to 1.2) and `uReset`
 * (fading a finished page back to its blueprint, 0 to 1).
 */
export function createPage(
  stage: Stage,
  options: { layout?: number; accent?: number; width?: number; opacity?: number } = {},
): PageMesh {
  const shapes = LAYOUTS[(options.layout ?? 0) % LAYOUTS.length];
  const accent = ACCENTS[(options.accent ?? 0) % ACCENTS.length] || stage.palette.brand;
  const width = options.width ?? 3.5;
  const material = stage.track(
    new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPage: { value: stage.texture(drawCard(shapes, stage.palette, accent, "page")) },
        uPlan: { value: stage.texture(drawCard(shapes, stage.palette, accent, "plan")) },
        uCard: { value: CARD_UV },
        uBrand: { value: stage.brand },
        uProgress: { value: 1.2 },
        uReset: { value: 0 },
        uOpacity: { value: options.opacity ?? 1 },
      },
    }),
  );
  const geometry = stage.track(new PlaneGeometry(width, pageHeight(width)));
  return new Mesh(geometry, material);
}

/**
 * Runs a page through build cycles: the scan rebuilds it from its blueprint,
 * it stays finished a while, then fades back. `t` is seconds into the cycle.
 */
export function cyclePage(page: PageMesh, t: number, period: number, scan = 3.2, fade = 1): void {
  const uniforms = page.material.uniforms;
  const local = ((t % period) + period) % period;
  if (local < scan) {
    uniforms.uProgress.value = -0.1 + (local / scan) * 1.2;
    uniforms.uReset.value = 0;
  } else if (local < period - fade) {
    uniforms.uProgress.value = 1.2;
    uniforms.uReset.value = 0;
  } else {
    uniforms.uProgress.value = 1.2;
    uniforms.uReset.value = (local - (period - fade)) / fade;
  }
}

/** A soft round sprite, for particles. */
function dotCanvas(): HTMLCanvasElement {
  const dot = document.createElement("canvas");
  dot.width = 32;
  dot.height = 32;
  const context = dot.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
  }
  return dot;
}

/** Brand-coloured points in a box; `drift` moves them upward and wraps them around. */
export function createSpecks(
  stage: Stage,
  options: { count: number; spread: [number, number, number]; size?: number; opacity?: number },
): { points: Points; drift: (amount: number) => void } {
  const [sx, sy, sz] = options.spread;
  const positions = new Float32Array(options.count * 3);
  for (let i = 0; i < options.count; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * sx;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * sy;
    positions[i * 3 + 2] = -sz + Math.random() * sz * 1.2;
  }
  const geometry = stage.track(new BufferGeometry());
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = stage.track(
    new PointsMaterial({
      size: options.size ?? 0.1,
      map: stage.texture(dotCanvas()),
      transparent: true,
      depthWrite: false,
      opacity: options.opacity ?? 0.55,
    }),
  );
  material.color.setRGB(stage.brand.x, stage.brand.y, stage.brand.z, SRGBColorSpace);
  const points = new Points(geometry, material);
  points.renderOrder = -1000;
  return {
    points,
    drift: (amount) => {
      const attribute = geometry.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < options.count; i++) {
        let y = attribute.getY(i) + amount;
        if (y > sy) y = -sy;
        attribute.setY(i, y);
      }
      attribute.needsUpdate = true;
    },
  };
}

/** A soft brand-coloured halo, set behind a scene's main page so it stands out in both themes. */
export function createGlow(stage: Stage, width: number, height: number, strength = 0.35): Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const material = stage.track(
    new MeshBasicMaterial({ map: stage.texture(canvas), transparent: true, depthWrite: false, opacity: strength }),
  );
  material.color.setRGB(stage.brand.x, stage.brand.y, stage.brand.z, SRGBColorSpace);
  const glow = new Mesh(stage.track(new PlaneGeometry(width, height)), material);
  glow.renderOrder = -100;
  return glow;
}

/** A flat rounded tile in a solid colour, e.g. a UI piece flying into a page. */
export function tileCanvas(color: string, width = 96, height = 48, radius = 10): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(2, 2, width - 4, height - 4, radius);
    context.fill();
  }
  return canvas;
}
