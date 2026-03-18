"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useSessionStore } from "@/stores/session.store";

interface Message {
  content: string;
  id: string;
  role: "user" | "assistant";
  timestamp: string;
}

interface AskModeProps {
  sessionId: string;
}

export function AskMode({ sessionId }: AskModeProps) {
  const { events } = useSessionStore();
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = trpc.sessions.sendMessage.useMutation();

  // Derive messages from session events
  const messages: Message[] = events
    .filter(
      (e) =>
        e.type === "message" || e.type === "chat_message" || e.type === "answer"
    )
    .map((e) => ({
      id: e.id,
      role: (e.data?.role as "user" | "assistant") ?? "assistant",
      content: String(e.data?.content ?? e.data?.message ?? ""),
      timestamp: e.timestamp,
    }));

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isSending) {
      return;
    }

    const text = input.trim();
    setInput("");
    setIsSending(true);

    try {
      await sendMessage.mutateAsync({
        sessionId,
        content: text,
      });
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  }, [input, isSending, sendMessage, sessionId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-4 py-3">
        <svg
          className="h-4 w-4 text-violet-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-sm text-zinc-200">Ask Mode</span>
        <span className="ml-auto text-xs text-zinc-500">
          {messages.length} messages
        </span>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-auto p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
              <svg
                className="h-6 w-6 text-violet-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-sm text-zinc-400">
              Ask anything about your codebase
            </p>
            <p className="text-xs text-zinc-600">
              The agent will analyze your code and answer questions
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
                key={msg.id}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-violet-600 text-white"
                      : "border border-zinc-800 bg-zinc-900 text-zinc-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {msg.content}
                  </p>
                  <div
                    className={`mt-1.5 text-[10px] ${
                      msg.role === "user"
                        ? "text-violet-200/60"
                        : "text-zinc-600"
                    }`}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
            {isSending && (
              <div className="flex justify-start">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:0.15s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:0.3s]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-zinc-800 border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your question..."
            ref={inputRef}
            rows={1}
            style={{ maxHeight: "120px" }}
            value={input}
          />
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
            disabled={!input.trim() || isSending}
            onClick={handleSend}
            type="button"
          >
            <svg
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
        <p className="mt-1.5 text-[10px] text-zinc-600">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
