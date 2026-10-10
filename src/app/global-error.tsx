"use client";

import { RotateCw } from "lucide-react";
import { useEffect } from "react";

import { StatusScreen } from "@/components/cloner/status-screen";
import { Button } from "@/components/ui/button";
import { THEME_SCRIPT } from "@/lib/theme";

import "./globals.css";

/** Shown when the root layout itself fails, so it brings its own document and theme. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <title>Something went wrong · SiteCloner</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <StatusScreen
          code="Something went wrong"
          title="SiteCloner couldn't load"
          actions={
            <Button size="lg" onClick={() => retry()}>
              <RotateCw data-icon="inline-start" />
              Try again
            </Button>
          }
          footnote={
            error.digest ? (
              <>
                Reference <code className="font-mono">{error.digest}</code>, also in the app&apos;s log.
              </>
            ) : null
          }
        >
          <p>Your projects are safe. If trying again doesn&apos;t help, restart the app.</p>
        </StatusScreen>
      </body>
    </html>
  );
}
