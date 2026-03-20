"use client";

import { MarkdownRenderer } from "@prometheus/ui";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BaseMessage {
  id: string;
  timestamp: string;
}

export interface UserMessage extends BaseMessage {
  content: string;
  type: "user";
}

export interface AssistantMessage extends BaseMessage {
  agentRole?: string;
  content: string;
  streaming?: boolean;
  type: "assistant";
}

export interface ToolCallMessage extends BaseMessage {
  args: Record<string, unknown>;
  duration?: number;
  name: string;
  result?: unknown;
  status: "running" | "success" | "error" | "blocked";
  type: "tool_call";
}

export interface ToolResultMessage extends BaseMessage {
  content: string;
  isError?: boolean;
  toolCallId: string;
  type: "tool_result";
}

export interface ReasoningMessage extends BaseMessage {
  content: string;
  phase?: string;
  type: "reasoning";
}

export type ThreadMessage =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ToolResultMessage
  | ReasoningMessage;

interface MessageThreadProps {
  isStreaming: boolean;
  messages: ThreadMessage[];
  onRetry?: (messageId: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_BADGE_COLORS: Record<string, string> = {
  architect: "bg-violet-500/20 text-violet-300",
  coder: "bg-green-500/20 text-green-300",
  reviewer: "bg-amber-500/20 text-amber-300",
  tester: "bg-cyan-500/20 text-cyan-300",
  deployer: "bg-rose-500/20 text-rose-300",
  planner: "bg-indigo-500/20 text-indigo-300",
  orchestrator: "bg-violet-500/20 text-violet-300",
  "frontend-coder": "bg-cyan-500/20 text-cyan-300",
  "backend-coder": "bg-green-500/20 text-green-300",
  "security-auditor": "bg-red-500/20 text-red-300",
};

const TOOL_STATUS_COLORS: Record<string, string> = {
  running: "border-blue-500/30 bg-blue-500/5",
  success: "border-green-500/30 bg-green-500/5",
  error: "border-red-500/30 bg-red-500/5",
  blocked: "border-yellow-500/30 bg-yellow-500/5",
};

const TOOL_STATUS_DOT: Record<string, string> = {
  running: "bg-blue-400 animate-pulse",
  success: "bg-green-400",
  error: "bg-red-400",
  blocked: "bg-yellow-400",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StreamingDots() {
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

function Timestamp({ value }: { value: string }) {
  return (
    <span className="ml-auto text-[10px] text-zinc-600">
      {new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  );
}

function UserBubble({
  message,
  onRetry,
}: {
  message: UserMessage;
  onRetry?: (id: string) => void;
}) {
  return (
    <div className="ml-8 rounded-lg border border-violet-500/20 bg-violet-500/10 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-full bg-violet-500/20 px-2 py-0.5 font-medium text-[10px] text-violet-300">
          you
        </span>
        <Timestamp value={message.timestamp} />
      </div>
      <div className="text-xs text-zinc-300 leading-relaxed">
        {message.content}
      </div>
      {onRetry && (
        <button
          className="mt-1.5 text-[10px] text-zinc-600 hover:text-zinc-400"
          onClick={() => onRetry(message.id)}
          type="button"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function AssistantBubble({ message }: { message: AssistantMessage }) {
  const roleBadge = message.agentRole
    ? (ROLE_BADGE_COLORS[message.agentRole] ?? "bg-zinc-700 text-zinc-300")
    : null;

  return (
    <div className="mr-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-1 flex items-center gap-2">
        {message.agentRole && roleBadge && (
          <span
            className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${roleBadge}`}
          >
            {message.agentRole}
          </span>
        )}
        {!message.agentRole && (
          <span className="rounded-full bg-zinc-700 px-2 py-0.5 font-medium text-[10px] text-zinc-300">
            assistant
          </span>
        )}
        <Timestamp value={message.timestamp} />
      </div>
      <div className="mt-1">
        <MarkdownRenderer className="text-xs" content={message.content} />
      </div>
      {message.streaming && (
        <div className="mt-2">
          <StreamingDots />
        </div>
      )}
    </div>
  );
}

function ToolCallBubble({ message }: { message: ToolCallMessage }) {
  const [expanded, setExpanded] = useState(false);
  const statusColor =
    TOOL_STATUS_COLORS[message.status] ?? TOOL_STATUS_COLORS.running;
  const dotColor = TOOL_STATUS_DOT[message.status] ?? TOOL_STATUS_DOT.running;

  return (
    <div className={`rounded-lg border p-3 ${statusColor}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="font-mono text-xs text-zinc-200">{message.name}</span>
        {message.duration !== undefined && (
          <span className="font-mono text-[10px] text-zinc-500">
            {message.duration}ms
          </span>
        )}
        <Timestamp value={message.timestamp} />
      </div>
      <button
        className="mt-1 text-[10px] text-zinc-500 hover:text-zinc-300"
        onClick={() => setExpanded((p) => !p)}
        type="button"
      >
        {expanded ? "Hide details" : "Show details"}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <div>
            <span className="text-[10px] text-zinc-600">Arguments</span>
            <pre className="mt-0.5 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
              {JSON.stringify(message.args, null, 2)}
            </pre>
          </div>
          {message.result !== undefined && (
            <div>
              <span className="text-[10px] text-zinc-600">Result</span>
              <pre className="mt-0.5 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
                {typeof message.result === "string"
                  ? message.result
                  : JSON.stringify(message.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolResultBubble({ message }: { message: ToolResultMessage }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        message.isError
          ? "border-red-500/30 bg-red-500/5"
          : "border-green-500/30 bg-green-500/5"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${
            message.isError
              ? "bg-red-500/20 text-red-300"
              : "bg-green-500/20 text-green-300"
          }`}
        >
          {message.isError ? "error" : "result"}
        </span>
        <Timestamp value={message.timestamp} />
      </div>
      <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-400 leading-relaxed">
        {message.content}
      </pre>
    </div>
  );
}

function ReasoningBubble({ message }: { message: ReasoningMessage }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
      <button
        className="flex w-full items-center gap-2"
        onClick={() => setCollapsed((p) => !p)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={`h-3 w-3 text-indigo-400 transition-transform ${collapsed ? "" : "rotate-90"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 font-medium text-[10px] text-indigo-300">
          reasoning
        </span>
        {message.phase && (
          <span className="text-[10px] text-indigo-400/60">
            {message.phase}
          </span>
        )}
        <Timestamp value={message.timestamp} />
      </button>
      {!collapsed && (
        <div className="mt-2 text-xs text-zinc-400 leading-relaxed">
          <MarkdownRenderer className="text-xs" content={message.content} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MessageThread({
  messages,
  isStreaming,
  onRetry,
}: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  const renderMessage = (msg: ThreadMessage) => {
    switch (msg.type) {
      case "user":
        return <UserBubble key={msg.id} message={msg} onRetry={onRetry} />;
      case "assistant":
        return <AssistantBubble key={msg.id} message={msg} />;
      case "tool_call":
        return <ToolCallBubble key={msg.id} message={msg} />;
      case "tool_result":
        return <ToolResultBubble key={msg.id} message={msg} />;
      case "reasoning":
        return <ReasoningBubble key={msg.id} message={msg} />;
      default:
        break;
    }
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div
        className="flex-1 overflow-auto p-3"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No messages yet
          </div>
        ) : (
          <div className="space-y-3">{messages.map(renderMessage)}</div>
        )}
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="border-zinc-800 border-t px-4 py-2">
          <div className="flex items-center gap-2">
            <StreamingDots />
            <span className="text-[10px] text-zinc-500">
              Agent is thinking...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
