"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CollaborationMessage,
  CollaborationParticipant,
} from "@/hooks/use-collaboration";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionChatProps {
  currentUserId: string;
  disabled?: boolean;
  messages: CollaborationMessage[];
  onSend: (content: string) => void;
  participants: CollaborationParticipant[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENDER_STYLES: Record<string, { badge: string; container: string }> = {
  user: {
    container: "ml-6 border-violet-500/20 bg-violet-500/10",
    badge: "bg-violet-500/20 text-violet-300",
  },
  agent: {
    container: "mr-6 border-emerald-500/20 bg-emerald-500/10",
    badge: "bg-emerald-500/20 text-emerald-300",
  },
  system: {
    container: "border-zinc-700 bg-zinc-800/30",
    badge: "bg-zinc-700 text-zinc-400",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionChat({
  messages,
  participants,
  currentUserId,
  onSend,
  disabled = false,
}: SessionChatProps) {
  const [input, setInput] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  const messageCount = messages.length;
  useEffect(() => {
    if (messageCount > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageCount]);

  // Mention filtering
  const filteredMentions = participants
    .filter((p) => p.userId !== currentUserId)
    .filter((p) =>
      mentionFilter
        ? p.name.toLowerCase().includes(mentionFilter.toLowerCase())
        : true
    );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);

      // Check for @ mentions
      const lastAtPos = value.lastIndexOf("@");
      if (lastAtPos >= 0) {
        const textAfterAt = value.slice(lastAtPos + 1);
        if (!textAfterAt.includes(" ")) {
          setShowMentions(true);
          setMentionFilter(textAfterAt);
          return;
        }
      }
      setShowMentions(false);
    },
    []
  );

  const insertMention = useCallback(
    (name: string) => {
      const lastAtPos = input.lastIndexOf("@");
      if (lastAtPos >= 0) {
        const newInput = `${input.slice(0, lastAtPos)}@${name} `;
        setInput(newInput);
      }
      setShowMentions(false);
      inputRef.current?.focus();
    },
    [input]
  );

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setInput("");
    setShowMentions(false);
    inputRef.current?.focus();
  }, [input, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        setShowMentions(false);
      }
    },
    [handleSend]
  );

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Session Chat</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {messages.length}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No messages yet. Start the conversation!
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg) => {
              const style = SENDER_STYLES[msg.sender] ??
                SENDER_STYLES.user ?? { container: "", badge: "" };
              const isSystem = msg.sender === "system";

              if (isSystem) {
                return (
                  <div
                    className="py-1 text-center text-[10px] text-zinc-500 italic"
                    key={msg.id}
                  >
                    {msg.content}
                  </div>
                );
              }

              return (
                <div
                  className={`rounded-lg border p-2.5 ${style.container}`}
                  key={msg.id}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-medium text-[10px] ${style.badge}`}
                    >
                      {msg.senderName}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-300 leading-relaxed">
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="relative border-zinc-800 border-t p-3">
        {/* Mentions dropdown */}
        {showMentions && filteredMentions.length > 0 && (
          <div className="absolute right-3 bottom-full left-3 mb-1 max-h-32 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
            {filteredMentions.map((p) => (
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                key={p.userId}
                onClick={() => insertMention(p.name)}
                type="button"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] text-white"
                  style={{
                    backgroundColor: getColorForUser(p.userId),
                  }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </span>
                <span>{p.name}</span>
                <span className="ml-auto text-[10px] text-zinc-600">
                  {p.role}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            aria-label="Type a message"
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (@ to mention)"
            ref={inputRef}
            rows={2}
            value={input}
          />
          <button
            className="shrink-0 self-end rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!input.trim() || disabled}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMessageContent(content: string): React.ReactNode {
  // Highlight @mentions
  const parts = content.split(/(@\w+(?:\s\w+)?)/g);
  return parts.map((part, i) => {
    const key = `${part.startsWith("@") ? "mention" : "text"}-${i.toString()}-${part.slice(0, 10)}`;
    if (part.startsWith("@")) {
      return (
        <span className="font-medium text-violet-400" key={key}>
          {part}
        </span>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

const USER_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

function getColorForUser(userId: string): string {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length] ?? "#8b5cf6";
}
