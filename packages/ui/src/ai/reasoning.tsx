"use client";
import { useState } from "react";
import { cn } from "../lib/utils";

interface ReasoningProps {
  className?: string;
  content: string;
  isStreaming?: boolean;
}

export function Reasoning({
  content,
  isStreaming = false,
  className,
}: ReasoningProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-700 border-dashed bg-zinc-900/50",
        className
      )}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-400 hover:text-zinc-300"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span className="font-medium">Reasoning</span>
        {isStreaming && (
          <span className="ml-auto flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            thinking...
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-zinc-800 border-t px-3 py-2">
          <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-400 leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
