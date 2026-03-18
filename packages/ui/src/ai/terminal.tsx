"use client";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

export interface TerminalLine {
  content: string;
  timestamp?: string;
}

interface TerminalProps {
  autoScroll?: boolean;
  className?: string;
  lines: TerminalLine[];
}

export function Terminal({
  lines,
  className,
  autoScroll = true,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [autoScroll]);

  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border bg-zinc-950 p-4 font-mono text-green-400 text-sm",
        className
      )}
      ref={containerRef}
    >
      {lines.map((line, i) => (
        <div className="whitespace-pre-wrap break-all leading-relaxed" key={i}>
          {line.timestamp && (
            <span className="mr-2 text-xs text-zinc-600">{line.timestamp}</span>
          )}
          <span>{line.content}</span>
        </div>
      ))}
      <div className="flex h-4 items-center">
        <span className="inline-block h-4 w-2 animate-pulse bg-green-400" />
      </div>
    </div>
  );
}

function _escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
