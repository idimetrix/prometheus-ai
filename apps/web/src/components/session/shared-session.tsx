"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSocket } from "@/hooks/use-socket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParticipantRole = "owner" | "editor" | "viewer";

interface Participant {
  avatar?: string;
  cursorColor: string;
  isOnline: boolean;
  joinedAt: string;
  name: string;
  role: ParticipantRole;
  userId: string;
}

interface SharedSessionProps {
  currentUserId: string;
  currentUserName: string;
  isOwner: boolean;
  projectId: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _CURSOR_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

const ROLE_LABELS: Record<ParticipantRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_COLORS: Record<ParticipantRole, string> = {
  owner: "bg-amber-900/30 text-amber-400",
  editor: "bg-violet-900/30 text-violet-400",
  viewer: "bg-zinc-800 text-zinc-400",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ShareButton({
  onShare,
  shareLink,
}: {
  onShare: () => void;
  shareLink: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!shareLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  }, [shareLink]);

  return (
    <div className="flex items-center gap-2">
      {shareLink ? (
        <div className="flex items-center gap-2">
          <input
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-300"
            onClick={(e) => (e.target as HTMLInputElement).select()}
            readOnly
            type="text"
            value={shareLink}
          />
          <button
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:bg-zinc-700"
            onClick={handleCopy}
            type="button"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      ) : (
        <button
          className="flex items-center gap-1.5 rounded border border-violet-800/50 bg-violet-950/30 px-3 py-1.5 font-medium text-violet-400 text-xs transition-colors hover:bg-violet-900/40"
          onClick={onShare}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Share Session
        </button>
      )}
    </div>
  );
}

function ParticipantList({
  participants,
  currentUserId,
  isOwner,
  onRoleChange,
}: {
  participants: Participant[];
  currentUserId: string;
  isOwner: boolean;
  onRoleChange: (userId: string, role: ParticipantRole) => void;
}) {
  return (
    <div className="space-y-1">
      {participants.map((p) => (
        <div
          className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-800/50"
          key={p.userId}
        >
          <div className="flex items-center gap-2">
            {/* Online indicator */}
            <div className="relative">
              {p.avatar ? (
                <Image
                  alt={p.name}
                  className="h-6 w-6 rounded-full object-cover"
                  height={24}
                  src={p.avatar}
                  width={24}
                />
              ) : (
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full font-medium text-[10px] text-white"
                  style={{ backgroundColor: p.cursorColor }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
              )}
              {p.isOnline && (
                <div className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-zinc-900 bg-green-500" />
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-zinc-200">
                {p.name}
                {p.userId === currentUserId && (
                  <span className="ml-1 text-zinc-500">(you)</span>
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Role badge */}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${ROLE_COLORS[p.role]}`}
            >
              {ROLE_LABELS[p.role]}
            </span>

            {/* Role change dropdown (only for owner, not for self) */}
            {isOwner && p.userId !== currentUserId && p.role !== "owner" && (
              <select
                aria-label={`Change role for ${p.name}`}
                className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-400"
                onChange={(e) =>
                  onRoleChange(p.userId, e.target.value as ParticipantRole)
                }
                value={p.role}
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PresenceAvatars({ participants }: { participants: Participant[] }) {
  const online = participants.filter((p) => p.isOnline);

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {online.slice(0, 5).map((p) => (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 font-medium text-[9px] text-white"
            key={p.userId}
            style={{ backgroundColor: p.cursorColor }}
            title={`${p.name} (${ROLE_LABELS[p.role]})`}
          >
            {p.avatar ? (
              <Image
                alt={p.name}
                className="h-full w-full rounded-full object-cover"
                height={24}
                src={p.avatar}
                width={24}
              />
            ) : (
              p.name.charAt(0).toUpperCase()
            )}
          </div>
        ))}
        {online.length > 5 && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-800 text-[9px] text-zinc-400">
            +{online.length - 5}
          </div>
        )}
      </div>
      <span className="text-[10px] text-zinc-500">{online.length} online</span>
    </div>
  );
}

function HandoffControls({
  onHandoffToAgent,
  onHandoffToHuman,
  isAgentActive,
}: {
  onHandoffToAgent: () => void;
  onHandoffToHuman: () => void;
  isAgentActive: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {isAgentActive ? (
        <button
          className="rounded border border-amber-800/50 bg-amber-950/30 px-3 py-1.5 font-medium text-amber-400 text-xs transition-colors hover:bg-amber-900/40"
          onClick={onHandoffToHuman}
          type="button"
        >
          Hand off to Human
        </button>
      ) : (
        <button
          className="rounded border border-violet-800/50 bg-violet-950/30 px-3 py-1.5 font-medium text-violet-400 text-xs transition-colors hover:bg-violet-900/40"
          onClick={onHandoffToAgent}
          type="button"
        >
          Hand off to Agent
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SharedSession({
  currentUserId,
  currentUserName,
  isOwner,
  sessionId,
  projectId: _projectId,
}: SharedSessionProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [showParticipantList, setShowParticipantList] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const { socket, isConnected, emit, on } = useSocket(`session:${sessionId}`);

  const myRole = useMemo(() => {
    const me = participants.find((p) => p.userId === currentUserId);
    return me?.role ?? (isOwner ? "owner" : "viewer");
  }, [participants, currentUserId, isOwner]);

  // Join session on connect
  useEffect(() => {
    if (!isConnected) {
      return;
    }

    emit("shared:join", {
      sessionId,
      userId: currentUserId,
      name: currentUserName,
      role: isOwner ? "owner" : "viewer",
    });

    return () => {
      emit("shared:leave", { sessionId, userId: currentUserId });
    };
  }, [isConnected, sessionId, currentUserId, currentUserName, isOwner, emit]);

  // Listen for events
  useEffect(() => {
    if (!socket) {
      return;
    }

    const cleanups: Array<() => void> = [];

    cleanups.push(
      on("shared:participants", (data: unknown) => {
        const d = data as { participants: Participant[] };
        setParticipants(d.participants ?? []);
      }) ??
        (() => {
          /* no-op fallback */
        })
    );

    cleanups.push(
      on("shared:participant_joined", (data: unknown) => {
        const d = data as { participant: Participant };
        setParticipants((prev) => {
          if (prev.some((p) => p.userId === d.participant.userId)) {
            return prev.map((p) =>
              p.userId === d.participant.userId ? { ...p, isOnline: true } : p
            );
          }
          return [...prev, d.participant];
        });
      }) ??
        (() => {
          /* no-op fallback */
        })
    );

    cleanups.push(
      on("shared:participant_left", (data: unknown) => {
        const d = data as { userId: string };
        setParticipants((prev) =>
          prev.map((p) =>
            p.userId === d.userId ? { ...p, isOnline: false } : p
          )
        );
      }) ??
        (() => {
          /* no-op fallback */
        })
    );

    cleanups.push(
      on("shared:role_changed", (data: unknown) => {
        const d = data as { userId: string; role: ParticipantRole };
        setParticipants((prev) =>
          prev.map((p) => (p.userId === d.userId ? { ...p, role: d.role } : p))
        );
      }) ??
        (() => {
          /* no-op fallback */
        })
    );

    cleanups.push(
      on("shared:agent_status", (data: unknown) => {
        const d = data as { active: boolean };
        setIsAgentActive(d.active);
      }) ??
        (() => {
          /* no-op fallback */
        })
    );

    return () => {
      for (const fn of cleanups) {
        fn();
      }
    };
  }, [socket, on]);

  const handleShare = useCallback(() => {
    const token = crypto.randomUUID();
    const link = `${window.location.origin}/session/join/${token}`;
    setShareLink(link);
    emit("shared:generate_link", { sessionId, token });
  }, [sessionId, emit]);

  const handleRoleChange = useCallback(
    (userId: string, role: ParticipantRole) => {
      emit("shared:set_role", { sessionId, userId, role });
      setParticipants((prev) =>
        prev.map((p) => (p.userId === userId ? { ...p, role } : p))
      );
    },
    [sessionId, emit]
  );

  const handleHandoffToAgent = useCallback(() => {
    emit("shared:handoff_agent", { sessionId });
    setIsAgentActive(true);
  }, [sessionId, emit]);

  const handleHandoffToHuman = useCallback(() => {
    emit("shared:handoff_human", { sessionId });
    setIsAgentActive(false);
  }, [sessionId, emit]);

  return (
    <div className="flex flex-col gap-3">
      {/* Top bar with presence + share */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
        <PresenceAvatars participants={participants} />

        <div className="flex items-center gap-3">
          {(myRole === "owner" || myRole === "editor") && (
            <HandoffControls
              isAgentActive={isAgentActive}
              onHandoffToAgent={handleHandoffToAgent}
              onHandoffToHuman={handleHandoffToHuman}
            />
          )}

          <ShareButton onShare={handleShare} shareLink={shareLink} />

          {/* Toggle participant list */}
          <button
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-300 transition-colors hover:bg-zinc-700"
            onClick={() => setShowParticipantList(!showParticipantList)}
            type="button"
          >
            {participants.length} participants
          </button>
        </div>
      </div>

      {/* Participant list panel */}
      {showParticipantList && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
              Session Participants
            </span>
            <button
              className="text-zinc-500 hover:text-zinc-300"
              onClick={() => setShowParticipantList(false)}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M6 18 18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <ParticipantList
            currentUserId={currentUserId}
            isOwner={isOwner}
            onRoleChange={handleRoleChange}
            participants={participants}
          />
        </div>
      )}
    </div>
  );
}
