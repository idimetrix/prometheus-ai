"use client";
import * as React from "react";
import { cn } from "../lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  className?: string;
}

export function CodeBlock({
  code,
  language = "typescript",
  filename,
  showLineNumbers = true,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const lines = code.split("\n");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("rounded-lg border bg-zinc-950 overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {filename && <span className="text-xs text-zinc-400 font-mono">{filename}</span>}
          <span className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="overflow-x-auto p-3">
        <pre className="text-sm font-mono">
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {showLineNumbers && (
                <span className="select-none text-right text-zinc-600 w-8 mr-4 shrink-0">
                  {i + 1}
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
