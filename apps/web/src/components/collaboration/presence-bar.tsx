"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import type { CollaborationParticipant } from "@/hooks/use-collaboration";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresenceBarProps {
  className?: string;
  currentUserId: string;
  onInvite?: () => void;
  participants: CollaborationParticipant[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500",
  idle: "bg-yellow-500",
  viewing: "bg-zinc-500",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  contributor: "Contributor",
  viewer: "Viewer",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresenceBar({
  participants,
  currentUserId,
  onInvite,
  className = "",
}: PresenceBarProps) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const handleAvatarClick = useCallback((userId: string) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  }, []);

  const maxVisible = 6;
  const visibleParticipants = participants.slice(0, maxVisible);
  const overflowCount = Math.max(0, participants.length - maxVisible);

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Participant count */}
      <span className="text-[10px] text-zinc-500">
        {participants.length} participant{participants.length === 1 ? "" : "s"}
      </span>

      {/* Avatar stack */}
      <div className="relative flex -space-x-1.5">
        {visibleParticipants.map((participant) => {
          const isMe = participant.userId === currentUserId;
          const statusColor =
            STATUS_COLORS[participant.status] ?? "bg-zinc-500";
          const isExpanded = expandedUserId === participant.userId;

          return (
            <div className="relative" key={participant.userId}>
              <button
                aria-label={`${participant.name} - ${participant.status}`}
                className={`relative flex h-7 w-7 items-center justify-center rounded-full border-2 font-medium text-[10px] text-white transition-transform hover:z-10 hover:scale-110 ${
                  isMe
                    ? "border-violet-500 ring-1 ring-violet-500/30"
                    : "border-zinc-900"
                }`}
                onClick={() => handleAvatarClick(participant.userId)}
                style={{ backgroundColor: getColorForUser(participant.userId) }}
                type="button"
              >
                {participant.avatar ? (
                  <Image
                    alt={participant.name}
                    className="h-full w-full rounded-full object-cover"
                    height={28}
                    src={participant.avatar}
                    width={28}
                  />
                ) : (
                  getInitials(participant.name)
                )}
                {/* Status indicator */}
                <span
                  className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-zinc-900 ${statusColor}`}
                />
              </button>

              {/* Expanded user details popover */}
              {isExpanded && (
                <div className="absolute top-full left-1/2 z-50 mt-2 w-48 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
                  <div className="mb-1 font-medium text-xs text-zinc-200">
                    {participant.name}
                    {isMe && (
                      <span className="ml-1 text-[10px] text-zinc-500">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${statusColor}`}
                    />
                    <span className="text-zinc-400 capitalize">
                      {participant.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    Role: {ROLE_LABELS[participant.role] ?? participant.role}
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-600">
                    Joined{" "}
                    {new Date(participant.joinedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {overflowCount > 0 && (
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-800 text-[10px] text-zinc-400">
            +{overflowCount}
          </div>
        )}
      </div>

      {/* Invite button */}
      {onInvite && (
        <button
          className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          onClick={onInvite}
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
              d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Invite
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

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
