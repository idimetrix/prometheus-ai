"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRequest {
  affectedFiles: string[];
  confidenceScore?: number;
  creditCost?: number;
  description: string;
  diff?: string;
  id: string;
  riskLevel: RiskLevel;
  toolArgs?: Record<string, unknown>;
  toolName: string;
}

interface ApprovalDialogProps {
  batchRequests?: ApprovalRequest[];
  onApprove: (requestId: string) => void;
  onBatchApprove?: (requestIds: string[]) => void;
  onBatchReject?: (requestIds: string[]) => void;
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

const RISK_ICON_COLORS: Record<RiskLevel, string> = {
  low: "text-green-400",
  medium: "text-yellow-400",
  high: "text-orange-400",
  critical: "text-red-400",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfidenceColor(percentage: number): string {
  if (percentage >= 75) {
    return "text-green-400";
  }
  if (percentage >= 50) {
    return "text-yellow-400";
  }
  return "text-red-400";
}

function getConfidenceBarColor(percentage: number): string {
  if (percentage >= 75) {
    return "bg-green-500";
  }
  if (percentage >= 50) {
    return "bg-yellow-500";
  }
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RiskBadge({ level }: { level: RiskLevel }) {
  const style = RISK_STYLES[level];
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 font-medium text-[10px] ${style.badge}`}
    >
      {style.label}
    </span>
  );
}

function ConfidenceScore({ score }: { score: number }) {
  const percentage = Math.round(score * 100);
  const color = getConfidenceColor(percentage);
  const barColor = getConfidenceBarColor(percentage);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-zinc-500">Confidence</span>
      <div className="flex items-center gap-1">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className={`font-mono text-[10px] ${color}`}>{percentage}%</span>
      </div>
    </div>
  );
}

function CreditCostEstimate({ cost }: { cost: number }) {
  return (
    <div className="flex items-center gap-2 rounded bg-zinc-800/50 px-2 py-1">
      <svg
        aria-hidden="true"
        className="h-3 w-3 text-violet-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[10px] text-zinc-400">Est. cost:</span>
      <span className="font-mono text-[10px] text-violet-300">
        {cost.toFixed(2)} credits
      </span>
    </div>
  );
}

function InlineDiffPreview({ diff }: { diff: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = diff.split("\n");
  const previewLines = expanded ? lines : lines.slice(0, 10);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-medium text-[10px] text-zinc-500 uppercase">
          Changes Preview
        </span>
        {lines.length > 10 && (
          <button
            className="text-[10px] text-violet-400 hover:text-violet-300"
            onClick={() => setExpanded((p) => !p)}
            type="button"
          >
            {expanded ? "Show less" : `Show all (${lines.length} lines)`}
          </button>
        )}
      </div>
      <div className="mt-1 max-h-48 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px]">
        {previewLines.map((line, idx) => {
          let lineClass = "text-zinc-500";
          if (line.startsWith("+")) {
            lineClass = "text-green-400 bg-green-500/5";
          } else if (line.startsWith("-")) {
            lineClass = "text-red-400 bg-red-500/5";
          } else if (line.startsWith("@@")) {
            lineClass = "text-violet-400";
          }
          return (
            <div
              className={`whitespace-pre ${lineClass}`}
              key={`diff-${String(idx)}`}
            >
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BatchApprovalPanel({
  requests,
  onApproveAll,
  onRejectAll,
}: {
  onApproveAll: (ids: string[]) => void;
  onRejectAll: (ids: string[]) => void;
  requests: ApprovalRequest[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(requests.map((r) => r.id))
  );

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === requests.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(requests.map((r) => r.id)));
    }
  }, [selectedIds.size, requests]);

  const selectedArray = useMemo(() => [...selectedIds], [selectedIds]);

  return (
    <div className="border-zinc-800 border-t">
      <div className="flex items-center gap-2 px-5 py-2">
        <button
          className="text-[10px] text-violet-400 hover:text-violet-300"
          onClick={toggleAll}
          type="button"
        >
          {selectedIds.size === requests.length ? "Deselect All" : "Select All"}
        </button>
        <span className="text-[10px] text-zinc-600">
          {selectedIds.size} of {requests.length} selected
        </span>
      </div>
      <div className="max-h-40 overflow-auto px-5">
        {requests.map((req) => (
          <label
            className="flex cursor-pointer items-center gap-2 py-1 text-xs hover:bg-zinc-800/30"
            key={req.id}
          >
            <input
              checked={selectedIds.has(req.id)}
              className="rounded border-zinc-600"
              onChange={() => toggleSelection(req.id)}
              type="checkbox"
            />
            <RiskBadge level={req.riskLevel} />
            <span className="min-w-0 flex-1 truncate text-zinc-300">
              {req.toolName}: {req.description.slice(0, 60)}
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 px-5 py-2">
        <button
          className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-medium text-red-300 text-xs hover:bg-red-500/20 disabled:opacity-50"
          disabled={selectedIds.size === 0}
          onClick={() => onRejectAll(selectedArray)}
          type="button"
        >
          Reject Selected ({selectedIds.size})
        </button>
        <button
          className="flex-1 rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white text-xs hover:bg-green-500 disabled:opacity-50"
          disabled={selectedIds.size === 0}
          onClick={() => onApproveAll(selectedArray)}
          type="button"
        >
          Approve Selected ({selectedIds.size})
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApprovalDialog({
  request,
  onApprove,
  onReject,
  onModify,
  batchRequests,
  onBatchApprove,
  onBatchReject,
}: ApprovalDialogProps) {
  const riskStyle = RISK_STYLES[request.riskLevel];
  const [showBatch, setShowBatch] = useState(false);

  const handleApprove = useCallback(() => {
    onApprove(request.id);
  }, [onApprove, request.id]);

  const handleReject = useCallback(() => {
    onReject(request.id);
  }, [onReject, request.id]);

  const handleModify = useCallback(() => {
    onModify?.(request.id);
  }, [onModify, request.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  const hasBatch = batchRequests && batchRequests.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={`w-full max-w-lg rounded-xl border bg-zinc-900 shadow-2xl ${riskStyle.border}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-zinc-800 border-b px-5 py-4">
          <svg
            aria-hidden="true"
            className={`h-5 w-5 ${RISK_ICON_COLORS[request.riskLevel]}`}
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
          <RiskBadge level={request.riskLevel} />
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            {request.confidenceScore !== undefined && (
              <ConfidenceScore score={request.confidenceScore} />
            )}
            {request.creditCost !== undefined && (
              <CreditCostEstimate cost={request.creditCost} />
            )}
          </div>

          <div>
            <span className="font-medium text-[10px] text-zinc-500 uppercase">
              Action
            </span>
            <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
              {request.description}
            </p>
          </div>

          <div>
            <span className="font-medium text-[10px] text-zinc-500 uppercase">
              Tool
            </span>
            <div className="mt-1 rounded bg-zinc-800/50 px-3 py-2 font-mono text-xs text-zinc-300">
              {request.toolName}
            </div>
          </div>

          {request.diff && <InlineDiffPreview diff={request.diff} />}

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

        {hasBatch && onBatchApprove && onBatchReject && (
          <div className="border-zinc-800 border-t">
            <button
              className="flex w-full items-center gap-2 px-5 py-2 text-violet-400 text-xs hover:bg-zinc-800/30"
              onClick={() => setShowBatch((p) => !p)}
              type="button"
            >
              <svg
                aria-hidden="true"
                className={`h-3 w-3 transition-transform ${showBatch ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="m9 5 7 7-7 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Batch Actions ({batchRequests.length} pending)
            </button>
            {showBatch && (
              <BatchApprovalPanel
                onApproveAll={onBatchApprove}
                onRejectAll={onBatchReject}
                requests={batchRequests}
              />
            )}
          </div>
        )}

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
