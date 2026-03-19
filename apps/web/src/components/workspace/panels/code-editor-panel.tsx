"use client";

import { useMemo } from "react";
import { useSessionStore } from "@/stores/session.store";

const TOKEN_PATTERNS: Array<{ className: string; pattern: RegExp }> = [
  {
    pattern: /\/\/.*$/gm,
    className: "text-zinc-500 italic",
  },
  {
    pattern: /\/\*[\s\S]*?\*\//g,
    className: "text-zinc-500 italic",
  },
  {
    pattern: /(["'`])(?:(?=(\\?))\2[\s\S])*?\1/g,
    className: "text-amber-400",
  },
  {
    pattern:
      /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|interface|type|enum|async|await|try|catch|throw|new|switch|case|break|default|continue|do|in|of|typeof|instanceof|void|null|undefined|true|false)\b/g,
    className: "text-violet-400",
  },
  {
    pattern: /\b\d+(\.\d+)?\b/g,
    className: "text-cyan-400",
  },
];

interface TokenSpan {
  className: string;
  end: number;
  start: number;
  text: string;
}

function tokenizeLine(line: string): TokenSpan[] {
  const spans: TokenSpan[] = [];

  for (const { pattern, className } of TOKEN_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match = regex.exec(line);
    while (match) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        className,
      });
      match = regex.exec(line);
    }
  }

  spans.sort((a, b) => a.start - b.start);

  const merged: TokenSpan[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start < last.end) {
      continue;
    }
    merged.push(span);
  }

  return merged;
}

function HighlightedLine({ line }: { line: string }) {
  const tokens = useMemo(() => tokenizeLine(line), [line]);

  if (tokens.length === 0) {
    return <span>{line}</span>;
  }

  const parts: Array<{ className?: string; key: number; text: string }> = [];
  let cursor = 0;

  for (const token of tokens) {
    if (cursor < token.start) {
      parts.push({ key: cursor, text: line.slice(cursor, token.start) });
    }
    parts.push({
      key: token.start,
      text: token.text,
      className: token.className,
    });
    cursor = token.end;
  }

  if (cursor < line.length) {
    parts.push({ key: cursor, text: line.slice(cursor) });
  }

  return (
    <>
      {parts.map((p) => (
        <span className={p.className} key={p.key}>
          {p.text}
        </span>
      ))}
    </>
  );
}

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function CodeEditorPanel() {
  const openFiles = useSessionStore((s) => s.openFiles);
  const activeFilePath = useSessionStore((s) => s.activeFilePath);
  const setActiveFile = useSessionStore((s) => s.setActiveFile);
  const closeFile = useSessionStore((s) => s.closeFile);
  const events = useSessionStore((s) => s.events);

  const fileContent = useMemo(() => {
    if (!activeFilePath) {
      return null;
    }

    const codeEvent = events
      .slice()
      .reverse()
      .find(
        (e) =>
          (e.type === "code_change" || e.type === "file_diff") &&
          e.data.path === activeFilePath &&
          typeof e.data.content === "string"
      );

    if (codeEvent && typeof codeEvent.data.content === "string") {
      return codeEvent.data.content;
    }

    return null;
  }, [activeFilePath, events]);

  const lines = useMemo(() => {
    if (!fileContent) {
      return [];
    }
    return fileContent.split("\n");
  }, [fileContent]);

  if (openFiles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-950">
        <div className="text-sm text-zinc-600">No files open</div>
        <div className="mt-1 text-xs text-zinc-700">
          Files modified by agents will appear here
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Tab bar */}
      <div className="flex border-zinc-800 border-b bg-zinc-900/50">
        {openFiles.map((path) => (
          <div
            className={`group flex items-center gap-1.5 border-zinc-800 border-r px-3 py-1.5 text-xs ${
              path === activeFilePath
                ? "border-b-2 border-b-violet-500 bg-zinc-950 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={path}
          >
            <button
              className="truncate border-0 bg-transparent p-0 text-inherit"
              onClick={() => setActiveFile(path)}
              title={path}
              type="button"
            >
              {getFileName(path)}
            </button>
            <button
              className="ml-1 hidden rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300 group-hover:inline-flex"
              onClick={() => closeFile(path)}
              title="Close file"
              type="button"
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* File path bar */}
      {activeFilePath && (
        <div className="border-zinc-800 border-b px-3 py-1 text-[11px] text-zinc-600">
          {activeFilePath}
        </div>
      )}

      {/* Code content */}
      <div className="flex-1 overflow-auto">
        {lines.length > 0 ? (
          <pre className="p-0 font-mono text-xs leading-5">
            <code>
              {lines.map((line, idx) => (
                <div
                  className="flex hover:bg-zinc-900/50"
                  key={`line-${idx.toString()}`}
                >
                  <span className="sticky left-0 inline-block w-12 shrink-0 select-none bg-zinc-950 pr-3 text-right text-zinc-700">
                    {idx + 1}
                  </span>
                  <span className="flex-1 whitespace-pre pl-4 text-zinc-300">
                    <HighlightedLine line={line} />
                  </span>
                </div>
              ))}
            </code>
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            {activeFilePath
              ? "No content available for this file"
              : "Select a file to view"}
          </div>
        )}
      </div>
    </div>
  );
}
