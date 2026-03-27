"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@prometheus/ui";
import {
  Calendar,
  Clock,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ScheduledTask {
  createdBy: string;
  cron: string;
  cronHuman: string;
  description: string;
  enabled: boolean;
  id: string;
  lastRun: string | null;
  lastRunStatus: "success" | "failed" | "running" | null;
  name: string;
  nextRun: string;
  runsCompleted: number;
  timezone: string;
}

const MOCK_TASKS: ScheduledTask[] = [
  {
    id: "sched-001",
    name: "Dependency Update Check",
    description: "Scan all projects for outdated dependencies and create PRs",
    cron: "0 9 * * 1",
    cronHuman: "Every Monday at 9:00 AM",
    timezone: "America/New_York",
    nextRun: "2026-03-30T09:00:00-04:00",
    lastRun: "2026-03-23T09:00:00-04:00",
    lastRunStatus: "success",
    enabled: true,
    createdBy: "Sarah Chen",
    runsCompleted: 14,
  },
  {
    id: "sched-002",
    name: "Security Vulnerability Scan",
    description: "Run security scans across all repositories",
    cron: "0 2 * * *",
    cronHuman: "Every day at 2:00 AM",
    timezone: "UTC",
    nextRun: "2026-03-27T02:00:00Z",
    lastRun: "2026-03-26T02:00:00Z",
    lastRunStatus: "success",
    enabled: true,
    createdBy: "Alex Kim",
    runsCompleted: 42,
  },
  {
    id: "sched-003",
    name: "Database Backup Verification",
    description: "Verify database backups are valid and restorable",
    cron: "0 4 * * 0",
    cronHuman: "Every Sunday at 4:00 AM",
    timezone: "UTC",
    nextRun: "2026-03-29T04:00:00Z",
    lastRun: "2026-03-22T04:00:00Z",
    lastRunStatus: "success",
    enabled: true,
    createdBy: "Alex Kim",
    runsCompleted: 8,
  },
  {
    id: "sched-004",
    name: "Performance Regression Test",
    description: "Run benchmark suite and alert on regressions",
    cron: "0 6 * * 1-5",
    cronHuman: "Weekdays at 6:00 AM",
    timezone: "America/Los_Angeles",
    nextRun: "2026-03-27T06:00:00-07:00",
    lastRun: "2026-03-26T06:00:00-07:00",
    lastRunStatus: "failed",
    enabled: true,
    createdBy: "James Wilson",
    runsCompleted: 31,
  },
  {
    id: "sched-005",
    name: "Stale Branch Cleanup",
    description: "Delete merged branches older than 30 days",
    cron: "0 0 1 * *",
    cronHuman: "First day of every month at midnight",
    timezone: "UTC",
    nextRun: "2026-04-01T00:00:00Z",
    lastRun: "2026-03-01T00:00:00Z",
    lastRunStatus: "success",
    enabled: true,
    createdBy: "Sarah Chen",
    runsCompleted: 6,
  },
  {
    id: "sched-006",
    name: "Documentation Sync",
    description: "Sync API documentation from code comments",
    cron: "0 12 * * 3",
    cronHuman: "Every Wednesday at 12:00 PM",
    timezone: "Europe/London",
    nextRun: "2026-04-01T12:00:00+01:00",
    lastRun: "2026-03-25T12:00:00+00:00",
    lastRunStatus: "success",
    enabled: false,
    createdBy: "Maria Lopez",
    runsCompleted: 18,
  },
  {
    id: "sched-007",
    name: "Cost Report Generation",
    description: "Generate weekly cost report and send to team leads",
    cron: "0 8 * * 5",
    cronHuman: "Every Friday at 8:00 AM",
    timezone: "America/New_York",
    nextRun: "2026-03-27T08:00:00-04:00",
    lastRun: "2026-03-20T08:00:00-04:00",
    lastRunStatus: "success",
    enabled: true,
    createdBy: "Jordan Patel",
    runsCompleted: 11,
  },
  {
    id: "sched-008",
    name: "Integration Test Suite",
    description: "Run full integration test suite against staging",
    cron: "30 3 * * *",
    cronHuman: "Every day at 3:30 AM",
    timezone: "UTC",
    nextRun: "2026-03-27T03:30:00Z",
    lastRun: "2026-03-26T03:30:00Z",
    lastRunStatus: "running",
    enabled: true,
    createdBy: "James Wilson",
    runsCompleted: 89,
  },
];

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
];

