"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamMember {
  activeSessionId?: string;
  avatarUrl?: string;
  id: string;
  lastActive: string;
  name: string;
  role: string;
  status: "online" | "offline" | "busy";
}

export interface TeamActivity {
  action: string;
  id: string;
  memberId: string;
  memberName: string;
  sessionId?: string;
  timestamp: string;
}

export interface TeamStats {
  averageQualityScore: number;
  creditsUsed: number;
  tasksCompleted: number;
  totalSessions: number;
}

export interface TeamDashboardProps {
  activities?: TeamActivity[];
  members?: TeamMember[];
  onViewSession?: (sessionId: string) => void;
  stats?: TeamStats;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500",
  offline: "bg-zinc-500",
  busy: "bg-amber-500",
};

// ---------------------------------------------------------------------------
// TeamDashboard
// ---------------------------------------------------------------------------

export function TeamDashboard({
  members = [],
  activities = [],
  stats,
  onViewSession,
}: TeamDashboardProps) {
  const [filter, setFilter] = useState<"all" | "online" | "offline" | "busy">(
    "all"
  );

  const filteredMembers = useMemo(
    () =>
      filter === "all" ? members : members.filter((m) => m.status === filter),
    [members, filter]
  );

  const handleViewSession = useCallback(
    (sessionId: string) => {
      onViewSession?.(sessionId);
    },
    [onViewSession]
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Tasks Completed" value={stats.tasksCompleted} />
          <StatCard label="Total Sessions" value={stats.totalSessions} />
          <StatCard
            label="Quality Score"
            value={`${(stats.averageQualityScore * 100).toFixed(0)}%`}
          />
          <StatCard label="Credits Used" value={stats.creditsUsed} />
        </div>
      )}

      {/* Team Members */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-lg text-zinc-100">Team Members</h2>
          <div className="flex gap-1">
            {(["all", "online", "busy", "offline"] as const).map((status) => (
              <button
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  filter === status
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800"
                }`}
                key={status}
                onClick={() => setFilter(status)}
                type="button"
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredMembers.map((member) => (
            <div
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
              key={member.id}
            >
              <div className="relative">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 font-medium text-sm text-zinc-300">
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <span
                  className={`absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-zinc-900 ${STATUS_COLORS[member.status] ?? "bg-zinc-500"}`}
                />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm text-zinc-200">
                  {member.name}
                </p>
                <p className="text-xs text-zinc-500">{member.role}</p>
              </div>
              {member.activeSessionId && (
                <button
                  className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                  onClick={() =>
                    handleViewSession(member.activeSessionId as string)
                  }
                  type="button"
                >
                  View Session
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="mb-4 font-semibold text-lg text-zinc-100">
          Recent Activity
        </h2>
        <div className="flex flex-col gap-2">
          {activities.length === 0 && (
            <p className="py-4 text-center text-sm text-zinc-500">
              No recent activity
            </p>
          )}
          {activities.map((activity) => (
            <div
              className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2"
              key={activity.id}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-zinc-300">
                  {activity.memberName}
                </span>
                <span className="text-sm text-zinc-500">{activity.action}</span>
              </div>
              <div className="flex items-center gap-2">
                {activity.sessionId && (
                  <button
                    className="text-violet-400 text-xs hover:text-violet-300"
                    onClick={() =>
                      handleViewSession(activity.sessionId as string)
                    }
                    type="button"
                  >
                    View
                  </button>
                )}
                <span className="text-xs text-zinc-600">
                  {activity.timestamp}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="font-bold text-2xl text-zinc-100">{value}</p>
    </div>
  );
}
