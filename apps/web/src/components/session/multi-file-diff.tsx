"use client";

import { Badge } from "@prometheus/ui";
import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type DiffViewMode = "unified" | "split";

type HunkDecision = "accepted" | "rejected" | "pending";
type FileDecision = "accepted" | "rejected" | "pending";

export interface MultiDiffFileEntry {
  /** Whether the file was deleted */
  isDeleted?: boolean;
  /** Whether the file is newly created */
  isNew?: boolean;
  /** Language hint for syntax highlighting */
  language?: string;
  /** New (modified) content */
  newContent: string;
  /** Old (original) content */
  oldContent: string;
  /** File path relative to project root */
  path: string;
}

interface DiffLine {
  content: string;
  newLineNum: number | null;
  oldLineNum: number | null;
  type: "addition" | "deletion" | "context";
}

interface DiffHunk {
  lines: DiffLine[];
  newCount: number;
  newStart: number;
  oldCount: number;
  oldStart: number;
}

interface FileStats {
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface MultiFileDiffProps {
  /** Changed files to display */
  files: MultiDiffFileEntry[];
  /** Callback when all changes are accepted */
  onAcceptAll?: () => void;
  /** Callback when a single file is accepted */
  onAcceptFile?: (filePath: string) => void;
  /** Callback when a hunk is accepted */
  onAcceptHunk?: (filePath: string, hunkIndex: number) => void;
  /** Callback when all changes are rejected */
  onRejectAll?: () => void;
  /** Callback when a single file is rejected */
  onRejectFile?: (filePath: string) => void;
  /** Callback when a hunk is rejected */
  onRejectHunk?: (filePath: string, hunkIndex: number) => void;
}

/* -------------------------------------------------------------------------- */
/*  Diff computation (simple LCS)                                              */
/* -------------------------------------------------------------------------- */

function buildLcsDp(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    if (!(row && prevRow)) {
      continue;
    }
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }

  return dp;
}

interface EditOp {
  newIdx: number;
  oldIdx: number;
  type: "equal" | "insert" | "delete";
}

function backtrackEditOps(
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

function simpleFallback(oldLines: string[], newLines: string[]): EditOp[] {
  const ops: EditOp[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < oldLines.length && i < newLines.length) {
      if (oldLines[i] === newLines[i]) {
        ops.push({ type: "equal", oldIdx: i, newIdx: i });
      } else {
        ops.push({ type: "delete", oldIdx: i, newIdx: i });
        ops.push({ type: "insert", oldIdx: i, newIdx: i });
      }
    } else if (i < oldLines.length) {
      ops.push({ type: "delete", oldIdx: i, newIdx: newLines.length });
    } else {
      ops.push({ type: "insert", oldIdx: oldLines.length, newIdx: i });
    }
  }

  return ops;
}

function computeEditOps(oldLines: string[], newLines: string[]): EditOp[] {
  if (oldLines.length * newLines.length > 10_000_000) {
    return simpleFallback(oldLines, newLines);
  }
  const dp = buildLcsDp(oldLines, newLines);
  return backtrackEditOps(dp, oldLines, newLines);
}

function opsToLines(
  ops: EditOp[],
  oldLines: string[],
  newLines: string[]
): DiffLine[] {
  const allLines: DiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const op of ops) {
    if (op.type === "equal") {
      allLines.push({
        type: "context",
        oldLineNum,
        newLineNum,
        content: oldLines[op.oldIdx] ?? "",
      });
      oldLineNum++;
      newLineNum++;
    } else if (op.type === "delete") {
      allLines.push({
        type: "deletion",
        oldLineNum,
        newLineNum: null,
        content: oldLines[op.oldIdx] ?? "",
      });
      oldLineNum++;
    } else {
      allLines.push({
        type: "addition",
        oldLineNum: null,
        newLineNum,
        content: newLines[op.newIdx] ?? "",
      });
      newLineNum++;
    }
  }

  return allLines;
}

