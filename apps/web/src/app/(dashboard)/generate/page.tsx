"use client";

import {
  Copy,
  Download,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { trpc } from "@/lib/trpc";

const SandpackPreview = dynamic(
  () =>
    import("@/components/preview/sandpack-preview").then(
      (m) => m.SandpackPreview
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading preview...
      </div>
    ),
  }
);

type Style = "shadcn" | "tailwind" | "plain";
type Framework = "react" | "nextjs";

interface ChatMessage {
  content: string;
  id: string;
  role: "user" | "assistant";
}

const SUGGESTION_CHIPS = [
  "A pricing card with 3 tiers",
  "A dashboard sidebar with navigation",
  "A user profile settings form",
  "A data table with sorting",
  "A hero section with CTA",
  "A login form with social auth",
];

export default function GeneratePage() {
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [style, setStyle] = useState<Style>("shadcn");
  const [framework, setFramework] = useState<Framework>("react");
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("dark");
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [showCode, setShowCode] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const generateMutation = trpc.generate.ui.useMutation();
  const refineMutation = trpc.generate.refine.useMutation();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleGenerate = useCallback(
    async (prompt?: string) => {
      const text = prompt ?? input.trim();
      if (!text || isGenerating) {
        return;
      }

      setInput("");
      setIsGenerating(true);

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        let result: { code: string; durationMs: number };

        if (code) {
          // Refine existing code
          result = await refineMutation.mutateAsync({
            currentCode: code,
            instruction: text,
          });
        } else {
          // Generate new UI
          result = await generateMutation.mutateAsync({
            prompt: text,
            style,
            framework,
          });
        }

        setCode(result.code);
        setDurationMs(result.durationMs);

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Generated in ${(result.durationMs / 1000).toFixed(1)}s. ${
            code ? "Code updated." : "Component ready."
          }`,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        scrollToBottom();
      } catch (err) {
        logger.error("UI generation failed:", err);
        toast.error("Failed to generate UI. Please try again.");

        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Generation failed. Please try again.",
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsGenerating(false);
        inputRef.current?.focus();
      }
    },
    [
      input,
      isGenerating,
      code,
      style,
      framework,
      generateMutation,
      refineMutation,
      scrollToBottom,
    ]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  }

  function handleCopyCode() {
    if (code) {
      navigator.clipboard.writeText(code);
      toast.success("Code copied to clipboard");
    }
  }

  function handleExport() {
    if (!code) {
      return;
    }
    const blob = new Blob([code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "component.tsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleReset() {
    setCode("");
    setMessages([]);
    setDurationMs(null);
    setShowCode(false);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      {/* Left panel: Prompt + Chat */}
      <div className="flex w-full flex-col rounded-xl border bg-card lg:w-[400px] lg:min-w-[360px]">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Generate UI</span>
          {durationMs !== null && (
            <span className="ml-auto text-muted-foreground text-xs">
              {(durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        {/* Style / Framework selectors */}
        <div className="flex items-center gap-3 border-b px-4 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Style:</span>
            <select
              aria-label="Component style"
              className="rounded border bg-background px-2 py-1 text-xs"
              onChange={(e) => setStyle(e.target.value as Style)}
              value={style}
            >
              <option value="shadcn">shadcn/ui</option>
              <option value="tailwind">Tailwind</option>
              <option value="plain">Plain</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Framework:</span>
            <select
              aria-label="Framework"
              className="rounded border bg-background px-2 py-1 text-xs"
              onChange={(e) => setFramework(e.target.value as Framework)}
              value={framework}
            >
              <option value="react">React</option>
              <option value="nextjs">Next.js</option>
            </select>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground text-sm">
                  Describe a UI component
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  Generate production-ready React components in seconds
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTION_CHIPS.map((chip) => (
                  <button
                    className="rounded-full border px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:border-primary hover:text-primary"
                    key={chip}
                    onClick={() => handleGenerate(chip)}
                    type="button"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  key={msg.id}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border bg-card text-foreground"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isGenerating && (
                <div className="flex justify-start">
                  <div className="rounded-xl border bg-card px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Refinement chips */}
        {code && !isGenerating && (
          <div className="flex flex-wrap gap-1.5 border-t px-4 py-2">
            {[
              "Add dark mode",
              "Make responsive",
              "Add animations",
              "Add loading state",
            ].map((chip) => (
              <button
                className="rounded-full border px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:border-primary hover:text-primary"
                key={chip}
                onClick={() => handleGenerate(chip)}
                type="button"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 resize-none rounded-lg border bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                code
                  ? "Describe changes to make..."
                  : "Describe the UI you want..."
              }
              ref={inputRef}
              rows={2}
              style={{ maxHeight: "120px" }}
              value={input}
            />
            <button
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              disabled={!input.trim() || isGenerating}
              onClick={() => handleGenerate()}
              type="button"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Right panel: Preview + Code */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border bg-card">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <span className="font-medium text-sm">Preview</span>

          {/* Theme toggle */}
          <button
            aria-label={`Switch to ${previewTheme === "light" ? "dark" : "light"} theme`}
            className="ml-2 rounded border px-2 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
            onClick={() =>
              setPreviewTheme(previewTheme === "light" ? "dark" : "light")
            }
            type="button"
          >
            {previewTheme === "light" ? "Light" : "Dark"}
          </button>

          {/* Code toggle */}
          <button
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              showCode
                ? "border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setShowCode(!showCode)}
            type="button"
          >
            Code
          </button>

          <div className="ml-auto flex items-center gap-2">
            {code && (
              <>
                <button
                  aria-label="Copy code"
                  className="rounded border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={handleCopyCode}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Download component"
                  className="rounded border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={handleExport}
                  type="button"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label="Reset"
                  className="rounded border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={handleReset}
                  type="button"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Preview / Code area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {code ? (
            <>
              {/* Preview pane */}
              <div
                className={`${showCode ? "h-1/2" : "flex-1"} overflow-hidden p-4`}
              >
                <SandpackPreview code={code} theme={previewTheme} />
              </div>

              {/* Code pane */}
              {showCode && (
                <div className="h-1/2 border-t">
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <span className="text-muted-foreground text-xs">
                      component.tsx
                    </span>
                    <button
                      className="text-muted-foreground text-xs transition-colors hover:text-foreground"
                      onClick={handleCopyCode}
                      type="button"
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="h-[calc(100%-2.5rem)] overflow-auto p-4 text-xs leading-relaxed">
                    <code>{code}</code>
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <Sparkles className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm">
                Generated component will appear here
              </p>
              <p className="max-w-xs text-muted-foreground text-xs">
                Describe a UI component and it will be generated with a live
                preview in seconds
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
