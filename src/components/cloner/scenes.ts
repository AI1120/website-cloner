import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  PlaneGeometry,
  Points,
  PointsMaterial,
  BufferAttribute,
  BufferGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";

import {
  ACCENTS,
  createGlow,
  createPage,
  createSpecks,
  createStage,
  cyclePage,
  pageHeight,
  tileCanvas,
  type PageMesh,
  type Stage,
} from "@/components/cloner/scene-kit";

/**
 * The app's three.js moments besides the start screen backdrop, each a small
 * scene built from the same miniature pages:
 *
 * - "building": pieces of UI stream in and assemble a page while its scan line
 *   rebuilds it (an AI build in progress, loading screens);
 * - "idle": a blueprint waiting to be built (nothing made yet);
 * - "lost": pages tumbling past an empty outline (not found, errors);
 * - "compare": an original and its copy, scanned together while particles carry
 *   content across (cloning, comparing with the original).
 */

export type ScenePreset = "building" | "idle" | "lost" | "compare";

export interface SceneOptions {
  reducedMotion: boolean;
}

/** Scales `group` so a box of the given half size fits the view with some air. */
function fitter(stage: Stage, group: Group, halfWidth: number, halfHeight: number): void {
  stage.onResize(() => {
    const view = stage.viewAt(0);
    group.scale.setScalar(Math.min(1.25, (view.halfWidth * 0.92) / halfWidth, (view.halfHeight * 0.9) / halfHeight));
  });
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** A cheap repeatable pseudo-random number in [0, 1) for a pair of integers. */
function hash(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** A ring of brand-coloured dots, for an orbit around the subject. */
function createRing(stage: Stage, radius: number, count: number): Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = stage.track(new BufferGeometry());
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = stage.track(
    new PointsMaterial({ size: 0.06, transparent: true, depthWrite: false, opacity: 0.55 }),
  );
  material.color.setRGB(stage.brand.x, stage.brand.y, stage.brand.z, SRGBColorSpace);
  return new Points(geometry, material);
}

// ---------------------------------------------------------------------------

function buildingScene(stage: Stage): (time: number) => void {
  const group = new Group();
  stage.scene.add(group);
  fitter(stage, group, 3.4, 2.3);

  const ghost = createPage(stage, { layout: 0, width: 4.2, opacity: 0.28 });
  ghost.material.uniforms.uProgress.value = -0.1;
  ghost.position.set(0.45, -0.35, -1);
  ghost.renderOrder = -10;
  group.add(ghost);

  const page = createPage(stage, { layout: 0, width: 4.2 });
  group.add(page);
  const glow = createGlow(stage, 9, 6.5, 0.4);
  glow.position.z = -1.6;
  group.add(glow);

  // Pieces of UI flying in from all around and landing on the page.
  const colors = [stage.palette.brand, ...ACCENTS.filter(Boolean), stage.palette.muted];
  const tileGeometry = stage.track(new PlaneGeometry(0.62, 0.3));
  const tiles = Array.from({ length: 18 }, (_, index) => {
    const texture = stage.texture(tileCanvas(colors[index % colors.length]));
    const material = stage.track(new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    const mesh = new Mesh(tileGeometry, material);
    mesh.renderOrder = 10;
    group.add(mesh);
    return mesh;
  });
  const PERIOD = 2.8;

  const ring = createRing(stage, 3.3, 110);
  ring.rotation.x = 1.2;
  group.add(ring);
  const specks = createSpecks(stage, { count: 90, spread: [8, 4.5, 6], size: 0.08 });
  stage.scene.add(specks.points);

  const target = new Vector3();
  let last = 0;
  return (time) => {
    const delta = Math.min(0.1, time - last);
    last = time;
    if (stage.reducedMotion) {
      cyclePage(page, 5, 100);
      for (const tile of tiles) tile.visible = false;
      return;
    }
    page.rotation.set(-0.08 + Math.sin(time * 0.27) * 0.04, Math.sin(time * 0.35) * 0.2, 0);
    page.position.y = Math.sin(time * 0.6) * 0.06;
    ghost.rotation.copy(page.rotation);
    cyclePage(page, time, 6.4, 3.6, 0.9);
    page.updateMatrixWorld();

    tiles.forEach((tile, index) => {
      const shifted = time + (index / tiles.length) * PERIOD;
      const cycle = Math.floor(shifted / PERIOD);
      const u = (shifted % PERIOD) / PERIOD;
      const angle = hash(index, cycle) * Math.PI * 2;
      const radius = 3.6 + hash(cycle, index) * 1.4;
      const start = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.6, 1.5 + hash(index + 7, cycle) * 2.5);
      target.set((hash(index, cycle + 3) - 0.5) * 3.2, (hash(cycle + 5, index) - 0.5) * 2, 0.02);
      page.localToWorld(target);
      group.worldToLocal(target);
      const eased = easeInOut(u);
      tile.position.lerpVectors(start, target, eased);
      tile.scale.setScalar(1.1 - 0.75 * eased);
      tile.rotation.set(0, 0, (1 - eased) * (hash(cycle, index + 9) - 0.5) * 3);
      (tile.material as MeshBasicMaterial).opacity = Math.min(1, u * 5) * (u > 0.82 ? Math.max(0, 1 - (u - 0.82) / 0.18) : 1) * 0.95;
    });

    ring.rotation.z = time * 0.15;
    specks.drift(delta * 0.2);
  };
}

function idleScene(stage: Stage): (time: number) => void {
  const group = new Group();
  stage.scene.add(group);
  fitter(stage, group, 3.6, 2.2);

  const sides = [-1, 1].map((side, index) => {
    const ghost = createPage(stage, { layout: index + 2, width: 2.6, opacity: 0.35 });
    ghost.material.uniforms.uProgress.value = -0.1;
    ghost.position.set(side * 2.6, -0.2, -2);
    ghost.renderOrder = -10;
    group.add(ghost);
    return { ghost, side };
  });

  const page = createPage(stage, { layout: 0, width: 4 });
  page.material.uniforms.uProgress.value = -0.1;
  group.add(page);
  const glow = createGlow(stage, 8.5, 6, 0.45);
  glow.position.z = -1.2;
  group.add(glow);
  const specks = createSpecks(stage, { count: 70, spread: [8, 4.5, 6], size: 0.08, opacity: 0.45 });
  stage.scene.add(specks.points);

  let last = 0;
  return (time) => {
    const delta = Math.min(0.1, time - last);
    last = time;
    // A scan line resting at the top edge, as if about to start.
    page.material.uniforms.uProgress.value = stage.reducedMotion ? -0.1 : 0.02 + Math.sin(time * 1.6) * 0.025;
    page.rotation.set(-0.06 + Math.sin(time * 0.3) * 0.04, Math.sin(time * 0.25) * 0.22, 0);
    page.position.y = Math.sin(time * 0.55) * 0.08;
    for (const { ghost, side } of sides) {
      ghost.rotation.set(0, -side * (0.45 + Math.sin(time * 0.3 + side) * 0.06), 0);
      ghost.position.y = -0.2 + Math.sin(time * 0.4 + side * 2) * 0.1;
    }
    specks.drift(delta * 0.18);
  };
}

function lostScene(stage: Stage): (time: number) => void {
  const group = new Group();
  stage.scene.add(group);
  fitter(stage, group, 4, 2.4);

  const drifting: { page: PageMesh; base: Vector3; spin: Vector3; phase: number }[] = Array.from(
    { length: 6 },
    (_, index) => {
      const page = createPage(stage, { layout: index, accent: index * 2, width: 1.8, opacity: 0.4 + hash(index, 1) * 0.35 });
      const angle = (index / 6) * Math.PI * 2 + 0.4;
      const base = new Vector3(Math.cos(angle) * 3.4, Math.sin(angle) * 1.9, -1.5 - hash(index, 2) * 3);
      page.renderOrder = Math.round(base.z * 10);
      group.add(page);
      return {
        page,
        base,
        spin: new Vector3(hash(index, 3) - 0.5, hash(index, 4) - 0.5, hash(index, 5) - 0.5),
        phase: index * 1.3,
      };
    },
  );

  // The page that isn't there: just its outline.
  const missing = createPage(stage, { layout: 0, width: 3, opacity: 0.85 });
  missing.material.uniforms.uProgress.value = -0.1;
  group.add(missing);
  const glow = createGlow(stage, 7, 5, 0.4);
  glow.position.z = -1;
  group.add(glow);
  const specks = createSpecks(stage, { count: 80, spread: [9, 5, 6], size: 0.08, opacity: 0.4 });
  stage.scene.add(specks.points);

  let last = 0;
  return (time) => {
    const delta = Math.min(0.1, time - last);
    last = time;
    for (const { page, base, spin, phase } of drifting) {
      page.position.set(
        base.x + Math.sin(time * 0.2 + phase) * 0.3,
        base.y + Math.cos(time * 0.25 + phase) * 0.25,
        base.z,
      );
      page.rotation.set(time * spin.x * 0.5, time * spin.y * 0.6 + phase, time * spin.z * 0.3);
    }
    missing.rotation.set(Math.sin(time * 0.3) * 0.08, Math.sin(time * 0.22) * 0.3, Math.sin(time * 0.18) * 0.04);
    missing.material.uniforms.uOpacity.value = 0.75 + Math.sin(time * 1.2) * 0.12;
    specks.drift(delta * 0.15);
  };
}

function compareScene(stage: Stage): (time: number) => void {
  const group = new Group();
  stage.scene.add(group);
  fitter(stage, group, 4.6, 1.7);
  const width = 3.2;
  const height = pageHeight(width);

  const original = createPage(stage, { layout: 0, width });
  original.position.set(-2.15, 0, 0);
  original.rotation.y = 0.32;
  group.add(original);
  const copy = createPage(stage, { layout: 0, width });
  copy.position.set(2.15, 0, 0);
  copy.rotation.y = -0.32;
  group.add(copy);
  const glow = createGlow(stage, 11, 5, 0.3);
  glow.position.z = -1.4;
  group.add(glow);

  // A scan bar sweeping both pages at once.
  const bar = document.createElement("canvas");
  bar.width = 256;
  bar.height = 16;
  const barContext = bar.getContext("2d");
  if (barContext) {
    const gradient = barContext.createLinearGradient(0, 0, 0, 16);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.5, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    barContext.fillStyle = gradient;
    barContext.fillRect(0, 0, 256, 16);
  }
  const barTexture = stage.track(new CanvasTexture(bar));
  barTexture.colorSpace = NoColorSpace;
  const barMaterial = stage.track(
    new MeshBasicMaterial({ map: barTexture, transparent: true, depthWrite: false, opacity: 0.55 }),
  );
  barMaterial.color.setRGB(stage.brand.x, stage.brand.y, stage.brand.z, SRGBColorSpace);
  const scanBar = new Mesh(stage.track(new PlaneGeometry(width * 2 + 2.2, 0.16)), barMaterial);
  scanBar.position.z = 0.6;
  scanBar.renderOrder = 20;
  group.add(scanBar);

  // Particles carrying content from the original to the copy.
  const count = 48;
  const positions = new Float32Array(count * 3);
  const flowGeometry = stage.track(new BufferGeometry());
  flowGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  const flowMaterial = stage.track(
    new PointsMaterial({ size: 0.09, transparent: true, depthWrite: false, opacity: 0.85 }),
  );
  flowMaterial.color.setRGB(stage.brand.x, stage.brand.y, stage.brand.z, SRGBColorSpace);
  const flow = new Points(flowGeometry, flowMaterial);
  flow.renderOrder = 30;
  group.add(flow);
  const specks = createSpecks(stage, { count: 60, spread: [9, 4, 6], size: 0.07, opacity: 0.4 });
  stage.scene.add(specks.points);

  const PERIOD = 4.4;
  const SCAN = 3.2;
  const cardHeight = height * 0.83;
  let last = 0;
  return (time) => {
    const delta = Math.min(0.1, time - last);
    last = time;
    if (stage.reducedMotion) {
      cyclePage(copy, 5, 100);
      scanBar.visible = false;
      flow.visible = false;
      return;
    }
    cyclePage(copy, time, PERIOD, SCAN, 0.6);
    const local = time % PERIOD;
    const progress = Math.min(1, local / SCAN);
    const y = cardHeight / 2 - progress * cardHeight;
    scanBar.position.y = y;
    barMaterial.opacity = local < SCAN ? 0.55 : Math.max(0, 0.55 - (local - SCAN) * 1.5);

    const attribute = flowGeometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < count; i++) {
      const u = ((time * 0.7 + i / count) % 1 + 1) % 1;
      const x = -1.4 + u * 2.8;
      attribute.setXYZ(
        i,
        x,
        y + (hash(i, 1) - 0.5) * 0.35 + Math.sin(u * Math.PI) * 0.15,
        0.4 + Math.sin(u * Math.PI) * 0.9,
      );
    }
    attribute.needsUpdate = true;
    flowMaterial.opacity = local < SCAN ? 0.85 : 0.2;
    original.position.y = Math.sin(time * 0.5) * 0.05;
    copy.position.y = Math.sin(time * 0.5 + 1) * 0.05;
    specks.drift(delta * 0.15);
  };
}

const PRESETS: Record<ScenePreset, (stage: Stage) => (time: number) => void> = {
  building: buildingScene,
  idle: idleScene,
  lost: lostScene,
  compare: compareScene,
};

/** Mounts a preset into `host`; returns a function that removes it again. */
export function mountScene(host: HTMLElement, preset: ScenePreset, options: SceneOptions): () => void {
  const stage = createStage(host, { reducedMotion: options.reducedMotion, cameraZ: 11, parallax: 0.45 });
  if (!stage) return () => {};
  const update = PRESETS[preset](stage);
  return stage.start(update);
}
