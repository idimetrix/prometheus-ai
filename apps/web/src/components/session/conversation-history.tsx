"use client";

import { Badge, Button, Card, ScrollArea } from "@prometheus/ui";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BaseMessage {
  id: string;
  timestamp: string;
}

export interface UserMsg extends BaseMessage {
  content: string;
  type: "user";
}

export interface AgentMsg extends BaseMessage {
  /** Agent role (e.g. "coder", "architect") */
  agentRole: string;
  content: string;
  /** Model identifier (e.g. "claude-3.5-sonnet") */
  model?: string;
  /** Whether the message is still streaming */
  streaming?: boolean;
  /** Tokens consumed for this message */
  tokensUsed?: number;
  type: "agent";
}

export interface ToolCallMsg extends BaseMessage {
  args: Record<string, unknown>;
  durationMs?: number;
  name: string;
  result?: unknown;
  status: "running" | "success" | "error";
  type: "tool_call";
}

export type ConversationMessage = UserMsg | AgentMsg | ToolCallMsg;

interface ConversationHistoryProps {
  /** Whether the agent is actively streaming a response */
  isStreaming?: boolean;
  /** The conversation messages to display */
  messages: ConversationMessage[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
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

const TOOL_STATUS_STYLES: Record<string, { border: string; dot: string }> = {
  running: {
    border: "border-blue-500/30 bg-blue-500/5",
    dot: "bg-blue-400 animate-pulse",
  },
  success: {
    border: "border-green-500/30 bg-green-500/5",
    dot: "bg-green-400",
  },
  error: { border: "border-red-500/30 bg-red-500/5", dot: "bg-red-400" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      className="rounded px-1.5 py-0.5 text-[9px] text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
      onClick={handleCopy}
      type="button"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="group relative my-1.5 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
      <div className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-auto p-2.5 font-mono text-[11px] text-zinc-300 leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

function renderContentWithCodeBlocks(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const inner = part.slice(3, -3);
      const newlineIdx = inner.indexOf("\n");
      const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      return <CodeBlock code={code} key={`code-${String(idx)}`} />;
    }
    return (
      <span className="whitespace-pre-wrap" key={`text-${String(idx)}`}>
        {part}
      </span>
    );
  });
}

function UserBubble({ message }: { message: UserMsg }) {
  return (
    <div className="ml-12 rounded-lg border border-violet-500/20 bg-violet-500/10 p-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge className="bg-violet-500/20 text-violet-300" variant="secondary">
          you
        </Badge>
        <span className="ml-auto text-[10px] text-zinc-600">
          {formatTime(message.timestamp)}
        </span>
      </div>
      <div className="text-xs text-zinc-300 leading-relaxed">
        {message.content}
      </div>
    </div>
  );
}

function AgentBubble({ message }: { message: AgentMsg }) {
  const roleColor =
    ROLE_COLORS[message.agentRole] ?? "bg-zinc-700/50 text-zinc-400";

  return (
    <div className="mr-12 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge className={roleColor} variant="secondary">
          {message.agentRole}
        </Badge>
        {message.model && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
            {message.model}
          </span>
        )}
        {message.tokensUsed !== undefined && (
          <span className="font-mono text-[9px] text-zinc-600">
            {formatTokens(message.tokensUsed)} tok
          </span>
        )}
        <span className="ml-auto text-[10px] text-zinc-600">
          {formatTime(message.timestamp)}
        </span>
      </div>
      <div className="mt-1 text-xs text-zinc-300 leading-relaxed">
        {renderContentWithCodeBlocks(message.content)}
      </div>
      {message.streaming && (
        <div className="mt-2 flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
            style={{ animationDelay: "0.2s" }}
          />
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
            style={{ animationDelay: "0.4s" }}
          />
        </div>
      )}
    </div>
  );
}

function ToolCallBubble({ message }: { message: ToolCallMsg }) {
  const [expanded, setExpanded] = useState(false);
  const styles =
    TOOL_STATUS_STYLES[message.status] ?? TOOL_STATUS_STYLES.running;
  if (!styles) {
    return null;
  }

  return (
    <div className={`rounded-lg border p-3 ${styles.border}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${styles.dot}`} />
        <span className="font-mono text-xs text-zinc-200">{message.name}</span>
        {message.durationMs !== undefined && (
          <span className="font-mono text-[10px] text-zinc-500">
            {message.durationMs}ms
          </span>
        )}
        <span className="ml-auto text-[10px] text-zinc-600">
          {formatTime(message.timestamp)}
        </span>
      </div>

      <button
        className="mt-1.5 text-[10px] text-zinc-500 hover:text-zinc-300"
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

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 border-zinc-800 border-t px-4 py-2">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
        style={{ animationDelay: "0.2s" }}
      />
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
        style={{ animationDelay: "0.4s" }}
      />
      <span className="text-[10px] text-zinc-500">Agent is thinking...</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConversationHistory({
  messages,
  isStreaming = false,
}: ConversationHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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

  const renderMessage = (msg: ConversationMessage) => {
    switch (msg.type) {
      case "user":
        return <UserBubble key={msg.id} message={msg} />;
      case "agent":
        return <AgentBubble key={msg.id} message={msg} />;
      case "tool_call":
        return <ToolCallBubble key={msg.id} message={msg} />;
      default:
        return null;
    }
  };

  return (
    <Card className="flex h-full flex-col border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-violet-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-300">
          Conversation History
        </span>
        <Badge className="bg-zinc-800 text-zinc-500" variant="secondary">
          {messages.length}
        </Badge>

        {!autoScroll && (
          <Button
            className="ml-auto h-6 px-2 text-[10px]"
            onClick={() => {
              setAutoScroll(true);
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
            }}
            size="sm"
            variant="ghost"
          >
            Scroll to bottom
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="p-3" onScroll={handleScroll} ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-xs text-zinc-600">
              No messages yet
            </div>
          ) : (
            <div className="space-y-3">{messages.map(renderMessage)}</div>
          )}
        </div>
      </ScrollArea>

      {/* Streaming indicator */}
      {isStreaming && <StreamingIndicator />}
    </Card>
  );
}
