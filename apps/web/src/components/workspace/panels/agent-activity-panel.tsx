"use client";

import { useMemo, useState } from "react";
import { type SessionEvent, useSessionStore } from "@/stores/session.store";

type TabId = "activity" | "reasoning" | "tools";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "reasoning", label: "Reasoning" },
  { id: "tools", label: "Tools" },
];

const ROLE_COLORS: Record<string, string> = {
  architect: "bg-violet-500/20 text-violet-400",
  "backend-coder": "bg-blue-500/20 text-blue-400",
  "frontend-coder": "bg-cyan-500/20 text-cyan-400",
  "test-engineer": "bg-green-500/20 text-green-400",
  "security-auditor": "bg-red-500/20 text-red-400",
  discovery: "bg-amber-500/20 text-amber-400",
  "ci-loop": "bg-orange-500/20 text-orange-400",
};

const STATUS_INDICATORS: Record<string, string> = {
  working: "bg-green-500",
  idle: "bg-zinc-500",
  waiting: "bg-yellow-500",
  error: "bg-red-500",
  terminated: "bg-zinc-700",
};

function RoleBadge({ role }: { role: string }) {
  const colorClass = ROLE_COLORS[role] ?? "bg-zinc-500/20 text-zinc-400";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-medium text-[10px] ${colorClass}`}
    >
      {role}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const bgClass = STATUS_INDICATORS[status] ?? "bg-zinc-500";
  return (
    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${bgClass}`} />
  );
}

function ActivityTab({ events }: { events: SessionEvent[] }) {
  return (
    <div className="space-y-1 p-2">
      {events.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-600">
          No activity yet
        </div>
      ) : (
        events
          .slice()
          .reverse()
          .map((event) => (
            <div
              className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2"
              key={event.id}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-600">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                {typeof event.data.role === "string" && (
                  <RoleBadge role={event.data.role} />
                )}
                {typeof event.data.status === "string" && (
                  <StatusDot status={event.data.status} />
                )}
              </div>
              <div className="mt-1 text-xs text-zinc-300">
                <span className="font-medium text-zinc-500">{event.type}</span>
                {typeof event.data.message === "string" && (
                  <span className="ml-1.5">{event.data.message}</span>
                )}
              </div>
            </div>
          ))
      )}
    </div>
  );
}

function ReasoningTab({ reasoning }: { reasoning: string[] }) {
  return (
    <div className="space-y-2 p-2">
      {reasoning.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-600">
          No reasoning steps yet
        </div>
      ) : (
        reasoning
          .slice()
          .reverse()
          .map((thought) => {
            const stepNum = reasoning.indexOf(thought) + 1;
            return (
              <div
                className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2 text-xs text-zinc-300"
                key={`reasoning-${stepNum}-${thought.slice(0, 32)}`}
              >
                <span className="mr-2 text-violet-500/60">{stepNum}.</span>
                {thought}
              </div>
            );
          })
      )}
    </div>
  );
}

function ToolsTab({ events }: { events: SessionEvent[] }) {
  const toolEvents = useMemo(
    () =>
      events.filter((e) => e.type === "tool_call" || e.type === "tool_result"),
    [events]
  );

  return (
    <div className="space-y-1 p-2">
      {toolEvents.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-600">
          No tool calls yet
        </div>
      ) : (
        toolEvents
          .slice()
          .reverse()
          .map((event) => (
            <div
              className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2"
              key={event.id}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1 py-0.5 font-medium text-[10px] ${
                    event.type === "tool_call"
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-green-500/20 text-green-400"
                  }`}
                >
                  {event.type === "tool_call" ? "CALL" : "RESULT"}
                </span>
                {typeof event.data.tool === "string" && (
                  <span className="font-mono text-xs text-zinc-300">
                    {event.data.tool}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-zinc-600">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {typeof event.data.result === "string" && (
                <div className="mt-1 max-h-20 overflow-hidden font-mono text-[11px] text-zinc-500">
                  {event.data.result.slice(0, 200)}
                  {event.data.result.length > 200 && "..."}
                </div>
              )}
            </div>
          ))
      )}
    </div>
  );
}

export function AgentActivityPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("activity");
  const events = useSessionStore((s) => s.events);
  const reasoning = useSessionStore((s) => s.reasoning);
  const agents = useSessionStore((s) => s.agents);

  return (
    <div className="flex h-full flex-col">
      {/* Header with agent status */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          Agents
        </h3>
        {agents.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {agents.map((agent) => (
              <div className="flex items-center gap-1.5" key={agent.id}>
                <StatusDot status={agent.status} />
                <RoleBadge role={agent.role} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-zinc-800 border-b">
        {TABS.map((tab) => (
          <button
            className={`flex-1 px-3 py-1.5 text-xs transition-colors ${
              activeTab === tab.id
                ? "border-violet-500 border-b-2 text-violet-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "activity" && <ActivityTab events={events} />}
        {activeTab === "reasoning" && <ReasoningTab reasoning={reasoning} />}
        {activeTab === "tools" && <ToolsTab events={events} />}
      </div>
    </div>
  );
}
