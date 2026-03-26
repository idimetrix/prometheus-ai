"use client";

import { useCallback, useState } from "react";

interface ComponentExportProps {
  code: string;
  componentName?: string;
  dependencies?: string[];
}

export function ComponentExport({
  code,
  componentName = "Component",
  dependencies = [],
}: ComponentExportProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${componentName.toLowerCase().replace(/\s+/g, "-")}.tsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [code, componentName]);

  const cliCommand = `prometheus add ${componentName.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm text-zinc-300">Export</span>
      </div>

      {/* Code preview with copy */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-2">
          <span className="text-xs text-zinc-500">
            {componentName.toLowerCase().replace(/\s+/g, "-")}.tsx
          </span>
          <button
            className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={handleCopy}
            type="button"
          >
            {copied ? (
              <>
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="m4.5 12.75 6 6 9-13.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="text-green-400">Copied!</span>
              </>
            ) : (
              <>
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>
        <pre className="max-h-[200px] overflow-auto p-3 text-xs text-zinc-300 leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          className="flex items-center gap-1.5 rounded-lg bg-pink-600 px-3 py-2 text-white text-xs transition-colors hover:bg-pink-700"
          onClick={handleDownload}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Download .tsx
        </button>

        <button
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-zinc-600"
          onClick={handleCopy}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Copy Code
        </button>
      </div>

      {/* CLI install command */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-zinc-500">Install via CLI</span>
        <div className="flex items-center gap-2 rounded-lg bg-zinc-950 px-3 py-2">
          <code className="flex-1 text-xs text-zinc-300">{cliCommand}</code>
          <button
            aria-label="Copy CLI command"
            className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={() => navigator.clipboard.writeText(cliCommand)}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-zinc-500">Dependencies</span>
          <div className="flex flex-wrap gap-1.5">
            {dependencies.map((dep) => (
              <span
                className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
                key={dep}
              >
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
