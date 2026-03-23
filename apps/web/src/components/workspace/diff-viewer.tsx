"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffLine {
  content: string;
  newLineNum: number | null;
  oldLineNum: number | null;
  type: "addition" | "deletion" | "context";
}

interface DiffHunk {
  id: string;
  lines: DiffLine[];
  newCount: number;
  newStart: number;
  oldCount: number;
  oldStart: number;
}

interface DiffViewerProps {
  language: string;
  modified: string;
  onAcceptHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  original: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHunkBgColor(isAccepted: boolean, isRejected: boolean): string {
  if (isAccepted) {
    return "bg-green-900/20";
  }
  if (isRejected) {
    return "bg-red-900/20";
  }
  return "bg-zinc-900/80";
}

// ---------------------------------------------------------------------------
// Diff computation (simplified LCS)
// ---------------------------------------------------------------------------

interface EditOp {
  newIdx: number;
  oldIdx: number;
  type: "equal" | "insert" | "delete";
}

function simpleDiffOps(oldLines: string[], newLines: string[]): EditOp[] {
  const ops: EditOp[] = [];
  const m = oldLines.length;
  const n = newLines.length;
  const maxLen = Math.max(m, n);
  for (let i = 0; i < maxLen; i++) {
    if (i < m && i < n) {
      if (oldLines[i] === newLines[i]) {
        ops.push({ type: "equal", oldIdx: i, newIdx: i });
      } else {
        ops.push({ type: "delete", oldIdx: i, newIdx: i });
        ops.push({ type: "insert", oldIdx: i, newIdx: i });
      }
    } else if (i < m) {
      ops.push({ type: "delete", oldIdx: i, newIdx: n });
    } else {
      ops.push({ type: "insert", oldIdx: m, newIdx: i });
    }
  }
  return ops;
}

function buildWsDpTable(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const row = dp[i];
      if (!row) {
        continue;
      }
      if (oldLines[i - 1] === newLines[j - 1]) {
        row[j] = (dp[i - 1]?.[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(dp[i - 1]?.[j] ?? 0, dp[i]?.[j - 1] ?? 0);
      }
    }
  }
  return dp;
}

function backtrackWsOps(
  dp: number[][],
  oldLines: string[],
  newLines: string[]
): EditOp[] {
  const ops: EditOp[] = [];
  let i = oldLines.length;
  let j = newLines.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: "equal", oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (
      j > 0 &&
      (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))
    ) {
      ops.unshift({ type: "insert", oldIdx: i - 1, newIdx: j - 1 });
      j--;
    } else {
      ops.unshift({ type: "delete", oldIdx: i - 1, newIdx: j - 1 });
      i--;
    }
  }
  return ops;
}

function lcsDiffOps(oldLines: string[], newLines: string[]): EditOp[] {
  const dp = buildWsDpTable(oldLines, newLines);
  return backtrackWsOps(dp, oldLines, newLines);
}

function opsToAllLines(
  ops: EditOp[],
  oldLines: string[],
  newLines: string[]
): DiffLine[] {
  const allLines: DiffLine[] = [];
  let oldNum = 1;
  let newNum = 1;

  for (const op of ops) {
    if (op.type === "equal") {
      allLines.push({
        type: "context",
        oldLineNum: oldNum,
        newLineNum: newNum,
        content: oldLines[op.oldIdx] ?? "",
      });
      oldNum++;
      newNum++;
    } else if (op.type === "delete") {
      allLines.push({
        type: "deletion",
        oldLineNum: oldNum,
        newLineNum: null,
        content: oldLines[op.oldIdx] ?? "",
      });
      oldNum++;
    } else {
      allLines.push({
        type: "addition",
        oldLineNum: null,
        newLineNum: newNum,
        content: newLines[op.newIdx] ?? "",
      });
      newNum++;
    }
  }

  return allLines;
}

function collectChangeIndicesForHunks(
  allLines: DiffLine[],
  contextLines: number
): Set<number> {
  const changeIndices = new Set<number>();
  for (let idx = 0; idx < allLines.length; idx++) {
    const line = allLines[idx];
    if (line && (line.type === "addition" || line.type === "deletion")) {
      for (
        let c = Math.max(0, idx - contextLines);
        c <= Math.min(allLines.length - 1, idx + contextLines);
        c++
      ) {
        changeIndices.add(c);
      }
    }
  }
  return changeIndices;
}

