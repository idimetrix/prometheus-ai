"use client";
import * as React from "react";
import { cn } from "../lib/utils";

interface TerminalProps {
  lines: Array<{ content: string; timestamp?: string }>;
  className?: string;
  autoScroll?: boolean;
}

export function Terminal({ lines, className, autoScroll = true }: TerminalProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "rounded-lg border bg-zinc-950 p-4 font-mono text-sm text-green-400 overflow-auto",
        className
      )}
    >
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
          {line.timestamp && (
            <span className="text-zinc-600 mr-2 text-xs">{line.timestamp}</span>
          )}
          <span dangerouslySetInnerHTML={{ __html: escapeHtml(line.content) }} />
        </div>
      ))}
      <div className="h-4 flex items-center">
        <span className="inline-block w-2 h-4 bg-green-400 animate-pulse" />
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
