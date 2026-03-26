"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { trpc } from "@/lib/trpc";
import { useSessionStore } from "@/stores/session.store";

type Viewport = "desktop" | "tablet" | "mobile";
type Theme = "light" | "dark";

interface DesignModeProps {
  sessionId: string;
}

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

const SUGGESTION_CHIPS = [
  "Add responsive design",
  "Add dark mode",
  "Add animation",
  "Add loading state",
];

export function DesignMode({ sessionId }: DesignModeProps) {
  const { events } = useSessionStore();
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [theme, setTheme] = useState<Theme>("light");
  const [previewUrl, _setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sendMessage = trpc.sessions.sendMessage.useMutation();

  // Extract generated code from events
  useEffect(() => {
    const codeEvents = events.filter(
      (e) =>
        e.type === "agent_output" &&
        (e.data?.phase === "component_ready" || e.data?.code)
    );
    const latest = codeEvents.at(-1);
    if (latest?.data?.component) {
      setGeneratedCode(String(latest.data.component));
    } else if (latest?.data?.code) {
      setGeneratedCode(String(latest.data.code));
    }
  }, [events]);

  const handleSend = useCallback(
    async (text?: string) => {
      const message = text ?? input.trim();
      if (!message || isSending) {
        return;
      }

      setInput("");
      setIsSending(true);

      try {
        await sendMessage.mutateAsync({
          sessionId,
          content: message,
        });
      } catch (err) {
        logger.error("Failed to send design message:", err);
      } finally {
        setIsSending(false);
        inputRef.current?.focus();
      }
    },
    [input, isSending, sendMessage, sessionId]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleCopyCode() {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
    }
  }

  function handleExport() {
    if (!generatedCode) {
      return;
    }
    const blob = new Blob([generatedCode], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "component.tsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Derive messages from session events
  const messages = events
    .filter(
      (e) =>
        e.type === "message" ||
        e.type === "chat_message" ||
        e.type === "answer" ||
        e.type === "agent_output"
    )
    .map((e) => ({
      id: e.id,
      role: (e.data?.role as "user" | "assistant") ?? "assistant",
      content: String(
        e.data?.content ?? e.data?.message ?? e.data?.output ?? ""
      ),
      timestamp: e.timestamp,
    }));

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      {/* Left panel: Chat + Input */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
        {/* Header */}
        <div className="flex items-center gap-2 border-zinc-800 border-b px-4 py-3">
          <svg
            aria-hidden="true"
            className="h-4 w-4 text-pink-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-medium text-sm text-zinc-200">Design Mode</span>
          <span className="ml-auto text-xs text-zinc-500">
            {messages.length} messages
          </span>
        </div>

        {/* Messages list */}
        <div className="flex-1 overflow-auto p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pink-500/10">
                <svg
                  aria-hidden="true"
                  className="h-6 w-6 text-pink-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-sm text-zinc-400">
                Describe the UI component you want to create
              </p>
              <p className="text-xs text-zinc-600">
                The agent will generate React + Tailwind code with shadcn/ui
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  key={msg.id}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-pink-600 text-white"
                        : "border border-zinc-800 bg-zinc-900 text-zinc-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ))}
              {isSending && (
                <div className="flex justify-start">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-400" />
                      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-400 [animation-delay:0.15s]" />
                      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-400 [animation-delay:0.3s]" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Suggestion chips */}
        {generatedCode && (
          <div className="flex flex-wrap gap-2 border-zinc-800 border-t px-4 py-2">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-pink-500 hover:text-pink-400"
                key={chip}
                onClick={() => handleSend(chip)}
                type="button"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="border-zinc-800 border-t p-3">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-pink-500"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the UI component you want..."
              ref={inputRef}
              rows={2}
              style={{ maxHeight: "120px" }}
              value={input}
            />
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pink-600 text-white transition-colors hover:bg-pink-700 disabled:opacity-50"
              disabled={!input.trim() || isSending}
              onClick={() => handleSend()}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Right panel: Preview + Code */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-zinc-800 border-b px-4 py-2">
          {/* Viewport selector */}
          <div className="flex items-center gap-1 rounded-lg bg-zinc-800 p-0.5">
            {(["desktop", "tablet", "mobile"] as const).map((vp) => (
              <button
                aria-label={`${vp} viewport`}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  viewport === vp
                    ? "bg-zinc-700 text-zinc-200"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                key={vp}
                onClick={() => setViewport(vp)}
                type="button"
              >
                {vp === "desktop" && "Desktop"}
                {vp === "tablet" && "Tablet"}
                {vp === "mobile" && "Mobile"}
              </button>
            ))}
          </div>

          {/* Theme toggle */}
          <button
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            className="ml-2 rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:text-zinc-200"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            type="button"
          >
            {theme === "light" ? (
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {/* Iterate button */}
            {generatedCode && (
              <button
                className="rounded-lg border border-pink-500/30 px-3 py-1.5 text-pink-400 text-xs transition-colors hover:bg-pink-500/10"
                onClick={() => inputRef.current?.focus()}
                type="button"
              >
                Iterate
              </button>
            )}

            {/* Export button */}
            {generatedCode && (
              <button
                className="rounded-lg bg-pink-600 px-3 py-1.5 text-white text-xs transition-colors hover:bg-pink-700"
                onClick={handleExport}
                type="button"
              >
                Export
              </button>
            )}
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-auto p-4">
          {generatedCode ? (
            <div className="flex flex-col gap-4">
              {/* Live preview iframe */}
              <div
                className="mx-auto overflow-hidden rounded-lg border border-zinc-700 bg-white"
                style={{ width: VIEWPORT_WIDTHS[viewport] }}
              >
                {previewUrl ? (
                  <iframe
                    className="h-[400px] w-full border-0"
                    sandbox="allow-scripts allow-same-origin"
                    src={previewUrl}
                    title="Component preview"
                  />
                ) : (
                  <div className="flex h-[400px] items-center justify-center bg-zinc-50 text-sm text-zinc-500">
                    Preview will appear here when sandbox is ready
                  </div>
                )}
              </div>

              {/* Code display */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950">
                <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-2">
                  <span className="text-xs text-zinc-500">component.tsx</span>
                  <button
                    className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                    onClick={handleCopyCode}
                    type="button"
                  >
                    Copy
                  </button>
                </div>
                <pre className="max-h-[300px] overflow-auto p-4 text-xs text-zinc-300 leading-relaxed">
                  <code>{generatedCode}</code>
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
                <svg
                  aria-hidden="true"
                  className="h-8 w-8 text-zinc-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M14.25 9.75 16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-sm text-zinc-500">
                Generated component will appear here
              </p>
              <p className="max-w-xs text-xs text-zinc-600">
                Describe a UI component in the chat and the agent will generate
                React + Tailwind code with a live preview
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
