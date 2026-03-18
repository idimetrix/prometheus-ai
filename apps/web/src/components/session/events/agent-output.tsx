"use client";

import type { SessionEvent } from "@/stores/session.store";

interface AgentOutputProps {
  event: SessionEvent;
}

/**
 * Renders markdown-like content from the agent.
 * Supports basic formatting: bold, italic, code, links, headings.
 */
export function AgentOutput({ event }: AgentOutputProps) {
  const content = (event.data.content as string) ?? "";
  const timestamp = event.timestamp;

  // Simple inline markdown rendering
  function renderContent(text: string) {
    const lines = text.split("\n");

    return lines.map((line, i) => {
      // Headings
      if (line.startsWith("### ")) {
        return (
          <h4 className="mt-2 mb-1 font-semibold text-xs text-zinc-200" key={i}>
            {line.slice(4)}
          </h4>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h3 className="mt-2 mb-1 font-semibold text-sm text-zinc-100" key={i}>
            {line.slice(3)}
          </h3>
        );
      }
      if (line.startsWith("# ")) {
        return (
          <h2 className="mt-2 mb-1 font-bold text-sm text-zinc-100" key={i}>
            {line.slice(2)}
          </h2>
        );
      }

      // Code blocks (single backtick inline)
      const parts = line.split(/(`[^`]+`)/g);
      const rendered = parts.map((part, j) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-violet-300"
              key={j}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        // Bold
        const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
        return boldParts.map((bp, k) => {
          if (bp.startsWith("**") && bp.endsWith("**")) {
            return (
              <strong className="font-semibold text-zinc-100" key={`${j}-${k}`}>
                {bp.slice(2, -2)}
              </strong>
            );
          }
          return <span key={`${j}-${k}`}>{bp}</span>;
        });
      });

      // Empty line
      if (line.trim() === "") {
        return <div className="h-2" key={i} />;
      }

      // List items
      if (line.startsWith("- ") || line.startsWith("* ")) {
        return (
          <div className="flex gap-2 text-xs text-zinc-300" key={i}>
            <span className="text-zinc-600">-</span>
            <span>{rendered}</span>
          </div>
        );
      }

      return (
        <div className="text-xs text-zinc-300 leading-relaxed" key={i}>
          {rendered}
        </div>
      );
    });
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20">
          <svg
            className="h-3 w-3 text-violet-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="font-medium text-[10px] text-violet-400">Agent</span>
        {timestamp && (
          <span className="ml-auto text-[10px] text-zinc-600">
            {new Date(timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>
      <div className="space-y-0.5">{renderContent(content)}</div>
    </div>
  );
}
