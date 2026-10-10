"use client";

import { useEffect, useRef } from "react";

import { useHydrated } from "@/hooks/use-client";
import { useTheme } from "@/hooks/use-theme";

/**
 * Decoration behind the start screen's heading: a soft brand glow, with a
 * three.js scene of pages being rebuilt on top once it has loaded. three.js is
 * fetched only in the browser, after the page is up; without WebGL, or before it
 * arrives, the glow alone is shown. The scene takes its colours from the theme,
 * so it is built again when the theme changes.
 */
export function HeroBackdrop() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const { resolved: theme } = useTheme();
  const hydrated = useHydrated();

  useEffect(() => {
    const host = sceneRef.current;
    if (!host || !hydrated) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    import("@/components/cloner/hero-scene")
      .then(({ mountHeroScene }) => {
        if (!cancelled) dispose = mountHeroScene(host, { reducedMotion });
      })
      .catch(() => {
        // The glow is enough on its own.
      });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [hydrated, theme]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[40rem] overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(60%_70%_at_50%_0%,color-mix(in_oklch,var(--brand)_20%,transparent),transparent_70%)]" />
      <div
        ref={sceneRef}
        className="absolute inset-0 opacity-0 transition-opacity duration-1000 ease-out mask-b-from-55% mask-b-to-100% data-ready:opacity-100"
      />
    </div>
  );
}
