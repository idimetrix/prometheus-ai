"use client";

import { useCallback } from "react";
import type {
  CollaborationParticipant,
  CollaborationRole,
} from "@/hooks/use-collaboration";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ControlRequest {
  requestedAt: string;
  userId: string;
  userName: string;
}

interface ControlPanelProps {
  controlRequests: ControlRequest[];
  currentController: string | null;
  currentUserId: string;
  myRole: CollaborationRole;
  onGrantControl: (userId: string) => void;
  onRequestControl: () => void;
  onRevokeControl: (userId: string) => void;
  participants: CollaborationParticipant[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ControlPanel({
  participants,
  currentUserId,
  currentController,
  controlRequests,
  myRole,
  onRequestControl,
  onGrantControl,
  onRevokeControl,
}: ControlPanelProps) {
  const isOwner = myRole === "owner";
  const isController = currentController === currentUserId;
  const controllerParticipant = participants.find(
    (p) => p.userId === currentController
  );

  const handleRequestOrRelease = useCallback(() => {
    if (isController) {
      // Release control by revoking own access
      onRevokeControl(currentUserId);
    } else {
      onRequestControl();
    }
  }, [isController, currentUserId, onRevokeControl, onRequestControl]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      {/* Current controller */}
      <div>
        <div className="mb-1 font-medium text-[10px] text-zinc-500 uppercase tracking-wide">
          Current Controller
        </div>
        {controllerParticipant ? (
          <div className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-white"
              style={{
                backgroundColor: getColorForUser(controllerParticipant.userId),
              }}
            >
              {controllerParticipant.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-xs text-zinc-200">
              {controllerParticipant.name}
              {controllerParticipant.userId === currentUserId && (
                <span className="ml-1 text-zinc-500">(you)</span>
              )}
            </span>
            <span className="ml-auto rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300">
              {controllerParticipant.role}
            </span>
          </div>
        ) : (
          <div className="text-xs text-zinc-600 italic">No one has control</div>
        )}
      </div>

      {/* Take/Release control button */}
      {!isOwner && (
        <button
          className={`rounded-lg px-3 py-2 font-medium text-xs transition-colors ${
            isController
              ? "border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              : "border border-violet-800/50 bg-violet-950/30 text-violet-400 hover:bg-violet-900/40"
          }`}
          onClick={handleRequestOrRelease}
          type="button"
        >
          {isController ? "Release Control" : "Request Control"}
        </button>
      )}

      {/* Control request queue (owner only) */}
      {isOwner && controlRequests.length > 0 && (
        <div>
          <div className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wide">
            Control Requests ({controlRequests.length})
          </div>
          <div className="space-y-2">
            {controlRequests.map((request) => (
              <div
                className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2"
                key={request.userId}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] text-white"
                  style={{
                    backgroundColor: getColorForUser(request.userId),
                  }}
                >
                  {request.userName.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 text-xs text-zinc-300">
                  {request.userName}
                </span>
                <span className="text-[10px] text-zinc-600">
                  {new Date(request.requestedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  className="rounded bg-green-500/20 px-2 py-0.5 text-[10px] text-green-400 hover:bg-green-500/30"
                  onClick={() => onGrantControl(request.userId)}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-500/30"
                  onClick={() => onRevokeControl(request.userId)}
                  type="button"
                >
                  Deny
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Participant list with roles (owner can manage) */}
      {isOwner && (
        <div>
          <div className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wide">
            Participants
          </div>
          <div className="space-y-1">
            {participants.map((p) => {
              const isMe = p.userId === currentUserId;
              const canRevoke =
                !isMe &&
                (p.role === "contributor" || p.userId === currentController);

              return (
                <div
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-800/50"
                  key={p.userId}
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] text-white"
                    style={{
                      backgroundColor: getColorForUser(p.userId),
                    }}
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 text-xs text-zinc-300">
                    {p.name}
                    {isMe && <span className="ml-1 text-zinc-600">(you)</span>}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] ${(() => {
                      if (p.role === "owner") {
                        return "bg-amber-500/20 text-amber-400";
                      }
                      if (p.role === "contributor") {
                        return "bg-violet-500/20 text-violet-300";
                      }
                      return "bg-zinc-700 text-zinc-400";
                    })()}`}
                  >
                    {p.role}
                  </span>
                  {canRevoke && (
                    <button
                      className="rounded px-1.5 py-0.5 text-[9px] text-red-400 hover:bg-red-500/20"
                      onClick={() => onRevokeControl(p.userId)}
                      type="button"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Idle auto-release notice */}
      {isController && (
        <div className="text-[10px] text-zinc-600 italic">
          Control auto-releases after 3 minutes of inactivity
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

function getColorForUser(userId: string): string {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length] ?? "#8b5cf6";
}
