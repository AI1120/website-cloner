"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// The page is laid out at this width, then scaled down to fit the card.
const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 800;

export const PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/**
 * A live, non-interactive miniature of a cloned page. A shimmer stands in until
 * the page has loaded, so dark mode never flashes a white card.
 */
export function ProjectThumbnail({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / VIRTUAL_WIDTH);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="relative aspect-[16/10] w-full overflow-hidden bg-muted"
      aria-hidden="true"
    >
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,var(--muted)_35%,color-mix(in_oklch,var(--muted),var(--background)_55%)_50%,var(--muted)_65%)]" />
      )}
      {scale !== null && (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          tabIndex={-1}
          sandbox={PREVIEW_SANDBOX}
          onLoad={() => setLoadedSrc(src)}
          className={cn(
            "pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
          // The scale depends on the measured card width.
          style={{
            width: VIRTUAL_WIDTH,
            height: VIRTUAL_HEIGHT,
            transform: `scale(${scale})`,
          }}
        />
      )}
    </div>
  );
}
