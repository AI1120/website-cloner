"use client";

import { House, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { StatusScreen } from "@/components/cloner/status-screen";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
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
    <StatusScreen
      code="Something went wrong"
      title="This page couldn't be shown"
      actions={
        <>
          <Button size="lg" onClick={() => retry()}>
            <RotateCw data-icon="inline-start" />
            Try again
          </Button>
          <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/" />}>
            <House data-icon="inline-start" />
            Your projects
          </Button>
        </>
      }
      footnote={
        error.digest ? (
          <>
            Reference <code className="font-mono">{error.digest}</code>, also in the app&apos;s log.
          </>
        ) : null
      }
    >
      <p>Your projects are safe. If trying again doesn&apos;t help, check that the app is still running.</p>
    </StatusScreen>
  );
}
