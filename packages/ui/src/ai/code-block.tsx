"use client";
import { useState } from "react";
import { cn } from "../lib/utils";

interface CodeBlockProps {
  className?: string;
  code: string;
  filename?: string;
  language?: string;
  showLineNumbers?: boolean;
}

export function CodeBlock({
  code,
  language = "typescript",
  filename,
  showLineNumbers = true,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn("overflow-hidden rounded-lg border bg-zinc-950", className)}
    >
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          {filename && (
            <span className="font-mono text-xs text-zinc-400">{filename}</span>
          )}
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
            {language}
          </span>
        </div>
        <button
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="overflow-x-auto p-3">
        <pre className="font-mono text-sm">
          {Array.from(lines.entries()).map(([lineNum, line]) => (
            <div className="flex" key={`line-${lineNum}`}>
              {showLineNumbers && (
                <span className="mr-4 w-8 shrink-0 select-none text-right text-zinc-600">
                  {lineNum + 1}
                </span>
              )}
              <code className="text-zinc-200">{line || " "}</code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
