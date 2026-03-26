import { Button, Card, CardContent } from "@prometheus/ui";
import { FileQuestion } from "lucide-react";
import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <Card className="max-w-md">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <FileQuestion className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="mt-4 font-semibold text-foreground text-lg">
            Project not found
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            This project doesn&apos;t exist or you don&apos;t have access to it.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link href="/dashboard/projects">Back to Projects</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
