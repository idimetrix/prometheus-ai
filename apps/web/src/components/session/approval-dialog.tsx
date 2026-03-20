"use client";

import { useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRequest {
  affectedFiles: string[];
  description: string;
  id: string;
  riskLevel: RiskLevel;
  toolArgs?: Record<string, unknown>;
  toolName: string;
}

interface ApprovalDialogProps {
  onApprove: (requestId: string) => void;
  onModify?: (requestId: string) => void;
  onReject: (requestId: string) => void;
  request: ApprovalRequest;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_STYLES: Record<
  RiskLevel,
  { badge: string; border: string; label: string }
> = {
  low: {
    badge: "bg-green-500/20 text-green-300 border-green-500/30",
    border: "border-green-500/30",
    label: "Low Risk",
  },
  medium: {
    badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    border: "border-yellow-500/30",
    label: "Medium Risk",
  },
  high: {
    badge: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    border: "border-orange-500/30",
    label: "High Risk",
  },
  critical: {
    badge: "bg-red-500/20 text-red-300 border-red-500/30",
    border: "border-red-500/30",
    label: "Critical Risk",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApprovalDialog({
  request,
  onApprove,
  onReject,
  onModify,
}: ApprovalDialogProps) {
  const riskStyle = RISK_STYLES[request.riskLevel];

  const handleApprove = useCallback(() => {
    onApprove(request.id);
  }, [onApprove, request.id]);

  const handleReject = useCallback(() => {
    onReject(request.id);
  }, [onReject, request.id]);

  const handleModify = useCallback(() => {
    onModify?.(request.id);
  }, [onModify, request.id]);

  // Keyboard shortcuts: Y=Approve, N=Reject, M=Modify
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        handleApprove();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        handleReject();
      } else if ((e.key === "m" || e.key === "M") && onModify) {
        e.preventDefault();
        handleModify();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleReject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleApprove, handleReject, handleModify, onModify]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={`w-full max-w-lg rounded-xl border bg-zinc-900 shadow-2xl ${riskStyle.border}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-zinc-800 border-b px-5 py-4">
          <svg
            aria-hidden="true"
            className="h-5 w-5 text-yellow-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex-1">
            <h2 className="font-semibold text-sm text-zinc-100">
              Approval Required
            </h2>
            <p className="text-xs text-zinc-500">
              The agent is requesting permission to proceed
            </p>
          </div>
          <span
            className={`rounded-full border px-2.5 py-0.5 font-medium text-[10px] ${riskStyle.badge}`}
          >
            {riskStyle.label}
          </span>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Description */}
          <div>
            <span className="font-medium text-[10px] text-zinc-500 uppercase">
              Action
            </span>
            <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
              {request.description}
            </p>
          </div>

          {/* Tool details */}
          <div>
            <span className="font-medium text-[10px] text-zinc-500 uppercase">
              Tool
            </span>
            <div className="mt-1 rounded bg-zinc-800/50 px-3 py-2 font-mono text-xs text-zinc-300">
              {request.toolName}
            </div>
          </div>

          {/* Tool args */}
          {request.toolArgs && Object.keys(request.toolArgs).length > 0 && (
            <div>
              <span className="font-medium text-[10px] text-zinc-500 uppercase">
                Arguments
              </span>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
                {JSON.stringify(request.toolArgs, null, 2)}
              </pre>
            </div>
          )}

          {/* Affected files */}
          {request.affectedFiles.length > 0 && (
            <div>
              <span className="font-medium text-[10px] text-zinc-500 uppercase">
                Affected Files ({request.affectedFiles.length})
              </span>
              <div className="mt-1 max-h-32 overflow-auto rounded bg-zinc-800/50 p-2">
                {request.affectedFiles.map((file) => (
                  <div
                    className="font-mono text-[11px] text-zinc-400"
                    key={file}
                  >
                    {file}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-zinc-800 border-t px-5 py-3">
          <div className="flex-1 text-[10px] text-zinc-600">
            Keyboard:{" "}
            <kbd className="rounded border border-zinc-700 px-1">Y</kbd> Approve{" "}
            <kbd className="rounded border border-zinc-700 px-1">N</kbd> Reject
            {onModify && (
              <>
                {" "}
                <kbd className="rounded border border-zinc-700 px-1">M</kbd>{" "}
                Modify
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-1.5 font-medium text-red-300 text-xs hover:bg-red-500/20"
              onClick={handleReject}
              type="button"
            >
              Reject
            </button>
            {onModify && (
              <button
                className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-1.5 font-medium text-xs text-yellow-300 hover:bg-yellow-500/20"
                onClick={handleModify}
                type="button"
              >
                Modify
              </button>
            )}
            <button
              className="rounded-lg bg-green-600 px-4 py-1.5 font-medium text-white text-xs hover:bg-green-500"
              onClick={handleApprove}
              type="button"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
