"use client";

import { useState } from "react";
import type { SessionEvent } from "@/stores/session.store";

interface CheckpointProps {
  event: SessionEvent;
  onApprove?: (eventId: string, feedback?: string) => void;
  onModify?: (eventId: string, instructions: string) => void;
  onReject?: (eventId: string, reason?: string) => void;
}

export function Checkpoint({
  event,
  onApprove,
  onReject,
  onModify,
}: CheckpointProps) {
  const [action, setAction] = useState<"idle" | "modify" | "submitted">("idle");
  const [modifyText, setModifyText] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const title = (event.data.title as string) ?? "Approval Required";
  const description =
    (event.data.description as string) ?? (event.data.message as string) ?? "";
  const checkpointType = (event.data.checkpointType as string) ?? "approval";

  function handleApprove() {
    setAction("submitted");
    onApprove?.(event.id);
  }

  function handleReject() {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    setAction("submitted");
    onReject?.(event.id, rejectReason || undefined);
  }

  function handleModify() {
    if (action !== "modify") {
      setAction("modify");
      return;
    }
    if (!modifyText.trim()) {
      return;
    }
    setAction("submitted");
    onModify?.(event.id, modifyText);
  }

  const isSubmitted = action === "submitted";

  return (
    <div className="rounded-lg border border-yellow-800/50 bg-yellow-950/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500/20">
          <svg
            className="h-3 w-3 text-yellow-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="font-medium text-xs text-yellow-400">{title}</span>
        <span className="ml-auto rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-500">
          {checkpointType}
        </span>
      </div>

      {description && (
        <div className="mb-3 text-xs text-zinc-300 leading-relaxed">
          {description}
        </div>
      )}

      {/* Modify text area */}
      {action === "modify" && (
        <div className="mb-3">
          <textarea
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
            onChange={(e) => setModifyText(e.target.value)}
            placeholder="Enter your modifications or instructions..."
            rows={3}
            value={modifyText}
          />
        </div>
      )}

      {/* Reject reason input */}
      {showRejectInput && action !== "submitted" && (
        <div className="mb-3">
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-red-500 focus:outline-none"
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional)..."
            value={rejectReason}
          />
        </div>
      )}

      {/* Action buttons */}
      {isSubmitted ? (
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
            <svg
              className="h-3 w-3 text-green-400"
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
          </div>
          <span className="text-xs text-zinc-400">Response submitted</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-green-700"
            onClick={handleApprove}
          >
            Approve
          </button>
          <button
            className="rounded-lg border border-red-800/50 bg-red-950/50 px-3 py-1.5 font-medium text-red-400 text-xs transition-colors hover:bg-red-900/50"
            onClick={handleReject}
          >
            Reject
          </button>
          <button
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-medium text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
            onClick={handleModify}
          >
            {action === "modify" ? "Submit Changes" : "Modify"}
          </button>
        </div>
      )}
    </div>
  );
}
