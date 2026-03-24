"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@prometheus/ui";
import { Activity, ArrowRight, Clock, Cpu, OctagonX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AgentCard } from "@/components/fleet/agent-card";
import { FleetDashboard } from "@/components/fleet/fleet-dashboard";
import { trpc } from "@/lib/trpc";

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-500/20 text-violet-400",
  discovery: "bg-blue-500/20 text-blue-400",
  architect: "bg-indigo-500/20 text-indigo-400",
  frontend: "bg-cyan-500/20 text-cyan-400",
  backend: "bg-green-500/20 text-green-400",
  database: "bg-yellow-500/20 text-yellow-400",
  devops: "bg-orange-500/20 text-orange-400",
  testing: "bg-pink-500/20 text-pink-400",
  security: "bg-red-500/20 text-red-400",
  documentation: "bg-zinc-500/20 text-zinc-400",
  "ci-loop": "bg-amber-500/20 text-amber-400",
  deployment: "bg-emerald-500/20 text-emerald-400",
};

function taskBadgeVariant(
  status: string
): "success" | "default" | "destructive" | "outline" {
  if (status === "completed") {
    return "success";
  }
  if (status === "running" || status === ("in_progress" as string)) {
    return "default";
  }
  if (status === "failed") {
    return "destructive";
  }
  return "outline";
}

interface TimelineEntry {
  agentRole: string;
  id: string;
  message: string;
  timestamp: string;
  type: "task_start" | "task_complete" | "error" | "info";
}

function buildTimeline(
  agents: Array<{
    id: string;
    role: string;
    startedAt?: string;
    status: string;
    tokensIn?: number;
    tokensOut?: number;
  }>,
  tasks: Array<{
    agentRole?: string;
    completedAt?: string;
    id: string;
    startedAt?: string;
    status: string;
    title: string;
  }>
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const task of tasks) {
    if (task.startedAt) {
      entries.push({
        id: `${task.id}-start`,
        type: "task_start",
        agentRole: task.agentRole ?? "unknown",
        message: `Started: ${task.title}`,
        timestamp: task.startedAt,
      });
    }
    if (task.status === "completed" && task.completedAt) {
      entries.push({
        id: `${task.id}-complete`,
        type: "task_complete",
        agentRole: task.agentRole ?? "unknown",
        message: `Completed: ${task.title}`,
        timestamp: task.completedAt,
      });
    }
    if (task.status === "failed") {
      entries.push({
        id: `${task.id}-fail`,
        type: "error",
        agentRole: task.agentRole ?? "unknown",
        message: `Failed: ${task.title}`,
        timestamp:
          task.completedAt ?? task.startedAt ?? new Date().toISOString(),
      });
    }
  }

  for (const agent of agents) {
    if (agent.startedAt) {
      entries.push({
        id: `agent-${agent.id}-join`,
        type: "info",
        agentRole: agent.role,
        message: `Agent ${agent.role} joined the fleet`,
        timestamp: agent.startedAt,
      });
    }
  }

  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return entries.slice(0, 50);
}

const TIMELINE_COLORS: Record<string, string> = {
  task_start: "bg-blue-500",
  task_complete: "bg-green-500",
  error: "bg-red-500",
  info: "bg-zinc-500",
};

