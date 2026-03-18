"use client";
import * as React from "react";
import { cn } from "../lib/utils";

interface ReasoningProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export function Reasoning({ content, isStreaming = false, className }: ReasoningProps) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={cn("rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-400 hover:text-zinc-300"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span className="font-medium">Reasoning</span>
        {isStreaming && (
          <span className="ml-auto flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            thinking...
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-zinc-800 px-3 py-2">
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