function computeHunks(
  original: string,
  modified: string,
  contextLines = 3
): DiffHunk[] {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");

  const ops =
    oldLines.length * newLines.length > 5_000_000
      ? simpleDiffOps(oldLines, newLines)
      : lcsDiffOps(oldLines, newLines);

  const allLines = opsToAllLines(ops, oldLines, newLines);
  const changeIndices = collectChangeIndicesForHunks(allLines, contextLines);

  if (changeIndices.size === 0) {
    return [];
  }

  const sorted = [...changeIndices].sort((a, b) => a - b);
  const hunks: DiffHunk[] = [];
  let currentLines: DiffLine[] = [];
  let lastIdx = -2;
  let hunkCount = 0;

  for (const idx of sorted) {
    const line = allLines[idx];
    if (!line) {
      continue;
    }
    if (idx - lastIdx > 1 && currentLines.length > 0) {
      hunks.push(buildHunk(currentLines, hunkCount));
      hunkCount++;
      currentLines = [];
    }
    currentLines.push(line);
    lastIdx = idx;
  }

  if (currentLines.length > 0) {
    hunks.push(buildHunk(currentLines, hunkCount));
  }

  return hunks;
}

function buildHunk(lines: DiffLine[], index: number): DiffHunk {
  let oldCount = 0;
  let newCount = 0;
  const oldStart = lines[0]?.oldLineNum ?? lines[0]?.newLineNum ?? 1;
  const newStart = lines[0]?.newLineNum ?? lines[0]?.oldLineNum ?? 1;

  for (const line of lines) {
    if (line.type === "context") {
      oldCount++;
      newCount++;
    } else if (line.type === "deletion") {
      oldCount++;
    } else {
      newCount++;
    }
  }

  return {
    id: `hunk-${index}`,
    lines,
    oldStart,
    oldCount,
    newStart,
    newCount,
  };
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function getLineBg(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "bg-green-500/10";
    case "deletion":
      return "bg-red-500/10";
    default:
      return "";
  }
}

function getLineColor(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-green-300";
    case "deletion":
      return "text-red-300";
    default:
      return "text-zinc-400";
  }
}

function getPrefix(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return " ";
  }
}

