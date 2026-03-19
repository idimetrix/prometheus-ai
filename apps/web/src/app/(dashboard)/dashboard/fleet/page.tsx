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
  Progress,
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
import { ArrowRight, Cpu, OctagonX, Pause, Play, Square } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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

const STATUS_INDICATORS: Record<string, { color: string; label: string }> = {
  idle: { color: "bg-zinc-500", label: "Idle" },
  working: { color: "bg-green-500 animate-pulse", label: "Working" },
  waiting: { color: "bg-yellow-500", label: "Waiting" },
  paused: { color: "bg-yellow-500", label: "Paused" },
  terminated: { color: "bg-red-500", label: "Terminated" },
  error: { color: "bg-red-500", label: "Error" },
};

export default function FleetPage() {
  const [selectedSessionId, setSelectedSessionId] = useState("");

  const sessionsQuery = trpc.sessions.list.useQuery(
    { status: "active", limit: 20 },
    { retry: false }
  );

  const fleetQuery = trpc.fleet.status.useQuery(
    { sessionId: selectedSessionId },
    { enabled: !!selectedSessionId, refetchInterval: 5000, retry: false }
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
  const progressPct =
    fleetTasks.length > 0
      ? Math.round((completedTasks / fleetTasks.length) * 100)
      : 0;

  async function handleStopAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    await stopMutation.mutateAsync({ sessionId: selectedSessionId, agentId });
    fleetQuery.refetch();
    toast.info("Agent stopped");
  }

  async function handlePauseAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    await pauseMutation.mutateAsync({ sessionId: selectedSessionId, agentId });
    fleetQuery.refetch();
  }

  async function handleResumeAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    await resumeMutation.mutateAsync({ sessionId: selectedSessionId, agentId });
    fleetQuery.refetch();
  }

  async function handleStopAll() {
    if (!selectedSessionId) {
      return;
    }
    await stopMutation.mutateAsync({ sessionId: selectedSessionId });
    fleetQuery.refetch();
    toast.info("All agents stopped");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Fleet Manager</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Monitor and manage your parallel AI agents.
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

      {/* Fleet stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="font-medium text-muted-foreground text-xs">
              Total Progress
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Progress className="h-2 flex-1" value={progressPct} />
              <span className="font-bold text-foreground text-lg">
                {progressPct}%
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="font-medium text-muted-foreground text-xs">
              Agents Running
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {activeCount}
              <span className="font-normal text-muted-foreground text-sm">
                /{agents.length}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="font-medium text-muted-foreground text-xs">
              Credits Consumed
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {totalCredits.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="font-medium text-muted-foreground text-xs">
              Total Tokens
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {totalTokens.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="font-medium text-muted-foreground text-xs">
              Tasks Complete
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {completedTasks}
              <span className="font-normal text-muted-foreground text-sm">
                /{fleetTasks.length}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

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

      {/* Agent grid */}
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
              const statusInfo =
                STATUS_INDICATORS[agent.status] ?? STATUS_INDICATORS.idle;
              const roleColor =
                ROLE_COLORS[agent.role] ?? "bg-muted text-muted-foreground";
              const agentCredits = fleetTasks
                .filter((t) => t.agentRole === agent.role)
                .reduce((sum, t) => sum + (t.creditsConsumed ?? 0), 0);

              return (
                <Card
                  className="transition-colors hover:border-muted-foreground/30"
                  key={agent.id}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-medium text-xs ${roleColor}`}
                      >
                        {agent.role}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${statusInfo?.color ?? "bg-muted-foreground"}`}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {statusInfo?.label ?? "unknown"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {agent.id.slice(0, 16)}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          Tokens In
                        </div>
                        <div className="font-mono text-foreground text-xs">
                          {(agent.tokensIn ?? 0).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          Tokens Out
                        </div>
                        <div className="font-mono text-foreground text-xs">
                          {(agent.tokensOut ?? 0).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          Credits
                        </div>
                        <div className="font-mono text-foreground text-xs">
                          {agentCredits}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">
                          Started
                        </div>
                        <div className="text-foreground text-xs">
                          {agent.startedAt
                            ? new Date(agent.startedAt).toLocaleTimeString()
                            : "--"}
                        </div>
                      </div>
                    </div>

                    {fleetTasks
                      .filter(
                        (t) =>
                          t.agentRole === agent.role &&
                          (t.status === "running" ||
                            t.status === ("in_progress" as string))
                      )
                      .slice(0, 1)
                      .map((task) => (
                        <div
                          className="mt-3 rounded-lg bg-muted px-3 py-2"
                          key={task.id}
                        >
                          <div className="text-[10px] text-muted-foreground">
                            Current Task
                          </div>
                          <div className="mt-0.5 truncate text-foreground text-xs">
                            {task.title}
                          </div>
                        </div>
                      ))}

                    {agent.status !== "terminated" &&
                      agent.status !== "error" && (
                        <div className="mt-3 flex gap-1.5">
                          {agent.status === "working" && (
                            <Button
                              className="flex-1"
                              onClick={() => handlePauseAgent(agent.id)}
                              size="sm"
                              variant="outline"
                            >
                              <Pause className="mr-1 h-3 w-3" />
                              Pause
                            </Button>
                          )}
                          {(agent.status === "idle" ||
                            agent.status === ("waiting" as string) ||
                            agent.status === ("paused" as string)) && (
                            <Button
                              className="flex-1"
                              onClick={() => handleResumeAgent(agent.id)}
                              size="sm"
                              variant="outline"
                            >
                              <Play className="mr-1 h-3 w-3" />
                              Resume
                            </Button>
                          )}
                          <Button
                            className="flex-1"
                            onClick={() => handleStopAgent(agent.id)}
                            size="sm"
                            variant="outline"
                          >
                            <Square className="mr-1 h-3 w-3" />
                            Stop
                          </Button>
                        </div>
                      )}
                  </CardContent>
                </Card>
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
