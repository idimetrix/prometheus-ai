"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@prometheus/ui";
import {
  Activity,
  CheckCircle,
  Code,
  Coins,
  GitPullRequest,
  Rocket,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

interface TeamMember {
  avatar: string;
  creditsUsed: number;
  email: string;
  id: string;
  lastActive: string;
  name: string;
  prsCreated: number;
  role: string;
  sessions: number;
  tasksCompleted: number;
  tasksInProgress: number;
}

interface ActivityItem {
  action: string;
  id: string;
  target: string;
  timestamp: string;
  type: "task" | "pr" | "deploy" | "session" | "review";
  user: string;
}

const TEAM_MEMBERS: TeamMember[] = [
  {
    id: "u-001",
    name: "Sarah Chen",
    email: "sarah@acme.dev",
    role: "Engineering Lead",
    avatar: "SC",
    tasksCompleted: 147,
    tasksInProgress: 3,
    sessions: 89,
    prsCreated: 62,
    creditsUsed: 12_450,
    lastActive: "2 minutes ago",
  },
  {
    id: "u-002",
    name: "James Wilson",
    email: "james@acme.dev",
    role: "Senior Developer",
    avatar: "JW",
    tasksCompleted: 112,
    tasksInProgress: 5,
    sessions: 67,
    prsCreated: 48,
    creditsUsed: 9870,
    lastActive: "15 minutes ago",
  },
  {
    id: "u-003",
    name: "Maria Lopez",
    email: "maria@acme.dev",
    role: "Full Stack Developer",
    avatar: "ML",
    tasksCompleted: 98,
    tasksInProgress: 2,
    sessions: 54,
    prsCreated: 41,
    creditsUsed: 8320,
    lastActive: "1 hour ago",
  },
  {
    id: "u-004",
    name: "Alex Kim",
    email: "alex@acme.dev",
    role: "DevOps Engineer",
    avatar: "AK",
    tasksCompleted: 83,
    tasksInProgress: 1,
    sessions: 42,
    prsCreated: 35,
    creditsUsed: 6750,
    lastActive: "3 hours ago",
  },
  {
    id: "u-005",
    name: "Jordan Patel",
    email: "jordan@acme.dev",
    role: "Junior Developer",
    avatar: "JP",
    tasksCompleted: 56,
    tasksInProgress: 4,
    sessions: 38,
    prsCreated: 22,
    creditsUsed: 4210,
    lastActive: "30 minutes ago",
  },
  {
    id: "u-006",
    name: "Taylor Rivera",
    email: "taylor@acme.dev",
    role: "Frontend Developer",
    avatar: "TR",
    tasksCompleted: 71,
    tasksInProgress: 2,
    sessions: 45,
    prsCreated: 33,
    creditsUsed: 5680,
    lastActive: "5 hours ago",
  },
];

const RECENT_ACTIVITY: ActivityItem[] = [
  {
    id: "act-001",
    user: "Sarah Chen",
    action: "completed task",
    target: "Implement auth flow refactor",
    timestamp: "2 minutes ago",
    type: "task",
  },
  {
    id: "act-002",
    user: "James Wilson",
    action: "created PR",
    target: "#284 - Add rate limiting middleware",
    timestamp: "15 minutes ago",
    type: "pr",
  },
  {
    id: "act-003",
    user: "Alex Kim",
    action: "deployed to",
    target: "production v2.14.0",
    timestamp: "32 minutes ago",
    type: "deploy",
  },
  {
    id: "act-004",
    user: "Maria Lopez",
    action: "started session",
    target: "Bug fix: memory leak in WebSocket handler",
    timestamp: "1 hour ago",
    type: "session",
  },
  {
    id: "act-005",
    user: "Jordan Patel",
    action: "completed task",
    target: "Update onboarding UI components",
    timestamp: "1 hour ago",
    type: "task",
  },
  {
    id: "act-006",
    user: "Taylor Rivera",
    action: "approved PR",
    target: "#281 - Redesign dashboard layout",
    timestamp: "2 hours ago",
    type: "review",
  },
  {
    id: "act-007",
    user: "Sarah Chen",
    action: "created PR",
    target: "#285 - Optimize database queries",
    timestamp: "3 hours ago",
    type: "pr",
  },
  {
    id: "act-008",
    user: "James Wilson",
    action: "deployed to",
    target: "staging v2.14.0-rc.3",
    timestamp: "3 hours ago",
    type: "deploy",
  },
  {
    id: "act-009",
    user: "Maria Lopez",
    action: "completed task",
    target: "Fix CORS configuration for API",
    timestamp: "4 hours ago",
    type: "task",
  },
  {
    id: "act-010",
    user: "Alex Kim",
    action: "started session",
    target: "Infrastructure monitoring setup",
    timestamp: "5 hours ago",
    type: "session",
  },
];

const ACTIVITY_ICONS: Record<string, typeof Activity> = {
  task: CheckCircle,
  pr: GitPullRequest,
  deploy: Rocket,
  session: Code,
  review: Activity,
};

const ACTIVITY_COLORS: Record<string, string> = {
  task: "text-green-500",
  pr: "text-blue-500",
  deploy: "text-purple-500",
  session: "text-amber-500",
  review: "text-cyan-500",
};

export default function TeamDashboardPage() {
  const [members] = useState<TeamMember[]>(TEAM_MEMBERS);
  const [activity] = useState<ActivityItem[]>(RECENT_ACTIVITY);

  const totalCompleted = members.reduce((acc, m) => acc + m.tasksCompleted, 0);
  const totalInProgress = members.reduce(
    (acc, m) => acc + m.tasksInProgress,
    0
  );
  const totalCredits = members.reduce((acc, m) => acc + m.creditsUsed, 0);
  const totalPRs = members.reduce((acc, m) => acc + m.prsCreated, 0);
  const totalSessions = members.reduce((acc, m) => acc + m.sessions, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">Team Dashboard</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Aggregate metrics and activity across your organization.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-xl">
                {totalCompleted}
              </p>
              <p className="text-muted-foreground text-xs">Tasks Completed</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Zap className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-xl">
                {totalInProgress}
              </p>
              <p className="text-muted-foreground text-xs">In Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <GitPullRequest className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-xl">
                {totalPRs}
              </p>
              <p className="text-muted-foreground text-xs">PRs Created</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <Coins className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-xl">
                {totalCredits.toLocaleString()}
              </p>
              <p className="text-muted-foreground text-xs">Credits Used</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
              <Users className="h-5 w-5 text-cyan-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-xl">
                {totalSessions}
              </p>
              <p className="text-muted-foreground text-xs">Total Sessions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Team Members</CardTitle>
              <CardDescription>
                {members.length} members in your workspace
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {members.map((member) => (
                  <div
                    className="flex items-start gap-4 rounded-lg border p-4"
                    key={member.id}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-sm">
                      {member.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-foreground text-sm">
                          {member.name}
                        </p>
                        <Badge className="shrink-0 text-xs" variant="outline">
                          {member.role}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {member.email}
                      </p>
                      <Separator className="my-2" />
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="font-medium text-foreground text-sm">
                            {member.tasksCompleted}
                          </p>
                          <p className="text-muted-foreground text-xs">Tasks</p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground text-sm">
                            {member.sessions}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            Sessions
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground text-sm">
                            {member.prsCreated}
                          </p>
                          <p className="text-muted-foreground text-xs">PRs</p>
                        </div>
                      </div>
                      <p className="mt-2 text-muted-foreground text-xs">
                        Active {member.lastActive}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Latest actions across the team</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activity.map((item) => {
                  const Icon = ACTIVITY_ICONS[item.type] ?? Activity;
                  const color =
                    ACTIVITY_COLORS[item.type] ?? "text-muted-foreground";
                  return (
                    <div className="flex gap-3" key={item.id}>
                      <div
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted ${color}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="font-medium text-foreground">
                            {item.user}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {item.action}
                          </span>{" "}
                          <span className="font-medium text-foreground">
                            {item.target}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {item.timestamp}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failure Summary</CardTitle>
          <CardDescription>
            Tasks that failed or require attention this week
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <p className="font-medium text-foreground text-sm">12</p>
                <p className="text-muted-foreground text-xs">
                  Failed Tasks (This Week)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
              <Activity className="h-5 w-5 text-amber-500" />
              <div>
                <p className="font-medium text-foreground text-sm">4</p>
                <p className="text-muted-foreground text-xs">
                  Deployments Rolled Back
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-green-500/20 bg-green-500/5 p-4">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground text-sm">94.8%</p>
                <p className="text-muted-foreground text-xs">
                  Overall Success Rate
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
