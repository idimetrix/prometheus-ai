import { Button, Card, CardContent } from "@prometheus/ui";
import { FileQuestion } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

export default function SessionNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <Card className="max-w-md">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <FileQuestion className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="mt-4 font-semibold text-foreground text-lg">
            Session not found
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            This session doesn&apos;t exist or has been deleted.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link href={"/dashboard/sessions" as Route}>
                Back to Sessions
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
