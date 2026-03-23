"use client";

import { Button, Card, CardContent } from "@prometheus/ui";
import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AuthError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[Auth Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <Card className="max-w-md">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h2 className="mt-4 font-semibold text-foreground text-lg">
            Authentication Error
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            {error.message || "Something went wrong during authentication."}
          </p>
          {error.digest && (
            <p className="mt-1 font-mono text-muted-foreground text-xs">
              Error ID: {error.digest}
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={reset}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Try Again
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Go Home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
