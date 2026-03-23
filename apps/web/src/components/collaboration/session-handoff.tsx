"use client";

import { useCallback, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface HandoffUser {
  id: string;
  name: string;
}

type HandoffStatus =
  | "idle"
  | "requesting"
  | "pending_approval"
  | "transferring";

interface SessionHandoffProps {
  className?: string;
  currentOwner: HandoffUser;
  currentUserId: string;
  onAccept?: () => void;
  onCancel?: () => void;
  onReject?: () => void;
  onRequest?: () => void;
  pendingRequester?: HandoffUser | null;
  status?: HandoffStatus;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function SessionHandoff({
  currentOwner,
  currentUserId,
  status = "idle",
  pendingRequester = null,
  onRequest,
  onAccept,
  onReject,
  onCancel,
  className = "",
}: SessionHandoffProps) {
  const [confirmReject, setConfirmReject] = useState(false);
  const isOwner = currentOwner.id === currentUserId;

  const handleReject = useCallback(() => {
    if (confirmReject) {
      onReject?.();
      setConfirmReject(false);
    } else {
      setConfirmReject(true);
    }
  }, [confirmReject, onReject]);

  return (
    <div
      className={`rounded-lg border border-zinc-700 bg-zinc-900/60 p-4 ${className}`}
    >
      {/* Current owner */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-xs text-zinc-500">Session Owner</span>
          <div className="font-medium text-sm text-zinc-200">
            {currentOwner.name}
            {isOwner && (
              <span className="ml-1 text-xs text-zinc-500">(you)</span>
            )}
          </div>
        </div>
        <div
          className={`h-2 w-2 rounded-full ${
            status === "idle" ? "bg-green-500" : "animate-pulse bg-yellow-500"
          }`}
        />
      </div>

      {/* Non-owner: request handoff */}
      {!isOwner && status === "idle" && (
        <button
          className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
          onClick={onRequest}
          type="button"
        >
          Request Control
        </button>
      )}

      {/* Non-owner: waiting for approval */}
      {!isOwner && status === "requesting" && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-yellow-400">
            Waiting for approval...
          </span>
          <button
            className="text-xs text-zinc-500 hover:text-zinc-300"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Owner: incoming request */}
      {isOwner && status === "pending_approval" && pendingRequester && (
        <div className="rounded border border-yellow-900/40 bg-yellow-950/20 p-3">
          <p className="mb-2 text-sm text-zinc-300">
            <span className="font-medium">{pendingRequester.name}</span> is
            requesting session control
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-500"
              onClick={onAccept}
              type="button"
            >
              Accept
            </button>
            <button
              className="flex-1 rounded bg-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-600"
              onClick={handleReject}
              type="button"
            >
              {confirmReject ? "Confirm Reject" : "Reject"}
            </button>
          </div>
        </div>
      )}

      {/* Transferring state */}
      {status === "transferring" && (
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <span className="text-blue-400 text-xs">Transferring control...</span>
        </div>
      )}
    </div>
  );
}

export type { HandoffStatus, HandoffUser, SessionHandoffProps };
