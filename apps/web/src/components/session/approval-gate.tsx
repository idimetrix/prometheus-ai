"use client";

import { useCallback, useState } from "react";

interface ApprovalGateProps {
  action: string;
  checkpointId: string;
  description: string;
  details?: Record<string, unknown>;
  onApprove: (checkpointId: string, data?: Record<string, unknown>) => void;
  onModify?: (
    checkpointId: string,
    modifications: Record<string, unknown>
  ) => void;
  onReject: (checkpointId: string, reason: string) => void;
  riskLevel: "low" | "medium" | "high" | "critical";
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-500/10 text-green-400 border-green-500/30",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
};

export function ApprovalGate({
  checkpointId,
  action,
  description,
  riskLevel,
  details,
  onApprove,
  onReject,
  onModify,
}: ApprovalGateProps) {
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const handleApprove = useCallback(() => {
    onApprove(checkpointId, details);
  }, [checkpointId, details, onApprove]);

  const handleReject = useCallback(() => {
    if (showRejectInput && rejectReason.trim()) {
      onReject(checkpointId, rejectReason.trim());
    } else {
      setShowRejectInput(true);
    }
  }, [checkpointId, rejectReason, showRejectInput, onReject]);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-semibold text-sm text-white">Approval Required</h4>
        <span
          className={`rounded-full border px-2 py-0.5 font-medium text-xs ${RISK_COLORS[riskLevel] ?? ""}`}
        >
          {riskLevel}
        </span>
      </div>

      <div className="mb-3">
        <div className="font-medium text-sm text-zinc-300">{action}</div>
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      </div>

      {details && Object.keys(details).length > 0 && (
        <pre className="mb-3 max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-400">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}

      {showRejectInput && (
        <textarea
          className="mb-3 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason for rejection..."
          rows={2}
          value={rejectReason}
        />
      )}

      <div className="flex gap-2">
        <button
          className="rounded-lg bg-green-600 px-4 py-2 font-medium text-sm text-white hover:bg-green-500"
          onClick={handleApprove}
          type="button"
        >
          Approve
        </button>
        <button
          className="rounded-lg bg-red-600/20 px-4 py-2 font-medium text-red-400 text-sm hover:bg-red-600/30"
          onClick={handleReject}
          type="button"
        >
          {showRejectInput ? "Confirm Reject" : "Reject"}
        </button>
        {onModify && (
          <button
            className="rounded-lg bg-zinc-700 px-4 py-2 font-medium text-sm text-zinc-300 hover:bg-zinc-600"
            onClick={() => onModify(checkpointId, {})}
            type="button"
          >
            Modify
          </button>
        )}
      </div>
    </div>
  );
}
