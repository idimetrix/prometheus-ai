"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamToken {
  id: string;
  text: string;
  type: "text" | "code" | "thinking";
}

export interface ToolCallEvent {
  args: Record<string, unknown>;
  id: string;
  name: string;
  result?: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface AIStreamRendererProps {
  /** Whether the stream is still active */
  isStreaming?: boolean;
  /** Called when user sends a message */
  onSend?: (message: string) => void;
  /** Stream of tokens to render */
  tokens: StreamToken[];
  /** Tool calls to display inline */
  toolCalls?: ToolCallEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL_STATUS_STYLES: Record<
  ToolCallEvent["status"],
  { bg: string; border: string; icon: string; label: string }
> = {
  pending: {
    bg: "bg-zinc-800",
    border: "border-zinc-700",
    icon: "text-zinc-500",
    label: "Pending",
  },
  running: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    icon: "text-blue-400",
    label: "Running",
  },
  completed: {
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    icon: "text-green-400",
    label: "Completed",
  },
  failed: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    icon: "text-red-400",
    label: "Failed",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StreamingCursor() {
  return (
    <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-violet-400" />
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCallEvent }) {
  const [expanded, setExpanded] = useState(false);
  const styles = TOOL_STATUS_STYLES[toolCall.status];

  return (
    <div
      className={`my-2 rounded-lg border ${styles.border} ${styles.bg} overflow-hidden`}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((p) => !p)}
        type="button"
      >
        {/* Status indicator */}
        {toolCall.status === "running" ? (
          <svg
            aria-hidden="true"
            className={`h-3.5 w-3.5 animate-spin ${styles.icon}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M4 12a8 8 0 0 1 16 0"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span className={`h-2 w-2 rounded-full ${styles.icon} bg-current`} />
        )}

        <span className="font-mono text-xs text-zinc-300">{toolCall.name}</span>
        <span className={`ml-auto text-[10px] ${styles.icon}`}>
          {styles.label}
        </span>

        <svg
          aria-hidden="true"
          className={`h-3 w-3 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="border-zinc-800/50 border-t px-3 py-2">
          {/* Arguments */}
          {Object.keys(toolCall.args).length > 0 && (
            <div className="mb-2">
              <span className="text-[10px] text-zinc-500 uppercase">
                Arguments
              </span>
              <pre className="mt-1 max-h-24 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {toolCall.result && (
            <div>
              <span className="text-[10px] text-zinc-500 uppercase">
                Result
              </span>
              <pre className="mt-1 max-h-24 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TokenRenderer({ token }: { token: StreamToken }) {
  if (token.type === "code") {
    return (
      <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-violet-300 text-xs">
        {token.text}
      </code>
    );
  }

  if (token.type === "thinking") {
    return <span className="text-xs text-zinc-500 italic">{token.text}</span>;
  }

  return <span className="text-xs text-zinc-300">{token.text}</span>;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AIStreamRenderer({
  tokens,
  toolCalls = [],
  isStreaming = false,
  onSend,
}: AIStreamRendererProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new tokens arrive
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

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed && onSend) {
      onSend(trimmed);
      setInputValue("");
    }
  }, [inputValue, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Build a merged timeline of tokens and tool calls by order
  const toolCallPositions = new Map<number, ToolCallEvent>();
  for (const tc of toolCalls) {
    // Insert tool calls between tokens based on index
    const idx = tokens.findIndex((t) => t.id === tc.id);
    toolCallPositions.set(idx >= 0 ? idx : tokens.length, tc);
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Stream output */}
      <div
        className="flex-1 overflow-auto px-4 py-3"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div className="max-w-2xl leading-relaxed">
          {tokens.map((token, idx) => (
            <span key={token.id}>
              <TokenRenderer token={token} />
              {toolCallPositions.has(idx) && (
                <ToolCallCard
                  toolCall={toolCallPositions.get(idx) as ToolCallEvent}
                />
              )}
            </span>
          ))}

          {/* Tool calls at the end */}
          {toolCalls
            .filter(
              (tc) =>
                !toolCallPositions.has(tokens.findIndex((t) => t.id === tc.id))
            )
            .map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}

          {isStreaming && <StreamingCursor />}
        </div>

        {!isStreaming && tokens.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            Waiting for response...
          </div>
        )}
      </div>

      {/* Input area */}
      {onSend && (
        <div className="border-zinc-800 border-t px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              value={inputValue}
            />
            <button
              className="rounded-lg bg-violet-600 px-3 py-2 text-white text-xs hover:bg-violet-500 disabled:opacity-50"
              disabled={!inputValue.trim() || isStreaming}
              onClick={handleSend}
              type="button"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
