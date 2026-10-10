import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { StatusScreen } from "@/components/cloner/status-screen";
import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <StatusScreen
      code="Project not found"
      title="There's no project here"
      actions={
        <Button size="lg" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft data-icon="inline-start" />
          Back to your projects
        </Button>
      }
      footnote="Projects are stored on the machine running the app, so a link only works there."
    >
      <p>It may have been deleted, or the link is incomplete.</p>
    </StatusScreen>
  );
}
