"use client";

import { Button, Card, CardContent } from "@prometheus/ui";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { logger } from "@/lib/logger";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PrivacyError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    logger.error("[Privacy Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <Card className="max-w-md">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h2 className="mt-4 font-semibold text-foreground text-lg">
            Privacy Policy Error
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            Something went wrong loading this page. Please try again.
          </p>
          {error.digest && (
            <p className="mt-1 font-mono text-muted-foreground text-xs">
              Error ID: {error.digest}
            </p>
          )}
          <div className="mt-6">
            <Button onClick={reset}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