function formatNextRun(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusBadge(status: ScheduledTask["lastRunStatus"]): {
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
} {
  if (status === "success") {
    return { label: "Success", variant: "default" };
  }
  if (status === "failed") {
    return { label: "Failed", variant: "destructive" };
  }
  if (status === "running") {
    return { label: "Running", variant: "secondary" };
  }
  return { label: "Never Run", variant: "outline" };
}

export default function ScheduledTasksPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>(MOCK_TASKS);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCron, setNewCron] = useState("");
  const [newTimezone, setNewTimezone] = useState("UTC");
  const [isCreating, setIsCreating] = useState(false);

  const enabledCount = tasks.filter((t) => t.enabled).length;
  const failedCount = tasks.filter((t) => t.lastRunStatus === "failed").length;

  function handleToggle(taskId: string) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) {
          return t;
        }
        const next = !t.enabled;
        toast.success(`${t.name} ${next ? "enabled" : "paused"}`);
        return { ...t, enabled: next };
      })
    );
  }

  function handleDelete(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    toast.success(`Deleted "${task?.name ?? "task"}"`);
  }

  function handleCreate() {
    if (!(newName.trim() && newCron.trim())) {
      return;
    }
    setIsCreating(true);

    setTimeout(() => {
      const task: ScheduledTask = {
        id: `sched-${String(Date.now())}`,
        name: newName.trim(),
        description: newDescription.trim(),
        cron: newCron.trim(),
        cronHuman: newCron.trim(),
        timezone: newTimezone,
        nextRun: new Date(Date.now() + 86_400_000).toISOString(),
        lastRun: null,
        lastRunStatus: null,
        enabled: true,
        createdBy: "You",
        runsCompleted: 0,
      };

      setTasks((prev) => [task, ...prev]);
      setCreateDialogOpen(false);
      setNewName("");
      setNewDescription("");
      setNewCron("");
      setNewTimezone("UTC");
      setIsCreating(false);
      toast.success(`Schedule "${task.name}" created`);
    }, 600);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">
            Scheduled Tasks
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Manage recurring automated tasks and cron jobs.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Schedule
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Calendar className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {tasks.length}
              </p>
              <p className="text-muted-foreground text-sm">Total Schedules</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Play className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {enabledCount}
              </p>
              <p className="text-muted-foreground text-sm">Active</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
              <Clock className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {failedCount}
              </p>
              <p className="text-muted-foreground text-sm">Last Run Failed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Schedules</CardTitle>
          <CardDescription>
            {enabledCount} of {tasks.length} schedules are active
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const statusBadge = getStatusBadge(task.lastRunStatus);
                return (
                  <TableRow
                    className={task.enabled ? "" : "opacity-60"}
                    key={task.id}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{task.name}</p>
                        <p className="max-w-[200px] truncate text-muted-foreground text-xs">
                          {task.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{task.cronHuman}</p>
                        <p className="font-mono text-muted-foreground text-xs">
                          {task.cron}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {task.timezone}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatNextRun(task.nextRun)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadge.variant}>
                        {task.lastRunStatus === "running" && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
                        {statusBadge.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {task.runsCompleted}
                    </TableCell>
                    <TableCell>
                      <Switch
                        aria-label={`Toggle ${task.name}`}
                        checked={task.enabled}
                        onCheckedChange={() => handleToggle(task.id)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleToggle(task.id)}
                          >
                            {task.enabled ? (
                              <>
                                <Pause className="mr-2 h-4 w-4" />
                                Pause
                              </>
                            ) : (
                              <>
                                <Play className="mr-2 h-4 w-4" />
                                Resume
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDelete(task.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setCreateDialogOpen} open={createDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Scheduled Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="sched-name">Task Name</Label>
              <Input
                className="mt-1.5"
                id="sched-name"
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Nightly Build"
                value={newName}
              />
            </div>
            <div>
              <Label htmlFor="sched-desc">Description</Label>
              <Input
                className="mt-1.5"
                id="sched-desc"
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What does this task do?"
                value={newDescription}
              />
            </div>
            <div>
              <Label htmlFor="sched-cron">Cron Expression</Label>
              <Input
                className="mt-1.5 font-mono"
                id="sched-cron"
                onChange={(e) => setNewCron(e.target.value)}
                placeholder="0 2 * * *"
                value={newCron}
              />
              <p className="mt-1 text-muted-foreground text-xs">
                Format: minute hour day month weekday (e.g., &quot;0 9 * *
                1&quot; = every Monday 9 AM)
              </p>
            </div>
            <div>
              <Label htmlFor="sched-tz">Timezone</Label>
              <Select onValueChange={setNewTimezone} value={newTimezone}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setCreateDialogOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={isCreating || !newName.trim() || !newCron.trim()}
                onClick={handleCreate}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Schedule"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
