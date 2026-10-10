import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatusScreen } from "@/components/cloner/status-screen";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found · SiteCloner",
};

export default function NotFound() {
  return (
    <StatusScreen
      code="404"
      title="This page doesn't exist"
      actions={
        <Button size="lg" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft data-icon="inline-start" />
          Back to your projects
        </Button>
      }
    >
      <p>The address may be mistyped, or the page was moved.</p>
    </StatusScreen>
  );
}
