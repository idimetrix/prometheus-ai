"use client";

import { useEffect } from "react";

import { logger } from "@/lib/logger";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    logger.error("[Global Error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md rounded-xl border bg-card p-8 text-center shadow-lg">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/20">
              <svg
                aria-label="Error"
                className="h-7 w-7 text-red-600 dark:text-red-400"
                fill="none"
                role="img"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <h2 className="mt-4 font-semibold text-lg">Something went wrong</h2>
            <p className="mt-2 text-sm opacity-70">
              A critical error occurred. Please try refreshing the page.
            </p>
            {error.digest && (
              <p className="mt-1 font-mono text-xs opacity-50">
                Error ID: {error.digest}
              </p>
            )}
            <div className="mt-6 flex justify-center gap-3">
              <button
                className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                onClick={reset}
                type="button"
              >
                Try Again
              </button>
              <button
                className="rounded-lg border px-4 py-2 text-sm transition-colors hover:bg-accent"
                onClick={() => (window.location.href = "/")}
                type="button"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
