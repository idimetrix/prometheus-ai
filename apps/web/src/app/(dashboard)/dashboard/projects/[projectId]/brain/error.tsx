"use client";

import { Button, Card, CardContent } from "@prometheus/ui";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { logger } from "@/lib/logger";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function BrainError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    logger.error("[Brain Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <Card className="max-w-md">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h2 className="mt-4 font-semibold text-foreground text-lg">
            Brain Error
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            {error.message || "Failed to load project brain."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={reset}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Try Again
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/projects">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Projects
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
