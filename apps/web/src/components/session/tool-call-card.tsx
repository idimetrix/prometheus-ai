"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallInfo {
  args: Record<string, unknown>;
  duration?: number;
  id: string;
  name: string;
  result?: unknown;
  status: "running" | "success" | "error" | "blocked";
}

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<
  string,
  { bg: string; border: string; dot: string; label: string }
> = {
  running: {
    bg: "bg-blue-500/5",
    border: "border-blue-500/30",
    dot: "bg-blue-400 animate-pulse",
    label: "Running",
  },
  success: {
    bg: "bg-green-500/5",
    border: "border-green-500/30",
    dot: "bg-green-400",
    label: "Success",
  },
  error: {
    bg: "bg-red-500/5",
    border: "border-red-500/30",
    dot: "bg-red-400",
    label: "Error",
  },
  blocked: {
    bg: "bg-yellow-500/5",
    border: "border-yellow-500/30",
    dot: "bg-yellow-400",
    label: "Blocked",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const style: { bg: string; border: string; dot: string; label: string } =
    STATUS_STYLES[toolCall.status] ?? {
      bg: "bg-blue-500/5",
      border: "border-blue-500/30",
      dot: "bg-blue-400 animate-pulse",
      label: "Running",
    };

  const toggleExpanded = useCallback(() => {
    setExpanded((p) => !p);
  }, []);

  const argsPreview = JSON.stringify(toolCall.args).slice(0, 100);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${style.bg} ${style.border}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <span className="font-medium font-mono text-xs text-zinc-200">
          {toolCall.name}
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {style.label}
        </span>
        {toolCall.duration !== undefined && (
          <span className="ml-auto font-mono text-[10px] text-zinc-500">
            {toolCall.duration}ms
          </span>
        )}
      </div>

      {/* Preview */}
      {!expanded && (
        <div className="mt-1.5 truncate font-mono text-[10px] text-zinc-500">
          {argsPreview}
          {argsPreview.length >= 100 ? "..." : ""}
        </div>
      )}

      {/* Expand/Collapse toggle */}
      <button
        className="mt-1.5 text-[10px] text-zinc-500 hover:text-zinc-300"
        onClick={toggleExpanded}
        type="button"
      >
        {expanded ? "Collapse" : "Expand details"}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 space-y-2">
          <div>
            <span className="font-medium text-[10px] text-zinc-500">
              Arguments
            </span>
            <pre className="mt-0.5 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div>
              <span className="font-medium text-[10px] text-zinc-500">
                Result
              </span>
              <pre
                className={`mt-0.5 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] ${
                  toolCall.status === "error" ? "text-red-300" : "text-zinc-400"
                }`}
              >
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
