"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckpointApprovalProps {
  onApprove: () => void;
  onModify: (instructions: string) => void;
  onReject: (reason: string) => void;
  phase: string;
  summary: string;
  taskId: string;
}

type ApprovalMode = "idle" | "rejecting" | "modifying";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CheckpointApproval({
  taskId,
  phase,
  summary,
  onApprove,
  onReject,
  onModify,
}: CheckpointApprovalProps) {
  const [mode, setMode] = useState<ApprovalMode>("idle");
  const [rejectReason, setRejectReason] = useState("");
  const [modifyInstructions, setModifyInstructions] = useState("");

  const handleRejectSubmit = useCallback(() => {
    if (rejectReason.trim()) {
      onReject(rejectReason.trim());
      setRejectReason("");
      setMode("idle");
    }
  }, [rejectReason, onReject]);

  const handleModifySubmit = useCallback(() => {
    if (modifyInstructions.trim()) {
      onModify(modifyInstructions.trim());
      setModifyInstructions("");
      setMode("idle");
    }
  }, [modifyInstructions, onModify]);

  const handleCancel = useCallback(() => {
    setMode("idle");
    setRejectReason("");
    setModifyInstructions("");
  }, []);

  return (
    <div className="rounded-xl border border-yellow-500/30 bg-zinc-900/80 shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-3 border-zinc-800 border-b px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10">
          <svg
            aria-hidden="true"
            className="h-4 w-4 text-yellow-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-zinc-100">
              Checkpoint Approval
            </h3>
            <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] text-yellow-300">
              {phase}
            </span>
          </div>
          <span className="font-mono text-[10px] text-zinc-600">
            Task: {taskId}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-3">
        <span className="font-medium text-[10px] text-zinc-500 uppercase">
          Summary
        </span>
        <p className="mt-1 text-xs text-zinc-300 leading-relaxed">{summary}</p>
      </div>

      {/* Action area */}
      <div className="border-zinc-800 border-t px-4 py-3">
        {mode === "idle" && (
          <div className="flex items-center gap-2">
            <button
              className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-medium text-red-300 text-xs transition-colors hover:bg-red-500/20"
              onClick={() => setMode("rejecting")}
              type="button"
            >
              Reject
            </button>
            <button
              className="flex-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 font-medium text-xs text-yellow-300 transition-colors hover:bg-yellow-500/20"
              onClick={() => setMode("modifying")}
              type="button"
            >
              Modify
            </button>
            <button
              className="flex-1 rounded-lg bg-green-600 px-3 py-2 font-medium text-white text-xs transition-colors hover:bg-green-500"
              onClick={onApprove}
              type="button"
            >
              Approve
            </button>
          </div>
        )}

        {mode === "rejecting" && (
          <div className="space-y-2">
            <label className="block">
              <span className="font-medium text-[10px] text-zinc-500 uppercase">
                Rejection Reason
              </span>
              <textarea
                autoFocus
                className="mt-1 block w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none focus:ring-1 focus:ring-red-500/30"
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Describe why this checkpoint should be rejected..."
                rows={3}
                value={rejectReason}
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-red-500 disabled:opacity-50"
                disabled={!rejectReason.trim()}
                onClick={handleRejectSubmit}
                type="button"
              >
                Submit Rejection
              </button>
            </div>
          </div>
        )}

        {mode === "modifying" && (
          <div className="space-y-2">
            <label className="block">
              <span className="font-medium text-[10px] text-zinc-500 uppercase">
                Additional Instructions
              </span>
              <textarea
                autoFocus
                className="mt-1 block w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-yellow-500/50 focus:outline-none focus:ring-1 focus:ring-yellow-500/30"
                onChange={(e) => setModifyInstructions(e.target.value)}
                placeholder="Provide instructions for how to modify the approach..."
                rows={3}
                value={modifyInstructions}
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-yellow-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-yellow-500 disabled:opacity-50"
                disabled={!modifyInstructions.trim()}
                onClick={handleModifySubmit}
                type="button"
              >
                Submit Modifications
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type { CheckpointApprovalProps };
