"use client";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils";

// ── Types ───────────────────────────────────────────────────────

export type FileChangeType = "create" | "modify" | "delete" | "rename";

export interface DiffFile {
  changeType: FileChangeType;
  diff: string;
  filePath: string;
  /** Optional language hint for syntax class */
  language?: string;
  /** Optional old path for renames */
  oldPath?: string;
}

interface CodeDiffProps {
  /** If provided, only show this file index */
  activeFileIndex?: number;
  className?: string;
  files: DiffFile[];
  /** Callback when user navigates files */
  onFileChange?: (index: number) => void;
}

// ── Change type styling ─────────────────────────────────────────

const CHANGE_TYPE_STYLES: Record<
  FileChangeType,
  { label: string; badge: string; icon: string }
> = {
  create: {
    label: "Created",
    badge: "bg-green-500/10 text-green-400 border-green-500/20",
    icon: "+",
  },
  modify: {
    label: "Modified",
    badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    icon: "M",
  },
  delete: {
    label: "Deleted",
    badge: "bg-red-500/10 text-red-400 border-red-500/20",
    icon: "-",
  },
  rename: {
    label: "Renamed",
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    icon: "R",
  },
};

// ── Diff line parser ────────────────────────────────────────────

interface DiffLine {
  content: string;
  newLineNum: number | null;
  oldLineNum: number | null;
  type: "addition" | "deletion" | "context" | "hunk" | "header";
}

const _HUNK_HEADER_RE = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function isHeaderLine(line: string): boolean {
  return (
    line.startsWith("---") ||
    line.startsWith("+++") ||
    line.startsWith("diff ") ||
    line.startsWith("index ")
  );
}

function parseDiffLine(
  line: string,
  lineNums: { oldLine: number; newLine: number }
): DiffLine | null {
  if (line.startsWith("@@")) {
    const hunkMatch = line.match(_HUNK_HEADER_RE);
    if (hunkMatch) {
      lineNums.oldLine = Number.parseInt(hunkMatch[1] ?? "0", 10);
      lineNums.newLine = Number.parseInt(hunkMatch[2] ?? "0", 10);
    }
    return { type: "hunk", content: line, oldLineNum: null, newLineNum: null };
  }

  if (isHeaderLine(line)) {
    return {
      type: "header",
      content: line,
      oldLineNum: null,
      newLineNum: null,
    };
  }

  if (line.startsWith("+")) {
    const dl: DiffLine = {
      type: "addition",
      content: line.slice(1),
      oldLineNum: null,
      newLineNum: lineNums.newLine,
    };
    lineNums.newLine++;
    return dl;
  }

  if (line.startsWith("-")) {
    const dl: DiffLine = {
      type: "deletion",
      content: line.slice(1),
      oldLineNum: lineNums.oldLine,
      newLineNum: null,
    };
    lineNums.oldLine++;
    return dl;
  }

  const content = line.startsWith(" ") ? line.slice(1) : line;
  if (line.trim() === "" && lineNums.oldLine === 0 && lineNums.newLine === 0) {
    return null;
  }

  const dl: DiffLine = {
    type: "context",
    content,
    oldLineNum: lineNums.oldLine || null,
    newLineNum: lineNums.newLine || null,
  };
  if (lineNums.oldLine) {
    lineNums.oldLine++;
  }
  if (lineNums.newLine) {
    lineNums.newLine++;
  }
  return dl;
}

function parseDiffLines(diff: string): DiffLine[] {
  const raw = diff.split("\n");
  const result: DiffLine[] = [];
  const lineNums = { oldLine: 0, newLine: 0 };

  for (const line of raw) {
    const parsed = parseDiffLine(line, lineNums);
    if (parsed) {
      result.push(parsed);
    }
  }

  return result;
}

// ── Single Diff File View ───────────────────────────────────────

