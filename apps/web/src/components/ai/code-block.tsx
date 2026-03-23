"use client";

import { useCallback, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface AICodeBlockProps {
  className?: string;
  code: string;
  diffMode?: boolean;
  filename?: string;
  language?: string;
  maxHeight?: string;
  onCopy?: () => void;
  showLineNumbers?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Language detection heuristic                                                */
/* -------------------------------------------------------------------------- */

const LANGUAGE_PATTERNS: [RegExp, string][] = [
  [/^import .+ from ['"]/, "typescript"],
  [/^(const|let|var) .+=/, "javascript"],
  [/^def /, "python"],
  [/^fn /, "rust"],
  [/^func /, "go"],
  [/^package /, "java"],
  [/<\/?[a-z][\s\S]*>/i, "html"],
  [/^\s*\{[\s\S]*"[\w]+"/, "json"],
  [/^(SELECT|INSERT|UPDATE|DELETE|CREATE)\s/i, "sql"],
  [/^(apiVersion|kind):/, "yaml"],
  [/^#!\s*\//, "bash"],
];

function detectLanguage(code: string): string {
  const firstLine = code.trimStart().split("\n")[0] ?? "";
  for (const [pattern, lang] of LANGUAGE_PATTERNS) {
    if (pattern.test(firstLine)) {
      return lang;
    }
  }
  return "text";
}

/* -------------------------------------------------------------------------- */
/*  Diff rendering                                                             */
/* -------------------------------------------------------------------------- */

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+")) {
    return (
      <div className="bg-green-950/30 text-green-400">
        <span className="select-none pr-2 text-green-600">+</span>
        {line.slice(1)}
      </div>
    );
  }
  if (line.startsWith("-")) {
    return (
      <div className="bg-red-950/30 text-red-400">
        <span className="select-none pr-2 text-red-600">-</span>
        {line.slice(1)}
      </div>
    );
  }
  return (
    <div className="text-zinc-400">
      <span className="select-none pr-2 text-zinc-600">&nbsp;</span>
      {line}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function AICodeBlock({
  code,
  language,
  filename,
  showLineNumbers = true,
  diffMode = false,
  maxHeight = "400px",
  className = "",
  onCopy,
}: AICodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resolvedLanguage = language ?? detectLanguage(code);
  const lines = code.split("\n");
  const numberedLines = lines.map((text, idx) => ({ text, num: idx + 1 }));

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  }, [code, onCopy]);

  return (
    <div
      className={`overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-700 border-b bg-zinc-800/80 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {filename && (
            <span className="font-mono text-xs text-zinc-400">{filename}</span>
          )}
          <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 uppercase">
            {resolvedLanguage}
          </span>
          {diffMode && (
            <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] text-amber-400">
              diff
            </span>
          )}
        </div>
        <button
          className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Code area */}
      <div className="overflow-auto" style={{ maxHeight }}>
        <pre className="p-3 font-mono text-xs leading-5">
          {diffMode
            ? numberedLines.map(({ text, num }) => (
                <DiffLine key={`L${num}-${text.slice(0, 40)}`} line={text} />
              ))
            : numberedLines.map(({ text, num }) => (
                <div
                  className="text-zinc-300"
                  key={`L${num}-${text.slice(0, 40)}`}
                >
                  {showLineNumbers && (
                    <span className="mr-4 inline-block w-8 select-none text-right text-zinc-600">
                      {num}
                    </span>
                  )}
                  {text || " "}
                </div>
              ))}
        </pre>
      </div>
    </div>
  );
}
