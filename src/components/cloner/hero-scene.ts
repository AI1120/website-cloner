import {
  CanvasTexture,
  type Material,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  BufferAttribute,
  BufferGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";

/**
 * The start screen's backdrop: miniature web pages floating either side of the
 * heading. Each page starts as a blueprint and a scan line rebuilds it, over and
 * over at its own pace — a picture of what the app does.
 *
 * Plain three.js, loaded on demand by `HeroBackdrop`; nothing here runs on the server.
 */

export interface HeroSceneOptions {
  /** Draw one still frame (every page built) instead of animating. */
  reducedMotion: boolean;
}

// ---------------------------------------------------------------------------
// Page textures
// ---------------------------------------------------------------------------

/** Card size in texture pixels, and the transparent margin kept for its shadow. */
const CARD_WIDTH = 640;
const CARD_HEIGHT = 440;
const MARGIN = 44;
const CANVAS_WIDTH = CARD_WIDTH + MARGIN * 2;
const CANVAS_HEIGHT = CARD_HEIGHT + MARGIN * 2;
const CHROME_HEIGHT = 34;

type Kind = "text" | "heading" | "block" | "panel" | "button" | "image" | "bar";

/** One element of a page, in fractions of the area below the browser bar. */
type Shape = [kind: Kind, x: number, y: number, w: number, h: number];

function repeat(count: number, make: (index: number) => Shape): Shape[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

/** A few common page types, roughly sketched. */
const LAYOUTS: Shape[][] = [
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

interface Palette {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  brand: string;
}

/** Accent colours for the miniature pages, so they read as different sites. */
const ACCENTS = [
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
function drawCard(layout: Shape[], palette: Palette, accent: string, mode: "page" | "plan"): HTMLCanvasElement {
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
function cssColorToRgb(color: string): [number, number, number] {
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

function readPalette(): Palette {
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
// Scene
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
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
const FRAGMENT_SHADER = /* glsl */ `
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

/** Where a page sits: across the visible width and height at its depth (-1 to 1). */
interface Slot {
  x: number;
  y: number;
  z: number;
  scale: number;
}

const SLOTS: Slot[] = [
  { x: -0.82, y: 0.5, z: -4.5, scale: 1 },
  { x: -0.7, y: -0.12, z: -1.2, scale: 0.86 },
  { x: -0.95, y: -0.62, z: -3, scale: 0.95 },
  { x: -0.58, y: 0.86, z: -9, scale: 1 },
  { x: -0.62, y: -0.9, z: -6.5, scale: 1 },
  { x: 0.84, y: 0.46, z: -4, scale: 1 },
  { x: 0.7, y: -0.18, z: -1, scale: 0.86 },
  { x: 0.96, y: -0.66, z: -3.5, scale: 0.95 },
  { x: 0.6, y: 0.9, z: -8.5, scale: 1 },
  { x: 0.6, y: -0.92, z: -6, scale: 1 },
];

const CAMERA_Z = 14;
const FIELD_OF_VIEW = 35;
const PAGE_WIDTH = 3.5;
/** Half the width, in CSS pixels, of the centre column (heading and prompt box) pages keep out of. */
const CLEAR_HALF_WIDTH = 375;
/** Seconds a scan takes, and how long a finished page takes to fade back to its blueprint. */
const SCAN_SECONDS = 3.2;
const FADE_SECONDS = 1.1;

interface Card {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  slot: Slot;
  phase: number;
  period: number;
  side: number;
  /** Height the page floats around, set by the layout. */
  baseY: number;
}

/** Mounts the scene into `host` and returns a function that removes it again. */
export function mountHeroScene(host: HTMLElement, options: HeroSceneOptions): () => void {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  } catch {
    // No WebGL: the CSS glow underneath stays as it was.
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 100);
  camera.position.set(0, 0, CAMERA_Z);

  const palette = readPalette();
  const brand = new Vector3(...cssColorToRgb(palette.brand));
  const textures: Texture[] = [];
  const materials: Material[] = [];

  const makeTexture = (source: HTMLCanvasElement) => {
    const texture = new CanvasTexture(source);
    texture.colorSpace = NoColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.push(texture);
    return texture;
  };

  const pageHeight = (PAGE_WIDTH * CANVAS_HEIGHT) / CANVAS_WIDTH;
  const geometry = new PlaneGeometry(PAGE_WIDTH, pageHeight);
  // The card's edges in texture coordinates (left, bottom, right, top).
  const cardUv = new Vector4(
    MARGIN / CANVAS_WIDTH,
    MARGIN / CANVAS_HEIGHT,
    (MARGIN + CARD_WIDTH) / CANVAS_WIDTH,
    (MARGIN + CARD_HEIGHT) / CANVAS_HEIGHT,
  );

  const cards: Card[] = SLOTS.map((slot, index) => {
    const shapes = LAYOUTS[index % LAYOUTS.length];
    const accent = ACCENTS[(index * 3) % ACCENTS.length] || palette.brand;
    const material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPage: { value: makeTexture(drawCard(shapes, palette, accent, "page")) },
        uPlan: { value: makeTexture(drawCard(shapes, palette, accent, "plan")) },
        uCard: { value: cardUv },
        uBrand: { value: brand },
        uProgress: { value: 1.2 },
        uReset: { value: 0 },
        uOpacity: { value: 1 },
      },
    });
    materials.push(material);
    const mesh = new Mesh(geometry, material);
    // Draw far pages first so the transparent edges blend over them.
    mesh.renderOrder = Math.round(slot.z * 10);
    scene.add(mesh);
    return {
      mesh,
      slot,
      side: Math.sign(slot.x),
      phase: index * 1.7,
      period: 8.5 + ((index * 37) % 10) * 0.45,
      baseY: 0,
    };
  });

  // Faint specks drifting upwards, for depth.
  const speckCount = 140;
  const specks = new Float32Array(speckCount * 3);
  for (let i = 0; i < speckCount; i++) {
    specks[i * 3] = (Math.random() * 2 - 1) * 14;
    specks[i * 3 + 1] = (Math.random() * 2 - 1) * 6;
    specks[i * 3 + 2] = -12 + Math.random() * 12;
  }
  const speckGeometry = new BufferGeometry();
  speckGeometry.setAttribute("position", new BufferAttribute(specks, 3));
  const dot = document.createElement("canvas");
  dot.width = 32;
  dot.height = 32;
  const dotContext = dot.getContext("2d");
  if (dotContext) {
    const gradient = dotContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    dotContext.fillStyle = gradient;
    dotContext.fillRect(0, 0, 32, 32);
  }
  const speckMaterial = new PointsMaterial({
    size: 0.11,
    map: makeTexture(dot),
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
  });
  speckMaterial.color.setRGB(brand.x, brand.y, brand.z, SRGBColorSpace);
  materials.push(speckMaterial);
  const speckField = new Points(speckGeometry, speckMaterial);
  speckField.renderOrder = -1000;
  scene.add(speckField);

  // Layout follows the size of the hero, so pages stay beside the heading.
  let narrow = false;
  const arrange = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    narrow = width < 700;
    const tan = Math.tan((FIELD_OF_VIEW * Math.PI) / 360);
    for (const card of cards) {
      const { slot, side } = card;
      const distance = CAMERA_Z - slot.z;
      const halfWidth = tan * distance * camera.aspect;
      let x: number;
      if (narrow) {
        // On phones the text spans the width; faint pages sit out at the edges.
        x = slot.x * 1.18 * halfWidth;
      } else {
        // Keep each page clear of the centre column, even if that pushes it
        // partly off the side of a smaller window.
        const pixelsPerUnit = height / (2 * tan * distance);
        const halfPage = ((PAGE_WIDTH * slot.scale) / 2) * Math.cos(0.38);
        const clear = CLEAR_HALF_WIDTH / pixelsPerUnit + halfPage;
        x = side * Math.max(Math.abs(slot.x) * halfWidth, clear);
      }
      card.baseY = slot.y * tan * distance;
      card.mesh.position.set(x, card.baseY, slot.z);
      card.mesh.scale.setScalar(slot.scale);
    }
  };

  // Gentle parallax that follows the pointer.
  const pointer = { x: 0, y: 0 };
  const view = { x: 0, y: 0 };
  const hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const onPointerMove = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    pointer.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    pointer.y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
  };

  const update = (time: number) => {
    view.x += (pointer.x - view.x) * 0.04;
    view.y += (pointer.y - view.y) * 0.04;
    camera.position.x = view.x * 0.7;
    camera.position.y = -view.y * 0.4;
    camera.lookAt(0, 0, 0);

    for (const card of cards) {
      const { mesh, slot, side, phase, period, baseY } = card;
      const uniforms = mesh.material.uniforms;
      const depthFade = Math.max(0.3, Math.min(1, 1 + slot.z / 12));
      uniforms.uOpacity.value = depthFade * (narrow ? 0.45 : 0.92);

      if (options.reducedMotion) {
        uniforms.uProgress.value = 1.2;
        uniforms.uReset.value = 0;
        mesh.rotation.set(-0.06, -side * 0.38, 0);
        continue;
      }

      const t = (time + phase) % period;
      if (t < SCAN_SECONDS) {
        uniforms.uProgress.value = -0.1 + (t / SCAN_SECONDS) * 1.2;
        uniforms.uReset.value = 0;
      } else if (t < period - FADE_SECONDS) {
        uniforms.uProgress.value = 1.2;
        uniforms.uReset.value = 0;
      } else {
        uniforms.uProgress.value = 1.2;
        uniforms.uReset.value = (t - (period - FADE_SECONDS)) / FADE_SECONDS;
      }

      const bob = Math.sin(time * 0.45 + phase);
      mesh.position.y = baseY + bob * 0.12;
      mesh.rotation.set(-0.06 + Math.sin(time * 0.3 + phase) * 0.03, -side * (0.38 + bob * 0.05), 0);
    }

    if (!options.reducedMotion) {
      const positions = speckGeometry.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < speckCount; i++) {
        let y = positions.getY(i) + 0.004;
        if (y > 6) y = -6;
        positions.setY(i, y);
      }
      positions.needsUpdate = true;
    }
  };

  // Only animate while the hero is on screen and the tab is visible.
  let frame = 0;
  let onScreen = true;
  const started = performance.now();
  const render = () => {
    update((performance.now() - started) / 1000);
    renderer.render(scene, camera);
  };
  const loop = () => {
    frame = requestAnimationFrame(loop);
    render();
  };
  const sync = () => {
    const shouldRun = onScreen && !document.hidden && !options.reducedMotion;
    if (shouldRun && !frame) {
      frame = requestAnimationFrame(loop);
    } else if (!shouldRun && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  const resizeObserver = new ResizeObserver(() => {
    arrange();
    if (!frame) render();
  });
  resizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    sync();
  });
  visibilityObserver.observe(host);
  document.addEventListener("visibilitychange", sync);
  if (hoverCapable && !options.reducedMotion) window.addEventListener("pointermove", onPointerMove);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    host.removeAttribute("data-ready");
    cancelAnimationFrame(frame);
    frame = 0;
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  arrange();
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
    geometry.dispose();
    speckGeometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    host.removeAttribute("data-ready");
  };
}
