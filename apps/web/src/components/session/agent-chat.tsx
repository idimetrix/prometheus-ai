"use client";

import { MarkdownRenderer } from "@prometheus/ui";
import { useCallback, useEffect, useRef, useState } from "react";

type MessageType = "user" | "agent" | "system" | "error";

export interface ChatMessage {
  agentRole?: string;
  content: string;
  id: string;
  streaming?: boolean;
  timestamp: string;
  type: MessageType;
}

interface AgentChatProps {
  messages?: ChatMessage[];
  onSendMessage: (content: string) => void;
  sessionId: string;
}

const MESSAGE_TYPE_STYLES: Record<MessageType, string> = {
  user: "bg-violet-500/10 border-violet-500/20",
  agent: "bg-zinc-900/50 border-zinc-800",
  system: "bg-blue-500/5 border-blue-500/20",
  error: "bg-red-500/5 border-red-500/20",
};

const ROLE_BADGE_COLORS: Record<string, string> = {
  architect: "bg-violet-500/20 text-violet-300",
  coder: "bg-green-500/20 text-green-300",
  reviewer: "bg-amber-500/20 text-amber-300",
  tester: "bg-cyan-500/20 text-cyan-300",
  deployer: "bg-rose-500/20 text-rose-300",
  planner: "bg-indigo-500/20 text-indigo-300",
};

function StreamingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
        style={{ animationDelay: "0.2s" }}
      />
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
        style={{ animationDelay: "0.4s" }}
      />
    </span>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.type === "user";
  const styleClass =
    MESSAGE_TYPE_STYLES[message.type] ?? MESSAGE_TYPE_STYLES.agent;
  const roleBadgeColor = message.agentRole
    ? (ROLE_BADGE_COLORS[message.agentRole] ?? "bg-zinc-700 text-zinc-300")
    : null;

  return (
    <div
      className={`rounded-lg border p-3 ${styleClass} ${isUser ? "ml-8" : "mr-8"}`}
    >
      <div className="mb-1 flex items-center gap-2">
        {message.type === "agent" && message.agentRole && roleBadgeColor && (
          <span
            className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${roleBadgeColor}`}
          >
            {message.agentRole}
          </span>
        )}
        {message.type === "system" && (
          <span className="rounded-full bg-blue-500/20 px-2 py-0.5 font-medium text-[10px] text-blue-300">
            system
          </span>
        )}
        {message.type === "error" && (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-medium text-[10px] text-red-300">
            error
          </span>
        )}
        {isUser && (
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 font-medium text-[10px] text-violet-300">
            you
          </span>
        )}
        <span className="ml-auto text-[10px] text-zinc-600">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="mt-1">
        {message.type === "agent" || message.type === "system" ? (
          <MarkdownRenderer className="text-xs" content={message.content} />
        ) : (
          <div
            className={`text-xs leading-relaxed ${
              message.type === "error" ? "text-red-300" : "text-zinc-300"
            }`}
          >
            {message.content}
          </div>
        )}
      </div>
      {message.streaming && (
        <div className="mt-2">
          <StreamingIndicator />
        </div>
      )}
    </div>
  );
}

export function AgentChat({
  sessionId: _sessionId,
  onSendMessage,
  messages = [],
}: AgentChatProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-auto p-3" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No messages yet
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-zinc-800 border-t p-3">
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the agent... (Shift+Enter for newline)"
            ref={inputRef}
            rows={2}
            value={input}
          />
          <button
            className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
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