export default function FleetPage() {
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [activeTab, setActiveTab] = useState<"grid" | "timeline">("grid");

  const sessionsQuery = trpc.sessions.list.useQuery(
    { status: "active", limit: 20 },
    { retry: 2 }
  );

  const fleetQuery = trpc.fleet.status.useQuery(
    { sessionId: selectedSessionId },
    { enabled: !!selectedSessionId, refetchInterval: 5000, retry: 2 }
  );

  const stopMutation = trpc.fleet.stop.useMutation();
  const pauseMutation = trpc.fleet.pause.useMutation();
  const resumeMutation = trpc.fleet.resume.useMutation();

  const sessions = sessionsQuery.data?.sessions ?? [];
  const agents = fleetQuery.data?.agents ?? [];
  const fleetTasks = fleetQuery.data?.tasks ?? [];

  const totalTokens = agents.reduce(
    (sum, a) => sum + (a.tokensIn ?? 0) + (a.tokensOut ?? 0),
    0
  );
  const totalCredits = fleetTasks.reduce(
    (sum, t) => sum + (t.creditsConsumed ?? 0),
    0
  );
  const activeCount = agents.filter(
    (a) => a.status === "working" || a.status === "idle"
  ).length;
  const completedTasks = fleetTasks.filter(
    (t) => t.status === "completed"
  ).length;
  const failedTasks = fleetTasks.filter((t) => t.status === "failed").length;
  const progressPct =
    fleetTasks.length > 0
      ? Math.round((completedTasks / fleetTasks.length) * 100)
      : 0;

  const mappedAgents = agents.map((a) => ({
    ...a,
    status: a.status as string,
    startedAt: a.startedAt ? new Date(a.startedAt).toISOString() : undefined,
  }));
  const mappedTasks = fleetTasks.map((t) => ({
    ...t,
    status: t.status as string,
    agentRole: t.agentRole ?? undefined,
  }));
  const timeline = buildTimeline(mappedAgents, mappedTasks);

  // Estimate credit burn rate (credits per minute)
  const sessionStartTime = agents.reduce((earliest, a) => {
    if (!a.startedAt) {
      return earliest;
    }
    const t = new Date(a.startedAt).getTime();
    return t < earliest ? t : earliest;
  }, Date.now());
  const elapsedMinutes = Math.max(1, (Date.now() - sessionStartTime) / 60_000);
  const burnRate =
    totalCredits > 0 ? (totalCredits / elapsedMinutes).toFixed(1) : "0.0";

  async function handleStopAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    try {
      await stopMutation.mutateAsync({ sessionId: selectedSessionId, agentId });
      fleetQuery.refetch();
      toast.info("Agent stopped");
    } catch {
      toast.error("Failed to stop agent");
    }
  }

  async function handlePauseAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    try {
      await pauseMutation.mutateAsync({
        sessionId: selectedSessionId,
        agentId,
      });
      fleetQuery.refetch();
    } catch {
      toast.error("Failed to pause agent");
    }
  }

  async function handleResumeAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    try {
      await resumeMutation.mutateAsync({
        sessionId: selectedSessionId,
        agentId,
      });
      fleetQuery.refetch();
    } catch {
      toast.error("Failed to resume agent");
    }
  }

  async function handleStopAll() {
    if (!selectedSessionId) {
      return;
    }
    try {
      await stopMutation.mutateAsync({ sessionId: selectedSessionId });
      fleetQuery.refetch();
      toast.info("All agents stopped");
    } catch {
      toast.error("Failed to stop all agents");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Fleet Manager</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Monitor and manage your parallel AI agents in real time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            onValueChange={setSelectedSessionId}
            value={selectedSessionId}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select session..." />
            </SelectTrigger>
            <SelectContent>
              {sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.id.slice(0, 12)} - {s.mode ?? "task"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedSessionId && agents.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  <OctagonX className="mr-1 h-3.5 w-3.5" />
                  Stop All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop All Agents</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will stop all running agents in this session. Any
                    in-progress work will be lost.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleStopAll}>
                    Stop All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Fleet overview stats with burn rate */}
      <FleetDashboard
        activeCount={activeCount}
        burnRate={burnRate}
        completedTasks={completedTasks}
        failedTasks={failedTasks}
        progressPct={progressPct}
        totalAgents={agents.length}
        totalCredits={totalCredits}
        totalTasks={fleetTasks.length}
        totalTokens={totalTokens}
      />

      {/* Task execution order */}
      {fleetTasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Task Execution Order</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1 overflow-x-auto pb-2">
              {fleetTasks.map((task, i) => (
                <div className="flex shrink-0 items-center" key={task.id}>
                  <div className="rounded-lg border p-2" title={task.title}>
                    <div className="max-w-[120px] truncate font-medium text-xs">
                      <Badge variant={taskBadgeVariant(task.status)}>
                        {task.title}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {task.agentRole && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 font-medium text-[8px] ${
                            ROLE_COLORS[task.agentRole] ??
                            "bg-muted text-muted-foreground"
                          }`}
                        >
                          {task.agentRole}
                        </span>
                      )}
                    </div>
                  </div>
                  {i < fleetTasks.length - 1 && (
                    <ArrowRight className="mx-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab switcher */}
      {selectedSessionId && agents.length > 0 && (
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
          <button
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              activeTab === "grid"
                ? "bg-zinc-800 font-medium text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setActiveTab("grid")}
            type="button"
          >
            <Cpu className="mr-1.5 inline-block h-3.5 w-3.5" />
            Agent Grid
          </button>
          <button
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              activeTab === "timeline"
                ? "bg-zinc-800 font-medium text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setActiveTab("timeline")}
            type="button"
          >
            <Activity className="mr-1.5 inline-block h-3.5 w-3.5" />
            Activity Timeline
          </button>
        </div>
      )}

      {/* Agent grid */}
      {activeTab === "grid" && (
        <div>
          <h2 className="mb-4 font-semibold text-foreground text-lg">
            Agent Grid
          </h2>

          {selectedSessionId && agents.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <p className="text-muted-foreground text-sm">
                  No agents running in this session
                </p>
                <p className="mt-1 text-muted-foreground/60 text-xs">
                  Agents will appear here when tasks are dispatched
                </p>
              </CardContent>
            </Card>
          )}
          {selectedSessionId && agents.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => {
                const agentCredits = fleetTasks
                  .filter((t) => t.agentRole === agent.role)
                  .reduce((sum, t) => sum + (t.creditsConsumed ?? 0), 0);
                const currentTask = fleetTasks.find(
                  (t) =>
                    t.agentRole === agent.role &&
                    (t.status === "running" ||
                      t.status === ("in_progress" as string))
                );

                const mappedAgent = {
                  ...agent,
                  status: agent.status as string,
                  startedAt: agent.startedAt
                    ? new Date(agent.startedAt).toISOString()
                    : undefined,
                };
                return (
                  <AgentCard
                    agent={mappedAgent}
                    creditsConsumed={agentCredits}
                    currentTaskTitle={currentTask?.title}
                    key={agent.id}
                    onPause={handlePauseAgent}
                    onResume={handleResumeAgent}
                    onStop={handleStopAgent}
                  />
                );
              })}
            </div>
          )}
          {!selectedSessionId && (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <Cpu className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-muted-foreground text-sm">
                  Select a session above to view its agents
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Activity timeline */}
      {activeTab === "timeline" && selectedSessionId && (
        <div>
          <h2 className="mb-4 font-semibold text-foreground text-lg">
            Activity Timeline
          </h2>
          {timeline.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <Clock className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-muted-foreground text-sm">
                  No activity recorded yet
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-0">
              {timeline.map((entry, idx) => (
                <div className="flex gap-3" key={entry.id}>
                  {/* Timeline line */}
                  <div className="flex w-6 flex-col items-center">
                    <div
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        TIMELINE_COLORS[entry.type] ?? "bg-zinc-500"
                      }`}
                    />
                    {idx < timeline.length - 1 && (
                      <div className="w-px flex-1 bg-zinc-800" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="pb-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${
                          ROLE_COLORS[entry.agentRole] ??
                          "bg-zinc-500/20 text-zinc-400"
                        }`}
                      >
                        {entry.agentRole}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-300">
                      {entry.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task breakdown table */}
      {fleetTasks.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-foreground text-lg">
            Task Breakdown
          </h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fleetTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="max-w-[240px] truncate">{task.title}</div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          ROLE_COLORS[task.agentRole ?? ""] ??
                          "bg-muted text-muted-foreground"
                        }`}
                      >
                        {task.agentRole ?? "--"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={taskBadgeVariant(task.status)}>
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {task.creditsConsumed ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
