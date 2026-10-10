"use client";

import { useEffect, useRef, useState } from "react";

// The page is laid out at this width, then scaled down to fit the card.
const VIRTUAL_WIDTH = 1280;
const VIRTUAL_HEIGHT = 800;

export const PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/** A live, non-interactive miniature of a cloned page. */
export function ProjectThumbnail({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

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
      {scale !== null && (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          tabIndex={-1}
          sandbox={PREVIEW_SANDBOX}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white"
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
