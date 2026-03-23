"use client";

import { useCallback, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface DiffLine {
  content: string;
  lineNumber?: number;
  type: "added" | "removed" | "context";
}

interface DiffHunk {
  comment?: string;
  endLine: number;
  id: string;
  lines: DiffLine[];
  startLine: number;
}

interface DiffViewerProps {
  className?: string;
  filename: string;
  hunks: DiffHunk[];
  onApply?: (hunkId: string) => void;
  onComment?: (hunkId: string, comment: string) => void;
  onReject?: (hunkId: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Diff Line                                                                  */
/* -------------------------------------------------------------------------- */

function DiffLineRow({ line }: { line: DiffLine }) {
  const bgMap: Record<DiffLine["type"], string> = {
    added: "bg-green-950/30",
    context: "",
    removed: "bg-red-950/30",
  };
  const textMap: Record<DiffLine["type"], string> = {
    added: "text-green-400",
    context: "text-zinc-400",
    removed: "text-red-400",
  };
  const prefixMap: Record<DiffLine["type"], string> = {
    added: "+",
    context: " ",
    removed: "-",
  };

  return (
    <div className={`flex font-mono text-xs leading-5 ${bgMap[line.type]}`}>
      <span className="w-12 shrink-0 select-none text-right text-zinc-600">
        {line.lineNumber ?? ""}
      </span>
      <span className="w-6 shrink-0 select-none text-center text-zinc-600">
        {prefixMap[line.type]}
      </span>
      <span className={`flex-1 whitespace-pre-wrap ${textMap[line.type]}`}>
        {line.content}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hunk Component                                                             */
/* -------------------------------------------------------------------------- */

function HunkBlock({
  hunk,
  onApply,
  onReject,
  onComment,
}: {
  hunk: DiffHunk;
  onApply?: (id: string) => void;
  onComment?: (id: string, comment: string) => void;
  onReject?: (id: string) => void;
}) {
  const [commentText, setCommentText] = useState("");
  const [showComment, setShowComment] = useState(false);

  const handleSubmitComment = useCallback(() => {
    if (commentText.trim() && onComment) {
      onComment(hunk.id, commentText.trim());
      setCommentText("");
      setShowComment(false);
    }
  }, [hunk.id, commentText, onComment]);

  return (
    <div className="overflow-hidden rounded border border-zinc-700">
      {/* Hunk header */}
      <div className="flex items-center justify-between bg-zinc-800/60 px-3 py-1">
        <span className="font-mono text-[10px] text-zinc-500">
          @@ {hunk.startLine}-{hunk.endLine} @@
        </span>
        <div className="flex gap-1">
          {onApply && (
            <button
              className="rounded bg-green-700 px-2 py-0.5 text-[10px] text-white hover:bg-green-600"
              onClick={() => onApply(hunk.id)}
              type="button"
            >
              Apply
            </button>
          )}
          {onReject && (
            <button
              className="rounded bg-red-700 px-2 py-0.5 text-[10px] text-white hover:bg-red-600"
              onClick={() => onReject(hunk.id)}
              type="button"
            >
              Reject
            </button>
          )}
          {onComment && (
            <button
              className="rounded bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-600"
              onClick={() => setShowComment((v) => !v)}
              type="button"
            >
              Comment
            </button>
          )}
        </div>
      </div>

      {/* Lines */}
      <div>
        {hunk.lines.map((line) => (
          <DiffLineRow
            key={`${hunk.id}-${line.type}-${line.lineNumber ?? ""}-${line.content.slice(0, 30)}`}
            line={line}
          />
        ))}
      </div>

      {/* Existing comment */}
      {hunk.comment && (
        <div className="border-zinc-700 border-t bg-zinc-800/40 px-3 py-2 text-xs text-zinc-400">
          {hunk.comment}
        </div>
      )}

      {/* Comment input */}
      {showComment && (
        <div className="flex gap-1 border-zinc-700 border-t p-2">
          <input
            className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSubmitComment();
              }
            }}
            placeholder="Add a comment..."
            value={commentText}
          />
          <button
            className="rounded bg-blue-600 px-2 py-1 text-white text-xs hover:bg-blue-500 disabled:opacity-40"
            disabled={!commentText.trim()}
            onClick={handleSubmitComment}
            type="button"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function DiffViewer({
  filename,
  hunks,
  onApply,
  onReject,
  onComment,
  className = "",
}: DiffViewerProps) {
  const totalAdded = hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "added").length,
    0
  );
  const totalRemoved = hunks.reduce(
    (sum, h) => sum + h.lines.filter((l) => l.type === "removed").length,
    0
  );

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* File header */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2">
        <span className="font-mono text-sm text-zinc-300">{filename}</span>
        <div className="flex gap-2">
          <span className="text-green-400 text-xs">+{totalAdded}</span>
          <span className="text-red-400 text-xs">-{totalRemoved}</span>
        </div>
      </div>

      {/* Hunks */}
      <div className="flex flex-col gap-2">
        {hunks.map((hunk) => (
          <HunkBlock
            hunk={hunk}
            key={hunk.id}
            onApply={onApply}
            onComment={onComment}
            onReject={onReject}
          />
        ))}
      </div>
    </div>
  );
}

export type { DiffHunk, DiffLine, DiffViewerProps };
