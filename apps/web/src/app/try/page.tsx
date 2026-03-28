"use client";

import { Button } from "@prometheus/ui";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

const EXAMPLE_PROMPTS = [
  "A todo app with dark mode",
  "A landing page for a SaaS product",
  "REST API with Express and PostgreSQL",
  "A dashboard with charts and analytics",
  "A blog with markdown support",
  "An e-commerce product page",
];

export default function TryPage() {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleGenerate = useCallback(() => {
    const text = prompt.trim();
    if (!text || isLoading) {
      return;
    }

    setIsLoading(true);
    // Redirect to signup with the prompt preserved in query params
    const encoded = encodeURIComponent(text);
    router.push(`/sign-up?prompt=${encoded}` as Route);
  }, [prompt, isLoading, router]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      {/* Hero */}
      <div className="mb-12 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-4 py-1.5">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <span className="text-sm text-violet-300">
            AI-Powered Engineering Platform
          </span>
        </div>
        <h1 className="mb-4 font-bold text-4xl text-foreground tracking-tight sm:text-5xl md:text-6xl">
          What do you want to build?
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Describe your project and Prometheus will generate production-ready
          code with tests, documentation, and deployment configs.
        </p>
      </div>

      {/* Prompt input */}
      <div className="w-full max-w-2xl">
        <div className="relative">
          <textarea
            className="w-full resize-none rounded-2xl border border-zinc-700 bg-zinc-900 px-6 py-5 pr-14 text-base text-foreground shadow-lg outline-none transition-colors placeholder:text-muted-foreground focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build..."
            rows={3}
            value={prompt}
          />
          <button
            aria-label="Generate"
            className="absolute right-4 bottom-4 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            disabled={!prompt.trim() || isLoading}
            onClick={handleGenerate}
            type="button"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ArrowRight className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Example prompts */}
        <div className="mt-6">
          <p className="mb-3 text-center text-muted-foreground text-sm">
            Try one of these examples:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-muted-foreground text-sm transition-colors hover:border-violet-500 hover:text-violet-300"
                key={example}
                onClick={() => setPrompt(example)}
                type="button"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sign up CTA */}
      <div className="mt-16 text-center">
        <p className="mb-4 text-muted-foreground text-sm">
          Sign up to save your projects and access all features
        </p>
        <Button
          className="bg-violet-600 hover:bg-violet-500"
          onClick={() => router.push("/sign-up" as Route)}
          size="lg"
        >
          Get Started Free
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