function buildHunk(lines: DiffLine[]): DiffHunk {
  let oldCount = 0;
  let newCount = 0;
  const firstLine = lines[0];
  const oldStart = firstLine?.oldLineNum ?? firstLine?.newLineNum ?? 1;
  const newStart = firstLine?.newLineNum ?? firstLine?.oldLineNum ?? 1;

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

  return { oldStart, oldCount, newStart, newCount, lines };
}

function computeDiff(
  oldText: string,
  newText: string,
  contextSize = 3
): DiffHunk[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const ops = computeEditOps(oldLines, newLines);
  const allLines = opsToLines(ops, oldLines, newLines);

  const changeIndices = new Set<number>();
  for (let idx = 0; idx < allLines.length; idx++) {
    const line = allLines[idx];
    if (line && (line.type === "addition" || line.type === "deletion")) {
      for (
        let c = Math.max(0, idx - contextSize);
        c <= Math.min(allLines.length - 1, idx + contextSize);
        c++
      ) {
        changeIndices.add(c);
      }
    }
  }

  if (changeIndices.size === 0) {
    return [];
  }

  const sorted = [...changeIndices].sort((a, b) => a - b);
  const hunks: DiffHunk[] = [];
  let currentLines: DiffLine[] = [];
  let lastIdx = -2;

  for (const idx of sorted) {
    const line = allLines[idx];
    if (!line) {
      continue;
    }
    if (idx - lastIdx > 1 && currentLines.length > 0) {
      hunks.push(buildHunk(currentLines));
      currentLines = [];
    }
    currentLines.push(line);
    lastIdx = idx;
  }

  if (currentLines.length > 0) {
    hunks.push(buildHunk(currentLines));
  }

  return hunks;
}

/* -------------------------------------------------------------------------- */
/*  File stats computation                                                     */
/* -------------------------------------------------------------------------- */

function computeFileStats(file: MultiDiffFileEntry): FileStats {
  const hunks = computeDiff(file.oldContent, file.newContent);
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

  return { additions, deletions, hunks };
}

/* -------------------------------------------------------------------------- */
/*  Style helpers                                                              */
/* -------------------------------------------------------------------------- */

function lineBgColor(type: DiffLine["type"]): string {
  if (type === "addition") {
    return "bg-green-500/10";
  }
  if (type === "deletion") {
    return "bg-red-500/10";
  }
  return "";
}

function lineTextColor(type: DiffLine["type"]): string {
  if (type === "addition") {
    return "text-green-300";
  }
  if (type === "deletion") {
    return "text-red-300";
  }
  return "text-zinc-400";
}

function linePrefix(type: DiffLine["type"]): string {
  if (type === "addition") {
    return "+";
  }
  if (type === "deletion") {
    return "-";
  }
  return " ";
}

function linePrefixColor(type: DiffLine["type"]): string {
  if (type === "addition") {
    return "text-green-500";
  }
  if (type === "deletion") {
    return "text-red-500";
  }
  return "text-zinc-700";
}

function fileStatusIcon(file: MultiDiffFileEntry): {
  bg: string;
  color: string;
  label: string;
} {
  if (file.isNew) {
    return { label: "A", color: "text-green-400", bg: "bg-green-500/20" };
  }
  if (file.isDeleted) {
    return { label: "D", color: "text-red-400", bg: "bg-red-500/20" };
  }
  return { label: "M", color: "text-yellow-400", bg: "bg-yellow-500/20" };
}

/* -------------------------------------------------------------------------- */
/*  Hunk header component                                                      */
/* -------------------------------------------------------------------------- */

