"use client";

import { useCallback, useEffect, useState } from "react";
import { useSocket } from "@/hooks/use-socket";

interface Viewer {
  avatar?: string;
  isOwner: boolean;
  joinedAt: string;
  name: string;
  userId: string;
}

interface SessionPresenceProps {
  currentUserId: string;
  currentUserName: string;
  isSessionOwner: boolean;
  sessionId: string;
}

export function SessionPresence({
  sessionId,
  currentUserId,
  currentUserName,
  isSessionOwner,
}: SessionPresenceProps) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [hasControl, setHasControl] = useState(isSessionOwner);
  const { socket, isConnected, emit, on } = useSocket(`session:${sessionId}`);

  // Announce presence when connected
  useEffect(() => {
    if (!isConnected) {
      return;
    }

    emit("session:join", {
      sessionId,
      userId: currentUserId,
      name: currentUserName,
      isOwner: isSessionOwner,
    });

    return () => {
      emit("session:leave", { sessionId, userId: currentUserId });
    };
  }, [
    isConnected,
    sessionId,
    currentUserId,
    currentUserName,
    isSessionOwner,
    emit,
  ]);

  // Listen for presence updates
  useEffect(() => {
    if (!socket) {
      return;
    }

    const cleanups: Array<() => void> = [];

    cleanups.push(
      on("session:viewers", (data: unknown) => {
        const d = data as { viewers: Viewer[] };
        setViewers(d.viewers ?? []);
      }) ?? (() => {})
    );

    cleanups.push(
      on("session:viewer_joined", (data: unknown) => {
        const d = data as { viewer: Viewer };
        setViewers((prev) => {
          if (prev.some((v) => v.userId === d.viewer.userId)) {
            return prev;
          }
          return [...prev, d.viewer];
        });
      }) ?? (() => {})
    );

    cleanups.push(
      on("session:viewer_left", (data: unknown) => {
        const d = data as { userId: string };
        setViewers((prev) => prev.filter((v) => v.userId !== d.userId));
      }) ?? (() => {})
    );

    cleanups.push(
      on("session:control_changed", (data: unknown) => {
        const d = data as { userId: string };
        setHasControl(d.userId === currentUserId);
      }) ?? (() => {})
    );

    return () => cleanups.forEach((fn) => fn());
  }, [socket, on, currentUserId]);

  const handleTakeover = useCallback(() => {
    emit("session:takeover", { sessionId, userId: currentUserId });
    setHasControl(true);
  }, [emit, sessionId, currentUserId]);

  const handleRelease = useCallback(() => {
    emit("session:release", { sessionId, userId: currentUserId });
    setHasControl(false);
  }, [emit, sessionId, currentUserId]);

  const otherViewers = viewers.filter((v) => v.userId !== currentUserId);

  return (
    <div className="flex items-center gap-3">
      {/* Viewer avatars */}
      {otherViewers.length > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="flex -space-x-1.5">
            {otherViewers.slice(0, 5).map((viewer) => (
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-700 font-medium text-[9px] text-zinc-200"
                key={viewer.userId}
                title={viewer.name}
              >
                {viewer.avatar ? (
                  <img
                    alt={viewer.name}
                    className="h-full w-full rounded-full object-cover"
                    src={viewer.avatar}
                  />
                ) : (
                  viewer.name.charAt(0).toUpperCase()
                )}
              </div>
            ))}
            {otherViewers.length > 5 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-800 text-[9px] text-zinc-400">
                +{otherViewers.length - 5}
              </div>
            )}
          </div>
          <span className="text-[10px] text-zinc-500">
            {otherViewers.length} watching
          </span>
        </div>
      )}

      {/* Watching indicator */}
      {!isSessionOwner && (
        <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1">
          <svg
            className="h-3 w-3 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[10px] text-zinc-400">Watching</span>
        </div>
      )}

      {/* Takeover / Release button */}
      {hasControl ? (
        !isSessionOwner && (
          <button
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-medium text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
            onClick={handleRelease}
          >
            Release Control
          </button>
        )
      ) : (
        <button
          className="rounded-lg border border-violet-800/50 bg-violet-950/30 px-3 py-1.5 font-medium text-violet-400 text-xs transition-colors hover:bg-violet-900/40"
          onClick={handleTakeover}
        >
          Take Control
        </button>
      )}
    </div>
  );
}
