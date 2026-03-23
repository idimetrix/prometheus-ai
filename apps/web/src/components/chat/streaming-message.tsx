"use client";

import { cn, MarkdownRenderer } from "@prometheus/ui";
import { useEffect, useRef, useState } from "react";

// ── Types ───────────────────────────────────────────────────────

interface StreamingMessageProps {
  agentRole?: string;
  className?: string;
  content: string;
  isStreaming: boolean;
  model?: string;
  role?: string;
}

// ── Typing indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" />
      <span
        className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
        style={{ animationDelay: "0.15s" }}
      />
      <span
        className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
        style={{ animationDelay: "0.3s" }}
      />
    </span>
  );
}

// ── Streaming cursor ────────────────────────────────────────────

function StreamingCursor() {
  return (
    <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-violet-400 align-text-bottom" />
  );
}

// ── Role badge ──────────────────────────────────────────────────

const ROLE_BADGE_STYLES: Record<string, string> = {
  user: "bg-violet-500/20 text-violet-300",
  assistant: "bg-green-500/20 text-green-300",
  system: "bg-blue-500/20 text-blue-300",
  architect: "bg-violet-500/20 text-violet-300",
  coder: "bg-green-500/20 text-green-300",
  reviewer: "bg-amber-500/20 text-amber-300",
  tester: "bg-cyan-500/20 text-cyan-300",
  deployer: "bg-rose-500/20 text-rose-300",
  planner: "bg-indigo-500/20 text-indigo-300",
};

// ── Incremental markdown rendering ──────────────────────────────

function IncrementalMarkdown({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  // For streaming, we attempt to render the markdown incrementally.
  // If the content ends mid-syntax, we close it gracefully.
  const safeContent = isStreaming ? sanitizePartialMarkdown(content) : content;

  return (
    <div className="relative">
      <MarkdownRenderer className="text-xs" content={safeContent} />
      {isStreaming && <StreamingCursor />}
    </div>
  );
}

/**
 * Sanitize partial markdown to prevent rendering artifacts during streaming.
 * Close unclosed code blocks and other common partial syntax.
 */
function sanitizePartialMarkdown(content: string): string {
  let result = content;

  // Count unclosed triple backtick code blocks
  const codeBlockMatches = result.match(/```/g);
  const codeBlockCount = codeBlockMatches?.length ?? 0;
  if (codeBlockCount % 2 !== 0) {
    result += "\n```";
  }

  // Count unclosed single backtick inline code
  const inlineCodeMatches = result.match(/(?<!`)`(?!`)/g);
  const inlineCodeCount = inlineCodeMatches?.length ?? 0;
  if (inlineCodeCount % 2 !== 0) {
    result += "`";
  }

  return result;
}

// ── Message content switcher ─────────────────────────────────────

function MessageContent({
  content,
  isStreaming,
  isUser,
}: {
  content: string;
  isStreaming: boolean;
  isUser: boolean;
}) {
  if (content.length === 0 && isStreaming) {
    return <TypingIndicator />;
  }

  if (isUser) {
    return (
      <div className="whitespace-pre-wrap text-xs text-zinc-300 leading-relaxed">
        {content}
      </div>
    );
  }

  return <IncrementalMarkdown content={content} isStreaming={isStreaming} />;
}

// ── Main component ──────────────────────────────────────────────

export function StreamingMessage({
  content,
  isStreaming,
  role = "assistant",
  model,
  agentRole,
  className,
}: StreamingMessageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const prevContentLengthRef = useRef(0);

  // Track approximate token count from content changes
  useEffect(() => {
    const newLength = content.length;
    if (newLength > prevContentLengthRef.current) {
      // Rough token estimate from character delta
      const delta = newLength - prevContentLengthRef.current;
      setTokenCount((prev) => prev + Math.ceil(delta / 4));
    }
    prevContentLengthRef.current = newLength;
  }, [content]);

  // Auto-scroll within the message container during streaming
  useEffect(() => {
    if (!(isStreaming && containerRef.current)) {
      return;
    }
    const container = containerRef.current;
    const parent = container.parentElement;
    if (parent) {
      parent.scrollTop = parent.scrollHeight;
    }
  }, [isStreaming]);

  const isUser = role === "user";
  const displayRole = agentRole ?? role;
  const badgeStyle =
    ROLE_BADGE_STYLES[displayRole] ??
    ROLE_BADGE_STYLES[role] ??
    "bg-zinc-700 text-zinc-300";

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        isUser
          ? "ml-8 border-violet-500/20 bg-violet-500/10"
          : "mr-8 border-zinc-800 bg-zinc-900/50",
        className
      )}
      ref={containerRef}
    >
      {/* Header */}
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium text-[10px]",
            badgeStyle
          )}
        >
          {displayRole}
        </span>

        {model && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {model}
          </span>
        )}

        {isStreaming && (
          <span className="flex items-center gap-1 text-[10px] text-violet-400">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
            streaming
          </span>
        )}

        {isStreaming && tokenCount > 0 && (
          <span className="text-[10px] text-zinc-600 tabular-nums">
            ~{tokenCount} tokens
          </span>
        )}

        <span className="ml-auto text-[10px] text-zinc-600">
          {new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {/* Content */}
      <div className="mt-1">
        <MessageContent
          content={content}
          isStreaming={isStreaming}
          isUser={isUser}
        />
      </div>
    </div>
  );
}