function HunkHeader({
  decision,
  hunk,
  hunkIndex,
  onAccept,
  onReject,
}: {
  decision: HunkDecision;
  hunk: DiffHunk;
  hunkIndex: number;
  onAccept: (idx: number) => void;
  onReject: (idx: number) => void;
}) {
  return (
    <div className="sticky top-8 z-10 flex items-center justify-between border-zinc-800 border-y bg-zinc-900/80 px-3 py-1 backdrop-blur-sm">
      <span className="font-mono text-violet-400 text-xs">
        @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
      </span>
      <div className="flex items-center gap-1">
        <button
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            decision === "accepted"
              ? "bg-green-500/20 font-medium text-green-400"
              : "text-zinc-500 hover:bg-green-500/10 hover:text-green-400"
          }`}
          onClick={() => onAccept(hunkIndex)}
          type="button"
        >
          Accept
        </button>
        <button
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            decision === "rejected"
              ? "bg-red-500/20 font-medium text-red-400"
              : "text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
          }`}
          onClick={() => onReject(hunkIndex)}
          type="button"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Unified diff line                                                          */
/* -------------------------------------------------------------------------- */

function UnifiedLine({ line }: { line: DiffLine }) {
  return (
    <div
      className={`flex font-mono text-xs leading-5 ${lineBgColor(line.type)}`}
    >
      <span className="w-12 shrink-0 select-none pr-2 text-right text-zinc-700">
        {line.oldLineNum ?? ""}
      </span>
      <span className="w-12 shrink-0 select-none pr-2 text-right text-zinc-700">
        {line.newLineNum ?? ""}
      </span>
      <span
        className={`w-4 shrink-0 select-none text-center ${linePrefixColor(line.type)}`}
      >
        {linePrefix(line.type)}
      </span>
      <span
        className={`min-w-0 flex-1 whitespace-pre-wrap break-all pl-1 ${lineTextColor(line.type)}`}
      >
        {line.content}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Split diff line                                                            */
/* -------------------------------------------------------------------------- */

function splitLeftColor(type: DiffLine["type"]): string {
  if (type === "deletion") {
    return "text-red-300";
  }
  if (type === "context") {
    return "text-zinc-400";
  }
  return "";
}

function splitRightColor(type: DiffLine["type"]): string {
  if (type === "addition") {
    return "text-green-300";
  }
  if (type === "context") {
    return "text-zinc-400";
  }
  return "";
}

function SplitLine({ line }: { line: DiffLine }) {
  return (
    <div className="flex font-mono text-xs">
      <div
        className={`flex w-1/2 border-zinc-800/50 border-r leading-5 ${
          line.type === "deletion" ? "bg-red-500/10" : ""
        }`}
      >
        <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-700">
          {line.type === "addition" ? "" : (line.oldLineNum ?? "")}
        </span>
        <span
          className={`min-w-0 flex-1 whitespace-pre-wrap break-all pl-1 ${splitLeftColor(line.type)}`}
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
          {line.type === "deletion" ? "" : (line.newLineNum ?? "")}
        </span>
        <span
          className={`min-w-0 flex-1 whitespace-pre-wrap break-all pl-1 ${splitRightColor(line.type)}`}
        >
          {line.type === "deletion" ? "" : line.content}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Context expander                                                           */
/* -------------------------------------------------------------------------- */

function ContextExpander({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      className="flex w-full items-center justify-center gap-1.5 border-zinc-800/50 border-y bg-zinc-900/30 py-1 text-[10px] text-zinc-600 transition-colors hover:bg-zinc-800/50 hover:text-zinc-400"
      onClick={onExpand}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Show more context
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  File sidebar entry                                                         */
/* -------------------------------------------------------------------------- */

function FileSidebarEntry({
  active,
  file,
  onClick,
  stats,
}: {
  active: boolean;
  file: MultiDiffFileEntry;
  onClick: () => void;
  stats: FileStats;
}) {
  const icon = fileStatusIcon(file);
  const fileName = file.path.split("/").pop() ?? file.path;

  return (
    <button
      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
        active
          ? "bg-violet-500/10 text-violet-300"
          : "text-zinc-400 hover:bg-zinc-800/50"
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded font-bold text-[9px] ${icon.bg} ${icon.color}`}
      >
        {icon.label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
        {fileName}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-green-500/70">
        +{stats.additions}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-red-500/70">
        -{stats.deletions}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main MultiFileDiff component                                               */
/* -------------------------------------------------------------------------- */

export function MultiFileDiff({
  files,
  onAcceptAll,
  onAcceptFile,
  onAcceptHunk,
  onRejectAll,
  onRejectFile,
  onRejectHunk,
}: MultiFileDiffProps) {
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [contextSize, setContextSize] = useState(3);
  const [hunkDecisions, setHunkDecisions] = useState<
    Record<string, HunkDecision>
  >({});
  const [fileDecisions, setFileDecisions] = useState<
    Record<string, FileDecision>
  >({});

  /** Precompute file stats for all files */
  const allFileStats = useMemo(
    () => files.map((f) => computeFileStats(f)),
    [files]
  );

  /** Total stats across all files */
  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const s of allFileStats) {
      additions += s.additions;
      deletions += s.deletions;
    }
    return { additions, deletions, filesChanged: files.length };
  }, [allFileStats, files.length]);

  /** Hunks for the currently selected file with the current context size */
  const selectedFile = files[selectedFileIdx];
  const selectedHunks = useMemo(() => {
    if (!selectedFile) {
      return [];
    }
    return computeDiff(
      selectedFile.oldContent,
      selectedFile.newContent,
      contextSize
    );
  }, [selectedFile, contextSize]);

  const handleExpandContext = useCallback(() => {
    setContextSize((prev) => prev + 5);
  }, []);

  const handleAcceptHunk = useCallback(
    (hunkIndex: number) => {
      if (!selectedFile) {
        return;
      }
      const key = `${selectedFile.path}:${hunkIndex}`;
      setHunkDecisions((prev) => ({
        ...prev,
        [key]: prev[key] === "accepted" ? "pending" : "accepted",
      }));
      onAcceptHunk?.(selectedFile.path, hunkIndex);
    },
    [selectedFile, onAcceptHunk]
  );

  const handleRejectHunk = useCallback(
    (hunkIndex: number) => {
      if (!selectedFile) {
        return;
      }
      const key = `${selectedFile.path}:${hunkIndex}`;
      setHunkDecisions((prev) => ({
        ...prev,
        [key]: prev[key] === "rejected" ? "pending" : "rejected",
      }));
      onRejectHunk?.(selectedFile.path, hunkIndex);
    },
    [selectedFile, onRejectHunk]
  );

  const handleAcceptFile = useCallback(
    (filePath: string) => {
      setFileDecisions((prev) => ({
        ...prev,
        [filePath]: prev[filePath] === "accepted" ? "pending" : "accepted",
      }));
      onAcceptFile?.(filePath);
    },
    [onAcceptFile]
  );

  const handleRejectFile = useCallback(
    (filePath: string) => {
      setFileDecisions((prev) => ({
        ...prev,
        [filePath]: prev[filePath] === "rejected" ? "pending" : "rejected",
      }));
      onRejectFile?.(filePath);
    },
    [onRejectFile]
  );

  if (files.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-zinc-800 border-dashed bg-zinc-950">
        <span className="text-sm text-zinc-600">No changes to display</span>
        <span className="mt-1 text-xs text-zinc-700">
          File diffs will appear here when agents make changes
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      {/* Top bar: total summary + global actions */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium text-zinc-300">
            {totalStats.filesChanged} file
            {totalStats.filesChanged === 1 ? "" : "s"} changed
          </span>
          <span className="font-mono text-green-400">
            +{totalStats.additions}
          </span>
          <span className="font-mono text-red-400">
            -{totalStats.deletions}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 rounded border border-zinc-800 p-0.5">
            <button
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
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
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
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

          {/* Accept All / Reject All */}
          {onAcceptAll && (
            <button
              className="rounded-md bg-green-500/10 px-2.5 py-1 font-medium text-[10px] text-green-400 transition-colors hover:bg-green-500/20"
              onClick={onAcceptAll}
              type="button"
            >
              Accept All
            </button>
          )}
          {onRejectAll && (
            <button
              className="rounded-md bg-red-500/10 px-2.5 py-1 font-medium text-[10px] text-red-400 transition-colors hover:bg-red-500/20"
              onClick={onRejectAll}
              type="button"
            >
              Reject All
            </button>
          )}
        </div>
      </div>

      {/* Body: sidebar + diff area */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 300 }}>
        {/* File sidebar */}
        <div className="w-56 shrink-0 overflow-auto border-zinc-800 border-r bg-zinc-900/30">
          <div className="px-2.5 py-2">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
              Changed Files
            </span>
          </div>
          {files.map((file, idx) => {
            const stats = allFileStats[idx];
            if (!stats) {
              return null;
            }
            const fileDec = fileDecisions[file.path] ?? "pending";
            return (
              <div className="relative" key={file.path}>
                <FileSidebarEntry
                  active={idx === selectedFileIdx}
                  file={file}
                  onClick={() => {
                    setSelectedFileIdx(idx);
                    setContextSize(3);
                  }}
                  stats={stats}
                />
                {/* Per-file accept/reject */}
                <div className="absolute top-0.5 right-1 flex items-center gap-0.5">
                  <button
                    className={`rounded px-1 py-0.5 text-[8px] transition-colors ${
                      fileDec === "accepted"
                        ? "bg-green-500/30 text-green-300"
                        : "text-zinc-600 hover:text-green-400"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAcceptFile(file.path);
                    }}
                    title="Accept file"
                    type="button"
                  >
                    Y
                  </button>
                  <button
                    className={`rounded px-1 py-0.5 text-[8px] transition-colors ${
                      fileDec === "rejected"
                        ? "bg-red-500/30 text-red-300"
                        : "text-zinc-600 hover:text-red-400"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRejectFile(file.path);
                    }}
                    title="Reject file"
                    type="button"
                  >
                    N
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Diff area */}
        <div className="flex-1 overflow-auto">
          {selectedFile && (
            <>
              {/* File header */}
              <div className="sticky top-0 z-10 flex items-center gap-2 border-zinc-800 border-b bg-zinc-900/80 px-3 py-1.5 backdrop-blur-sm">
                {(() => {
                  const icon = fileStatusIcon(selectedFile);
                  let statusLabel = "MOD";
                  if (selectedFile.isNew) {
                    statusLabel = "NEW";
                  } else if (selectedFile.isDeleted) {
                    statusLabel = "DEL";
                  }
                  return (
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium text-[10px] ${icon.bg} ${icon.color}`}
                    >
                      {statusLabel}
                    </span>
                  );
                })()}
                <span className="font-mono text-xs text-zinc-400">
                  {selectedFile.path}
                </span>
                {selectedFile.language && (
                  <Badge
                    className="bg-zinc-800 text-zinc-500"
                    variant="secondary"
                  >
                    {selectedFile.language}
                  </Badge>
                )}
              </div>

              {/* Hunks */}
              {selectedHunks.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-zinc-700">
                  Files are identical
                </div>
              ) : (
                <div className="font-mono text-xs">
                  {selectedHunks.map((hunk, hunkIdx) => {
                    const hunkKey = selectedFile
                      ? `${selectedFile.path}:${hunkIdx}`
                      : `unknown:${hunkIdx}`;
                    const decision = hunkDecisions[hunkKey] ?? "pending";
                    return (
                      <div key={hunkKey}>
                        <HunkHeader
                          decision={decision}
                          hunk={hunk}
                          hunkIndex={hunkIdx}
                          onAccept={handleAcceptHunk}
                          onReject={handleRejectHunk}
                        />
                        {viewMode === "unified"
                          ? hunk.lines.map((line) => (
                              <UnifiedLine
                                key={`${hunkKey}-${line.type}-${line.oldLineNum ?? "n"}-${line.newLineNum ?? "n"}`}
                                line={line}
                              />
                            ))
                          : hunk.lines.map((line) => (
                              <SplitLine
                                key={`${hunkKey}-split-${line.type}-${line.oldLineNum ?? "n"}-${line.newLineNum ?? "n"}`}
                                line={line}
                              />
                            ))}
                      </div>
                    );
                  })}
                  <ContextExpander onExpand={handleExpandContext} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
