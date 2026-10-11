"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ScenePreset } from "@/components/cloner/scenes";
import { useHydrated } from "@/hooks/use-client";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

interface Scene3DProps {
  preset: ScenePreset;
  className?: string;
  /** Shown until the scene has drawn, and kept when the browser has no WebGL. */
  fallback?: ReactNode;
}

/**
 * One of the app's three.js scenes (see `scenes.ts`), filling its box. three.js
 * is fetched only in the browser and only once for every scene on the page; the
 * scene pauses off screen, draws one still frame under reduced motion, and is
 * rebuilt in the new colours when the theme changes.
 */
export function Scene3D({ preset, className, fallback }: Scene3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolved: theme } = useTheme();
  const hydrated = useHydrated();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hydrated) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("@/components/cloner/scenes")
      .then(({ mountScene }) => {
        if (cancelled) return;
        dispose = mountScene(host, preset, { reducedMotion });
        setReady(host.hasAttribute("data-ready"));
      })
      .catch(() => {
        // The fallback stays.
      });
    return () => {
      cancelled = true;
      dispose?.();
      setReady(false);
    };
  }, [hydrated, preset, theme]);

  return (
    <div aria-hidden="true" className={cn("pointer-events-none relative", className)}>
      {fallback && (
        <div className={cn("absolute inset-0 transition-opacity duration-500", ready ? "opacity-0" : "opacity-100")}>
          {fallback}
        </div>
      )}
      <div
        ref={hostRef}
        // Faded at the edges, so pieces flying in from outside never show a hard cut.
        className="absolute inset-0 opacity-0 transition-opacity duration-700 ease-out [mask-image:radial-gradient(closest-side,black_72%,transparent)] data-ready:opacity-100"
      />
    </div>
  );
}
