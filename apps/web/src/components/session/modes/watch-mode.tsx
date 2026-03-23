"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useSessionStore } from "@/stores/session.store";

interface WatchModeProps {
  sessionId: string;
}

interface PresenceUser {
  avatar?: string;
  id: string;
  isControlling: boolean;
  name: string;
}

export function WatchMode({ sessionId }: WatchModeProps) {
  const { terminalLines, events, isConnected } = useSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasControl, setHasControl] = useState(false);

  const takeoverMutation = trpc.sessions.pause.useMutation();
  const releaseMutation = trpc.sessions.resume.useMutation();

  // Derive presence from events
  const presenceUsers: PresenceUser[] = events
    .filter((e) => e.type === "presence" || e.type === "user_joined")
    .reduce<PresenceUser[]>((acc, e) => {
      const userId = String(e.data?.userId ?? "");
      if (!userId || acc.some((u) => u.id === userId)) {
        return acc;
      }
      acc.push({
        id: userId,
        name: String(e.data?.userName ?? e.data?.name ?? "User"),
        avatar: e.data?.avatar as string | undefined,
        isControlling: Boolean(e.data?.isControlling),
      });
      return acc;
    }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  async function handleTakeover() {
    try {
      await takeoverMutation.mutateAsync({
        sessionId,
        reason: "user takeover",
      });
      setHasControl(true);
    } catch (err) {
      console.error("Failed to take control:", err);
    }
  }

  async function handleRelease() {
    try {
      await releaseMutation.mutateAsync({ sessionId });
      setHasControl(false);
    } catch (err) {
      console.error("Failed to release control:", err);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Top bar: presence + controls */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        {/* Presence indicators */}
        <div className="flex items-center gap-3">
          <span className="font-medium text-xs text-zinc-400">Watching:</span>
          <div className="flex items-center -space-x-2">
            {presenceUsers.length === 0 ? (
              <span className="text-xs text-zinc-600">Just you</span>
            ) : (
              presenceUsers.map((user) => (
                <div
                  className="relative"
                  key={user.id}
                  title={`${user.name}${user.isControlling ? " (controlling)" : ""}`}
                >
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 font-medium text-[10px] ${
                      user.isControlling
                        ? "border-violet-500 bg-violet-600 text-white"
                        : "border-zinc-800 bg-zinc-700 text-zinc-300"
                    }`}
                  >
                    {user.name[0]?.toUpperCase() ?? "?"}
                  </div>
                  {user.isControlling && (
                    <div className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border border-zinc-900 bg-green-500" />
                  )}
                </div>
              ))
            )}
          </div>
          <span
            className={`flex items-center gap-1 text-xs ${
              isConnected ? "text-green-400" : "text-red-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? "animate-pulse bg-green-500" : "bg-red-500"
              }`}
            />
            {isConnected ? "Live" : "Disconnected"}
          </span>
        </div>

        {/* Takeover / Release */}
        <div className="flex items-center gap-2">
          {hasControl ? (
            <button
              className="flex items-center gap-1.5 rounded-lg border border-yellow-700/50 bg-yellow-950/50 px-3 py-1.5 font-medium text-xs text-yellow-400 transition-colors hover:bg-yellow-900/50 disabled:opacity-50"
              disabled={releaseMutation.isPending}
              onClick={handleRelease}
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
                  d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Release Control
            </button>
          ) : (
            <button
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-violet-700 disabled:opacity-50"
              disabled={takeoverMutation.isPending}
              onClick={handleTakeover}
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
                  d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Take Control
            </button>
          )}
        </div>
      </div>

      {/* Main terminal view */}
      <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
          <div className="flex gap-1">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="font-medium text-xs text-zinc-500">
            Live Session Output
          </span>
          {hasControl && (
            <span className="ml-auto rounded-full bg-violet-500/10 px-2 py-0.5 font-medium text-[10px] text-violet-400">
              You have control
            </span>
          )}
        </div>
        <div
          className="h-[calc(100%-2.5rem)] overflow-auto p-3 font-mono text-xs"
          ref={scrollRef}
        >
          {terminalLines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-zinc-700">
              <span className="animate-pulse">Waiting for output...</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {Array.from(terminalLines.entries()).map(([lineNum, line]) => (
                <div className="flex gap-2" key={`watch-line-${lineNum}`}>
                  {line.timestamp && (
                    <span className="shrink-0 text-zinc-700">
                      {new Date(line.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  )}
                  <span
                    className={(() => {
                      if (line.content.startsWith("[ERROR]")) {
                        return "text-red-400";
                      }
                      if (line.content.startsWith("[WARN]")) {
                        return "text-yellow-400";
                      }
                      if (line.content.startsWith("[THINK]")) {
                        return "text-violet-400 italic";
                      }
                      if (line.content.startsWith("[SUCCESS]")) {
                        return "text-green-400";
                      }
                      return "text-zinc-300";
                    })()}
                  >
                    {line.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity events sidebar strip */}
      <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2">
        <span className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
          Recent Events
        </span>
        <div className="flex flex-1 items-center gap-2 overflow-x-auto">
          {events.slice(-8).map((evt) => (
            <span
              className="shrink-0 rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-0.5 text-[10px] text-zinc-400"
              key={evt.id}
            >
              {evt.type}
            </span>
          ))}
          {events.length === 0 && (
            <span className="text-[10px] text-zinc-600">No events yet</span>
          )}
        </div>
      </div>
    </div>
  );
}
