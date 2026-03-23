"use client";

import { Badge, Card, CardContent } from "@prometheus/ui";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiffViewMode = "unified" | "split";
type LineDecision = "accepted" | "rejected" | "pending";

export interface DiffFileEntry {
  /** Whether file was deleted */
  isDeleted?: boolean;
  /** Whether file is newly created */
  isNew?: boolean;
  /** Language for syntax highlighting hint */
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

interface DiffViewerProps {
  /** Files with diffs to display */
  files: DiffFileEntry[];
  /** Callback when line decisions change */
  onLineDecision?: (
    filePath: string,
    lineNum: number,
    decision: LineDecision
  ) => void;
  /** Whether to show accept/reject controls */
  reviewMode?: boolean;
}

// ---------------------------------------------------------------------------
// Diff computation (simple LCS-based)
// ---------------------------------------------------------------------------

interface EditOp {
  newIdx: number;
  oldIdx: number;
  type: "equal" | "insert" | "delete";
}

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

function computeEditOps(oldLines: string[], newLines: string[]): EditOp[] {
  if (oldLines.length * newLines.length > 10_000_000) {
    return simpleFallback(oldLines, newLines);
  }

  const dp = buildLcsDp(oldLines, newLines);
  return backtrackEditOps(dp, oldLines, newLines);
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

function collectChangeIndices(
  allLines: DiffLine[],
  contextSize: number
): Set<number> {
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
  return changeIndices;
}

function groupIntoHunks(
  allLines: DiffLine[],
  changeIndices: Set<number>
): DiffHunk[] {
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

function computeDiff(oldText: string, newText: string): DiffHunk[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const ops = computeEditOps(oldLines, newLines);
  const allLines = opsToLines(ops, oldLines, newLines);

  const contextSize = 3;
  const changeIndices = collectChangeIndices(allLines, contextSize);

  if (changeIndices.size === 0) {
    return [];
  }

  return groupIntoHunks(allLines, changeIndices);
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

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

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

function splitLeftTextColor(type: DiffLine["type"]): string {
  if (type === "deletion") {
    return "text-red-300";
  }
  if (type === "context") {
    return "text-zinc-400";
  }
  return "";
}

function splitRightTextColor(type: DiffLine["type"]): string {
  if (type === "addition") {
    return "text-green-300";
  }
  if (type === "context") {
    return "text-zinc-400";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FileStatusBadge({ file }: { file: DiffFileEntry }) {
  if (file.isNew) {
    return (
      <span className="rounded bg-green-500/20 px-1.5 py-0.5 font-medium text-[10px] text-green-400">
        NEW
      </span>
    );
  }
  if (file.isDeleted) {
    return (
      <span className="rounded bg-red-500/20 px-1.5 py-0.5 font-medium text-[10px] text-red-400">
        DEL
      </span>
    );
  }
  return (
    <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 font-medium text-[10px] text-yellow-400">
      MOD
    </span>
  );
}

function DecisionButton({
  decision,
  lineKey,
  onDecision,
}: {
  decision: LineDecision;
  lineKey: string;
  onDecision: (key: string, decision: LineDecision) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        className={`rounded px-1 py-0.5 text-[8px] ${
          decision === "accepted"
            ? "bg-green-500/30 text-green-300"
            : "text-zinc-600 hover:text-green-400"
        }`}
        onClick={() =>
          onDecision(lineKey, decision === "accepted" ? "pending" : "accepted")
        }
        title="Accept"
        type="button"
      >
        Y
      </button>
      <button
        className={`rounded px-1 py-0.5 text-[8px] ${
          decision === "rejected"
            ? "bg-red-500/30 text-red-300"
            : "text-zinc-600 hover:text-red-400"
        }`}
        onClick={() =>
          onDecision(lineKey, decision === "rejected" ? "pending" : "rejected")
        }
        title="Reject"
        type="button"
      >
        N
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extracted line-level render helpers
// ---------------------------------------------------------------------------

function UnifiedDiffLine({
  line,
  hunkId,
  decisions,
  reviewMode,
  handleDecision,
}: {
  line: DiffLine;
  hunkId: string;
  decisions: Record<string, LineDecision>;
  reviewMode: boolean;
  handleDecision: (lineKey: string, decision: LineDecision) => void;
}) {
  const lineKey = `${hunkId}-${line.type}-${line.oldLineNum ?? "n"}-${line.newLineNum ?? "n"}`;
  const decision = decisions[lineKey] ?? "pending";
  const isChangeLine = line.type === "addition" || line.type === "deletion";

  return (
    <div className={`flex leading-5 ${lineBgColor(line.type)}`}>
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
      {reviewMode && isChangeLine && (
        <DecisionButton
          decision={decision}
          lineKey={lineKey}
          onDecision={handleDecision}
        />
      )}
    </div>
  );
}

function SplitDiffLineRow({ line }: { line: DiffLine }) {
  return (
    <div className="flex">
      <div
        className={`flex w-1/2 border-zinc-800/50 border-r leading-5 ${
          line.type === "deletion" ? "bg-red-500/10" : ""
        }`}
      >
        <span className="w-10 shrink-0 select-none pr-2 text-right text-zinc-700">
          {line.type === "addition" ? "" : (line.oldLineNum ?? "")}
        </span>
        <span
          className={`min-w-0 flex-1 whitespace-pre-wrap break-all pl-1 ${splitLeftTextColor(line.type)}`}
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
          className={`min-w-0 flex-1 whitespace-pre-wrap break-all pl-1 ${splitRightTextColor(line.type)}`}
        >
          {line.type === "deletion" ? "" : line.content}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DiffViewer({
  files,
  reviewMode = false,
  onLineDecision,
}: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, LineDecision>>({});

  const selectedFile = files[selectedFileIdx];

  const hunks = useMemo(() => {
    if (!selectedFile) {
      return [];
    }
    return computeDiff(selectedFile.oldContent, selectedFile.newContent);
  }, [selectedFile]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
      const fileHunks = computeDiff(file.oldContent, file.newContent);
      for (const hunk of fileHunks) {
        for (const line of hunk.lines) {
          if (line.type === "addition") {
            additions++;
          }
          if (line.type === "deletion") {
            deletions++;
          }
        }
      }
    }
    return { additions, deletions, filesChanged: files.length };
  }, [files]);

  const handleDecision = useCallback(
    (lineKey: string, decision: LineDecision) => {
      setDecisions((prev) => ({ ...prev, [lineKey]: decision }));
      if (onLineDecision && selectedFile) {
        const lineNum = Number.parseInt(lineKey.split("-").pop() ?? "0", 10);
        onLineDecision(selectedFile.path, lineNum, decision);
      }
    },
    [onLineDecision, selectedFile]
  );

  if (files.length === 0) {
    return (
      <Card className="border-zinc-800 bg-zinc-950">
        <CardContent className="flex h-48 flex-col items-center justify-center">
          <span className="text-sm text-zinc-600">No changes to display</span>
          <span className="mt-1 text-xs text-zinc-700">
            File diffs will appear here when agents make changes
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col overflow-hidden border-zinc-800 bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <div className="flex items-center gap-3">
          {/* File selector */}
          <select
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-violet-500"
            onChange={(e) => setSelectedFileIdx(Number(e.target.value))}
            value={selectedFileIdx}
          >
            {files.map((file, idx) => (
              <option key={file.path} value={idx}>
                {file.path}
                {file.isNew ? " (new)" : ""}
                {file.isDeleted ? " (deleted)" : ""}
              </option>
            ))}
          </select>

          {/* Global stats */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-400">+{stats.additions}</span>
            <span className="text-red-400">-{stats.deletions}</span>
            <span className="text-zinc-500">
              {stats.filesChanged} file{stats.filesChanged === 1 ? "" : "s"}
            </span>
          </div>
        </div>

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
      </div>

      {/* File tree sidebar + diff content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree */}
        <div className="w-48 shrink-0 overflow-auto border-zinc-800 border-r bg-zinc-900/30">
          <div className="px-2 py-1.5">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
              Changed Files
            </span>
          </div>
          {files.map((file, idx) => (
            <button
              className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors ${
                idx === selectedFileIdx
                  ? "bg-violet-500/10 text-violet-300"
                  : "text-zinc-400 hover:bg-zinc-800/50"
              }`}
              key={file.path}
              onClick={() => setSelectedFileIdx(idx)}
              type="button"
            >
              <FileStatusBadge file={file} />
              <span className="min-w-0 truncate font-mono text-[10px]">
                {file.path.split("/").pop()}
              </span>
            </button>
          ))}
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-auto">
          {/* File header */}
          {selectedFile && (
            <div className="sticky top-0 z-10 flex items-center gap-2 border-zinc-800 border-b bg-zinc-900/80 px-3 py-1.5 backdrop-blur-sm">
              <FileStatusBadge file={selectedFile} />
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
          )}

          {/* Diff lines */}
          {hunks.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-700">
              Files are identical
            </div>
          ) : (
            <div className="font-mono text-xs">
              {hunks.map((hunk, hunkIdx) => {
                const hunkId = `hunk-${hunkIdx}`;
                return (
                  <div key={hunkId}>
                    <div className="sticky top-8 z-10 border-zinc-800 border-y bg-zinc-900/80 px-3 py-1 backdrop-blur-sm">
                      <span className="text-violet-400">
                        @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
                        {hunk.newCount} @@
                      </span>
                    </div>

                    {viewMode === "unified"
                      ? hunk.lines.map((line) => (
                          <UnifiedDiffLine
                            decisions={decisions}
                            handleDecision={handleDecision}
                            hunkId={hunkId}
                            key={`${hunkId}-${line.type}-${line.oldLineNum ?? "n"}-${line.newLineNum ?? "n"}`}
                            line={line}
                            reviewMode={reviewMode}
                          />
                        ))
                      : hunk.lines.map((line) => (
                          <SplitDiffLineRow
                            key={`${hunkId}-split-${line.type}-${line.oldLineNum ?? "n"}-${line.newLineNum ?? "n"}`}
                            line={line}
                          />
                        ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