function DiffFileView({ file }: { file: DiffFile }) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => parseDiffLines(file.diff), [file.diff]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.type === "addition") {
        additions++;
      }
      if (line.type === "deletion") {
        deletions++;
      }
    }
    return { additions, deletions };
  }, [lines]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(file.diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const style = CHANGE_TYPE_STYLES[file.changeType];

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      {/* File header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <button
          className="text-zinc-500 transition-colors hover:text-zinc-300"
          onClick={() => setCollapsed(!collapsed)}
          type="button"
        >
          <svg
            aria-hidden="true"
            className={cn(
              "h-3 w-3 transition-transform",
              collapsed ? "-rotate-90" : "rotate-0"
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="m19.5 8.25-7.5 7.5-7.5-7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <span
          className={cn(
            "inline-flex items-center justify-center rounded border px-1.5 py-0.5 font-bold text-[10px]",
            style.badge
          )}
        >
          {style.icon}
        </span>

        <span className="truncate font-mono text-xs text-zinc-300">
          {file.filePath}
        </span>

        {file.oldPath && file.changeType === "rename" && (
          <span className="truncate font-mono text-[10px] text-zinc-600">
            (from {file.oldPath})
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {stats.additions > 0 && (
            <span className="font-mono text-[10px] text-green-400">
              +{stats.additions}
            </span>
          )}
          {stats.deletions > 0 && (
            <span className="font-mono text-[10px] text-red-400">
              -{stats.deletions}
            </span>
          )}
          <button
            className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-300"
            onClick={handleCopy}
            type="button"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Diff content */}
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px] leading-[1.6]">
            <tbody>
              {Array.from(lines.entries()).map(([lineIdx, line]) => {
                if (line.type === "header") {
                  return null;
                }

                return (
                  <tr
                    className={cn(
                      line.type === "addition" && "bg-green-500/[0.07]",
                      line.type === "deletion" && "bg-red-500/[0.07]",
                      line.type === "hunk" && "bg-violet-500/[0.05]"
                    )}
                    key={`diff-${lineIdx}-${line.oldLineNum ?? "x"}-${line.newLineNum ?? "x"}`}
                  >
                    {/* Old line number */}
                    <td className="w-[1px] select-none whitespace-nowrap border-zinc-800/50 border-r px-2 text-right text-zinc-600">
                      {line.oldLineNum ?? ""}
                    </td>
                    {/* New line number */}
                    <td className="w-[1px] select-none whitespace-nowrap border-zinc-800/50 border-r px-2 text-right text-zinc-600">
                      {line.newLineNum ?? ""}
                    </td>
                    {/* Sign indicator */}
                    <td className="w-[1px] select-none whitespace-nowrap px-1">
                      <span
                        className={cn(
                          line.type === "addition" && "text-green-400",
                          line.type === "deletion" && "text-red-400",
                          line.type === "hunk" && "text-violet-400",
                          line.type === "context" && "text-zinc-700"
                        )}
                      >
                        {(
                          { addition: "+", deletion: "-", hunk: "" } as Record<
                            string,
                            string
                          >
                        )[line.type] ?? " "}
                      </span>
                    </td>
                    {/* Content */}
                    <td
                      className={cn(
                        "whitespace-pre-wrap break-all px-2 py-0",
                        line.type === "addition" && "text-green-300",
                        line.type === "deletion" && "text-red-300",
                        line.type === "hunk" && "text-violet-400",
                        line.type === "context" && "text-zinc-400"
                      )}
                    >
                      {line.content || " "}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main CodeDiff Component ─────────────────────────────────────

export function CodeDiff({
  files,
  className,
  activeFileIndex,
  onFileChange,
}: CodeDiffProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const effectiveIndex = activeFileIndex ?? currentIndex;

  const navigatePrev = () => {
    const next = Math.max(0, effectiveIndex - 1);
    setCurrentIndex(next);
    onFileChange?.(next);
  };

  const navigateNext = () => {
    const next = Math.min(files.length - 1, effectiveIndex + 1);
    setCurrentIndex(next);
    onFileChange?.(next);
  };

  if (files.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50",
          className
        )}
      >
        <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-medium text-xs text-zinc-400">Changes</span>
          <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            0
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center text-xs text-zinc-600">
          No changes yet
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50",
        className
      )}
    >
      {/* Header with navigation */}
      <div className="flex shrink-0 items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Changes</span>
        <span className="ml-auto flex items-center gap-1.5">
          {/* Prev / Next navigation */}
          {files.length > 1 && (
            <>
              <button
                className="rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-30"
                disabled={effectiveIndex === 0}
                onClick={navigatePrev}
                title="Previous change"
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M4.5 15.75l7.5-7.5 7.5 7.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <span className="text-[10px] text-zinc-500 tabular-nums">
                {effectiveIndex + 1}/{files.length}
              </span>
              <button
                className="rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-30"
                disabled={effectiveIndex === files.length - 1}
                onClick={navigateNext}
                title="Next change"
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          )}
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
        </span>
      </div>

      {/* Diff content area */}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
        {files.map((file) => (
          <DiffFileView file={file} key={file.filePath} />
        ))}
      </div>
    </div>
  );
}
