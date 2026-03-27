"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
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
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Search,
  Shield,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface AuditLogEntry {
  action: string;
  details: string;
  id: string;
  ipAddress: string;
  resourceId: string;
  resourceType: string;
  timestamp: string;
  user: string;
  userEmail: string;
}

const ACTIONS = [
  "user.login",
  "user.logout",
  "user.invite",
  "user.remove",
  "project.create",
  "project.delete",
  "project.update",
  "apikey.create",
  "apikey.revoke",
  "deployment.create",
  "deployment.rollback",
  "settings.update",
  "sso.configure",
  "secret.create",
  "secret.update",
  "billing.update",
  "role.assign",
  "webhook.create",
  "session.start",
  "session.end",
] as const;

const RESOURCE_TYPES = [
  "user",
  "project",
  "apikey",
  "deployment",
  "settings",
  "secret",
  "billing",
  "webhook",
  "session",
  "role",
] as const;

const USERS = [
  { name: "Sarah Chen", email: "sarah@acme.dev" },
  { name: "James Wilson", email: "james@acme.dev" },
  { name: "Maria Lopez", email: "maria@acme.dev" },
  { name: "Alex Kim", email: "alex@acme.dev" },
  { name: "Jordan Patel", email: "jordan@acme.dev" },
  { name: "System", email: "system@prometheus.dev" },
];

function generateMockLogs(): AuditLogEntry[] {
  const entries: AuditLogEntry[] = [];
  const baseDate = new Date("2026-03-26T16:00:00Z");
  const ips = [
    "192.168.1.42",
    "10.0.0.15",
    "172.16.4.88",
    "203.0.113.50",
    "198.51.100.73",
    "100.64.0.1",
  ];

  for (let i = 0; i < 75; i++) {
    const user = USERS[i % USERS.length] ?? { name: "", email: "" };
    const action = ACTIONS[i % ACTIONS.length] ?? "user.login";
    const resourceType = action.split(".")[0] ?? "user";
    const date = new Date(baseDate.getTime() - i * 23 * 60 * 1000);

    entries.push({
      id: `audit-${String(i + 1).padStart(3, "0")}`,
      timestamp: date.toISOString(),
      user: user.name,
      userEmail: user.email,
      action,
      resourceType,
      resourceId: `${resourceType}_${String(Math.floor(Math.random() * 9000 + 1000))}`,
      ipAddress: ips[i % ips.length] ?? "10.0.0.1",
      details: getActionDescription(action),
    });
  }
  return entries;
}

function getActionDescription(action: string): string {
  const descriptions: Record<string, string> = {
    "user.login": "User signed in via SSO",
    "user.logout": "User signed out",
    "user.invite": "Invited new team member",
    "user.remove": "Removed team member from workspace",
    "project.create": "Created new project",
    "project.delete": "Deleted project and all associated data",
    "project.update": "Updated project settings",
    "apikey.create": "Generated new API key",
    "apikey.revoke": "Revoked API key",
    "deployment.create": "Initiated deployment to production",
    "deployment.rollback": "Rolled back to previous version",
    "settings.update": "Updated workspace settings",
    "sso.configure": "Updated SSO configuration",
    "secret.create": "Added new environment secret",
    "secret.update": "Rotated environment secret",
    "billing.update": "Updated billing plan",
    "role.assign": "Assigned role to team member",
    "webhook.create": "Created webhook endpoint",
    "session.start": "Started coding session",
    "session.end": "Ended coding session",
  };
  return descriptions[action] ?? "Action performed";
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const ACTION_COLORS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  create: "default",
  login: "secondary",
  update: "outline",
  delete: "destructive",
  revoke: "destructive",
  remove: "destructive",
  rollback: "secondary",
};

function getActionVariant(
  action: string
): "default" | "secondary" | "destructive" | "outline" {
  const verb = action.split(".")[1] ?? "";
  return ACTION_COLORS[verb] ?? "outline";
}

const PAGE_SIZE = 25;

export default function AuditLogPage() {
  const [allLogs] = useState<AuditLogEntry[]>(() => generateMockLogs());
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filteredLogs = allLogs.filter((entry) => {
    if (
      search &&
      !entry.action.toLowerCase().includes(search.toLowerCase()) &&
      !entry.user.toLowerCase().includes(search.toLowerCase()) &&
      !entry.resourceId.toLowerCase().includes(search.toLowerCase()) &&
      !entry.details.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    if (actionFilter !== "all" && !entry.action.startsWith(actionFilter)) {
      return false;
    }
    if (userFilter !== "all" && entry.user !== userFilter) {
      return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const paginatedLogs = filteredLogs.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  function handleExport() {
    const headers = [
      "Timestamp",
      "User",
      "Email",
      "Action",
      "Resource Type",
      "Resource ID",
      "IP Address",
      "Details",
    ];
    const csv = [
      headers.join(","),
      ...filteredLogs.map((e) =>
        [
          e.timestamp,
          e.user,
          e.userEmail,
          e.action,
          e.resourceType,
          e.resourceId,
          e.ipAddress,
          `"${e.details}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-log.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Audit log exported as CSV");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Audit Log</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Track all actions and changes across your workspace.
          </p>
        </div>
        <Button onClick={handleExport} variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <FileText className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {allLogs.length}
              </p>
              <p className="text-muted-foreground text-sm">Total Events</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Shield className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {USERS.length - 1}
              </p>
              <p className="text-muted-foreground text-sm">Active Users</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Shield className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {
                  allLogs.filter(
                    (l) =>
                      l.action.includes("delete") || l.action.includes("revoke")
                  ).length
                }
              </p>
              <p className="text-muted-foreground text-sm">
                Destructive Actions
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Log</CardTitle>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search events, users, resources..."
                value={search}
              />
            </div>
            <Select
              onValueChange={(v) => {
                setUserFilter(v);
                setPage(1);
              }}
              value={userFilter}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {USERS.map((u) => (
                  <SelectItem key={u.name} value={u.name}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(v) => {
                setActionFilter(v);
                setPage(1);
              }}
              value={actionFilter}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {RESOURCE_TYPES.map((rt) => (
                  <SelectItem key={rt} value={rt}>
                    {rt.charAt(0).toUpperCase() + rt.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource Type</TableHead>
                <TableHead>Resource ID</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedLogs.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                    {formatTimestamp(entry.timestamp)}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{entry.user}</p>
                      <p className="text-muted-foreground text-xs">
                        {entry.userEmail}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getActionVariant(entry.action)}>
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm capitalize">
                    {entry.resourceType}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.resourceId}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    {entry.ipAddress}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground text-xs">
                    {entry.details}
                  </TableCell>
                </TableRow>
              ))}
              {paginatedLogs.length === 0 && (
                <TableRow>
                  <TableCell
                    className="py-8 text-center text-muted-foreground"
                    colSpan={7}
                  >
                    No audit log entries match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between pt-4">
            <p className="text-muted-foreground text-sm">
              Showing {(page - 1) * PAGE_SIZE + 1} to{" "}
              {Math.min(page * PAGE_SIZE, filteredLogs.length)} of{" "}
              {filteredLogs.length} entries
            </p>
            <div className="flex items-center gap-2">
              <Button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                size="sm"
                variant="outline"
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm">
                Page {page} of {totalPages}
              </span>
              <Button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                size="sm"
                variant="outline"
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
