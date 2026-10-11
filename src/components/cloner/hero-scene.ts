import { createPage, createSpecks, createStage, cyclePage, type PageMesh } from "@/components/cloner/scene-kit";

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
const PAGE_WIDTH = 3.5;
/** Half the width, in CSS pixels, of the centre column (heading and prompt box) pages keep out of. */
const CLEAR_HALF_WIDTH = 375;

interface Card {
  mesh: PageMesh;
  slot: Slot;
  phase: number;
  period: number;
  side: number;
  /** Height the page floats around, set by the layout. */
  baseY: number;
}

/** Mounts the scene into `host` and returns a function that removes it again. */
export function mountHeroScene(host: HTMLElement, options: HeroSceneOptions): () => void {
  const stage = createStage(host, { reducedMotion: options.reducedMotion, cameraZ: CAMERA_Z, parallax: 0.7 });
  // No WebGL: the CSS glow underneath stays as it was.
  if (!stage) return () => {};

  const cards: Card[] = SLOTS.map((slot, index) => {
    const mesh = createPage(stage, { layout: index, accent: index * 3, width: PAGE_WIDTH });
    // Draw far pages first so the transparent edges blend over them.
    mesh.renderOrder = Math.round(slot.z * 10);
    stage.scene.add(mesh);
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
  const specks = createSpecks(stage, { count: 140, spread: [14, 6, 12], size: 0.11 });
  stage.scene.add(specks.points);

  // Layout follows the size of the hero, so pages stay beside the heading.
  let narrow = false;
  stage.onResize(() => {
    const { width, height } = stage.size();
    narrow = width < 700;
    for (const card of cards) {
      const { slot, side } = card;
      const { halfWidth, halfHeight } = stage.viewAt(slot.z);
      let x: number;
      if (narrow) {
        // On phones the text spans the width; faint pages sit out at the edges.
        x = slot.x * 1.18 * halfWidth;
      } else {
        // Keep each page clear of the centre column, even if that pushes it
        // partly off the side of a smaller window.
        const pixelsPerUnit = height / (2 * halfHeight);
        const halfPage = ((PAGE_WIDTH * slot.scale) / 2) * Math.cos(0.38);
        const clear = CLEAR_HALF_WIDTH / pixelsPerUnit + halfPage;
        x = side * Math.max(Math.abs(slot.x) * halfWidth, clear);
      }
      card.baseY = slot.y * halfHeight;
      card.mesh.position.set(x, card.baseY, slot.z);
      card.mesh.scale.setScalar(slot.scale);
    }
  });

  let last = 0;
  return stage.start((time) => {
    const delta = Math.min(0.1, time - last);
    last = time;
    for (const card of cards) {
      const { mesh, slot, side, phase, period, baseY } = card;
      const depthFade = Math.max(0.3, Math.min(1, 1 + slot.z / 12));
      mesh.material.uniforms.uOpacity.value = depthFade * (narrow ? 0.45 : 0.92);

      if (stage.reducedMotion) {
        cyclePage(mesh, 5, 100);
        mesh.rotation.set(-0.06, -side * 0.38, 0);
        continue;
      }
      cyclePage(mesh, time + phase, period, 3.2, 1.1);
      const bob = Math.sin(time * 0.45 + phase);
      mesh.position.y = baseY + bob * 0.12;
      mesh.rotation.set(-0.06 + Math.sin(time * 0.3 + phase) * 0.03, -side * (0.38 + bob * 0.05), 0);
    }
    if (!stage.reducedMotion) specks.drift(delta * 0.24);
  });
}