function getPrefixColor(type: DiffLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-green-500";
    case "deletion":
      return "text-red-500";
    default:
      return "text-zinc-700";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function WsSplitRow({
  line,
  isResolved,
}: {
  hunkId: string;
  line: DiffLine;
  isResolved: boolean;
}) {
  return (
    <div className={`flex ${isResolved ? "opacity-60" : ""}`}>
      <div
        className={`flex w-1/2 border-zinc-800/50 border-r leading-5 ${
          line.type === "deletion" ? "bg-red-500/10" : ""
        }`}
      >
        <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-700">
          {line.oldLineNum ?? ""}
        </span>
        <span
          className={`min-w-0 whitespace-pre-wrap break-all pl-1 ${
            line.type === "deletion" ? "text-red-300" : "text-zinc-400"
          }`}
        >
          {line.type === "addition" ? "" : line.content}
        </span>
      </div>
      <div
        className={`flex w-1/2 leading-5 ${
          line.type === "addition" ? "bg-green-500/10" : ""
        }`}
      >
        <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-700">
          {line.newLineNum ?? ""}
        </span>
        <span
          className={`min-w-0 whitespace-pre-wrap break-all pl-1 ${
            line.type === "addition" ? "text-green-300" : "text-zinc-400"
          }`}
        >
          {line.type === "deletion" ? "" : line.content}
        </span>
      </div>
    </div>
  );
}

export function DiffViewer({
  original,
  modified,
  language,
  onAcceptHunk,
  onRejectHunk,
}: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [acceptedHunks, setAcceptedHunks] = useState<Set<string>>(new Set());
  const [rejectedHunks, setRejectedHunks] = useState<Set<string>>(new Set());

  const hunks = useMemo(
    () => computeHunks(original, modified),
    [original, modified]
  );

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === "addition") {
          additions++;
        }
        if (line.type === "deletion") {
          deletions++;
        }
      }
    }
    return { additions, deletions };
  }, [hunks]);

  const handleAccept = useCallback(
    (hunkId: string) => {
      setAcceptedHunks((prev) => new Set([...prev, hunkId]));
      onAcceptHunk?.(hunkId);
    },
    [onAcceptHunk]
  );

  const handleReject = useCallback(
    (hunkId: string) => {
      setRejectedHunks((prev) => new Set([...prev, hunkId]));
      onRejectHunk?.(hunkId);
    },
    [onRejectHunk]
  );

  if (hunks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-950">
        <div className="text-sm text-zinc-600">Files are identical</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-500">{language}</span>
          <span className="text-green-400">+{stats.additions}</span>
          <span className="text-red-400">-{stats.deletions}</span>
        </div>
        <div className="flex items-center gap-0.5 rounded border border-zinc-800 p-0.5">
          <button
            className={`rounded px-2 py-0.5 text-[10px] ${
              viewMode === "unified"
                ? "bg-violet-500/20 text-violet-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setViewMode("unified")}
            type="button"
          >
            Unified
          </button>
          <button
            className={`rounded px-2 py-0.5 text-[10px] ${
              viewMode === "split"
                ? "bg-violet-500/20 text-violet-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setViewMode("split")}
            type="button"
          >
            Split
          </button>
        </div>
      </div>

      {/* Diff hunks */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        {hunks.map((hunk) => {
          const isAccepted = acceptedHunks.has(hunk.id);
          const isRejected = rejectedHunks.has(hunk.id);
          const isResolved = isAccepted || isRejected;

          return (
            <div key={hunk.id}>
              {/* Hunk header with accept/reject */}
              <div
                className={`sticky top-0 z-10 flex items-center gap-2 border-zinc-800 border-y px-3 py-1 backdrop-blur-sm ${getHunkBgColor(
                  isAccepted,
                  isRejected
                )}`}
              >
                <span className="text-violet-400">
                  @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
                  {hunk.newCount} @@
                </span>

                {!isResolved && (onAcceptHunk || onRejectHunk) && (
                  <div className="ml-auto flex gap-1">
                    {onAcceptHunk && (
                      <button
                        className="rounded bg-green-500/20 px-2 py-0.5 text-[10px] text-green-300 hover:bg-green-500/30"
                        onClick={() => handleAccept(hunk.id)}
                        type="button"
                      >
                        Accept
                      </button>
                    )}
                    {onRejectHunk && (
                      <button
                        className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-500/30"
                        onClick={() => handleReject(hunk.id)}
                        type="button"
                      >
                        Reject
                      </button>
                    )}
                  </div>
                )}

                {isAccepted && (
                  <span className="ml-auto text-[10px] text-green-400">
                    Accepted
                  </span>
                )}
                {isRejected && (
                  <span className="ml-auto text-[10px] text-red-400">
                    Rejected
                  </span>
                )}
              </div>

              {/* Lines */}
              {viewMode === "unified"
                ? hunk.lines.map((line) => (
                    <div
                      className={`flex leading-5 ${getLineBg(line.type)} ${isResolved ? "opacity-60" : ""}`}
                      key={`${hunk.id}-${line.type}-${line.oldLineNum ?? "n"}-${line.newLineNum ?? "n"}`}
                    >
                      <span className="w-12 shrink-0 select-none pr-2 text-right text-zinc-700">
                        {line.oldLineNum ?? ""}
                      </span>
                      <span className="w-12 shrink-0 select-none pr-2 text-right text-zinc-700">
                        {line.newLineNum ?? ""}
                      </span>
                      <span
                        className={`w-4 shrink-0 select-none text-center ${getPrefixColor(line.type)}`}
                      >
                        {getPrefix(line.type)}
                      </span>
                      <span
                        className={`min-w-0 whitespace-pre-wrap break-all pl-1 ${getLineColor(line.type)}`}
                      >
                        {line.content}
                      </span>
                    </div>
                  ))
                : hunk.lines.map((line) => (
                    <WsSplitRow
                      hunkId={hunk.id}
                      isResolved={isResolved}
                      key={`split-${hunk.id}-${line.type}-${line.oldLineNum ?? "n"}-${line.newLineNum ?? "n"}`}
                      line={line}
                    />
                  ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
