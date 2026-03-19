"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatRole = "user" | "agent" | "system";

export interface ChatMessage {
  content: string;
  id: string;
  role: ChatRole;
  timestamp: string;
}

interface ChatPanelProps {
  isTyping?: boolean;
  messages?: ChatMessage[];
  onSendMessage: (content: string) => void;
}

const ROLE_STYLES: Record<ChatRole, { badge: string; bubble: string }> = {
  user: {
    badge: "bg-violet-500/20 text-violet-300",
    bubble: "bg-violet-500/10 border-violet-500/20 ml-8",
  },
  agent: {
    badge: "bg-green-500/20 text-green-300",
    bubble: "bg-zinc-900/50 border-zinc-800 mr-8",
  },
  system: {
    badge: "bg-blue-500/20 text-blue-300",
    bubble: "bg-blue-500/5 border-blue-500/20",
  },
};

function TypingIndicator() {
  return (
    <div className="mr-8 flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
      <span
        className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500"
        style={{ animationDelay: "0.15s" }}
      />
      <span
        className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500"
        style={{ animationDelay: "0.3s" }}
      />
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const styles = ROLE_STYLES[message.role] ?? ROLE_STYLES.agent;

  return (
    <div className={`rounded-lg border p-3 ${styles.bubble}`}>
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${styles.badge}`}
        >
          {message.role}
        </span>
        <span className="ml-auto text-[10px] text-zinc-600">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-xs text-zinc-300 leading-relaxed">
        {message.content}
      </div>
    </div>
  );
}

export function ChatPanel({
  messages = [],
  onSendMessage,
  isTyping = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    onSendMessage(trimmed);
    setInput("");
    inputRef.current?.focus();
  }, [input, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Auto-scroll to bottom on new messages or typing indicator
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          Chat
        </h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3" ref={scrollRef}>
        {messages.length === 0 && !isTyping ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No messages yet. Start a conversation.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isTyping && <TypingIndicator />}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-zinc-800 border-t p-3">
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Shift+Enter for newline)"
            ref={inputRef}
            rows={2}
            value={input}
          />
          <button
            className="shrink-0 self-end rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!input.trim()}
            onClick={handleSend}
            type="button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
