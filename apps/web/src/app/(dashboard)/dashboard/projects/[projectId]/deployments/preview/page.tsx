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
  CheckCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  FlaskConical,
  Globe,
  Loader2,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeployStatus =
  | "queued"
  | "building"
  | "ready"
  | "failed"
  | "rolling_back"
  | "rolled_back";

interface PreviewDeployment {
  branch: string;
  createdAt: string;
  id: string;
  logs: string | null;
  provider: "vercel" | "netlify" | "docker";
  smokeTestPassed: boolean | null;
  status: DeployStatus;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_DEPLOYMENTS: PreviewDeployment[] = [
  {
    id: "deploy-001",
    branch: "feat/user-dashboard",
    provider: "vercel",
    status: "ready",
    url: "https://my-app-feat-user-dashboard.vercel.app",
    createdAt: "2026-03-27T10:30:00Z",
    smokeTestPassed: true,
    logs: "Building...\nInstalling dependencies...\nBuild completed in 45s\nDeployed to https://my-app-feat-user-dashboard.vercel.app",
  },
  {
    id: "deploy-002",
    branch: "fix/auth-redirect",
    provider: "vercel",
    status: "building",
    url: null,
    createdAt: "2026-03-27T11:15:00Z",
    smokeTestPassed: null,
    logs: "Building...\nInstalling dependencies...",
  },
  {
    id: "deploy-003",
    branch: "feat/api-v2",
    provider: "netlify",
    status: "failed",
    url: null,
    createdAt: "2026-03-27T09:00:00Z",
    smokeTestPassed: false,
    logs: "Building...\nInstalling dependencies...\nError: Build failed - missing environment variable API_URL",
  },
  {
    id: "deploy-004",
    branch: "refactor/db-schema",
    provider: "docker",
    status: "ready",
    url: "https://preview-deploy-004.prometheus.dev",
    createdAt: "2026-03-26T16:45:00Z",
    smokeTestPassed: true,
    logs: "Building Docker image...\nPushing to registry...\nDeployed container successfully",
  },
  {
    id: "deploy-005",
    branch: "feat/notifications",
    provider: "vercel",
    status: "rolled_back",
    url: null,
    createdAt: "2026-03-26T14:00:00Z",
    smokeTestPassed: false,
    logs: "Deployed but smoke test failed. Rolling back...\nRollback complete.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: DeployStatus) {
  switch (status) {
    case "ready":
      return <Badge variant="default">Ready</Badge>;
    case "building":
    case "queued":
      return (
        <Badge variant="secondary">
          {status === "queued" ? "Queued" : "Building"}
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "rolling_back":
      return <Badge variant="secondary">Rolling Back</Badge>;
    case "rolled_back":
      return <Badge variant="outline">Rolled Back</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function statusIcon(status: DeployStatus) {
  switch (status) {
    case "ready":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "building":
    case "queued":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "rolling_back":
      return <RotateCcw className="h-4 w-4 animate-spin text-yellow-500" />;
    case "rolled_back":
      return <RotateCcw className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SmokeTestBadge({ passed }: { passed: boolean | null }) {
  if (passed === true) {
    return <Badge variant="default">Passed</Badge>;
  }
  if (passed === false) {
    return <Badge variant="destructive">Failed</Badge>;
  }
  return <span className="text-muted-foreground text-sm">--</span>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PreviewDeploymentsPage() {
  const [deploying, setDeploying] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("vercel");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [runningTests, setRunningTests] = useState<Set<string>>(new Set());

  const handleTriggerDeploy = () => {
    setDeploying(true);
    setTimeout(() => {
      setDeploying(false);
      setShowNewDialog(false);
      toast.success("Preview deployment triggered");
    }, 1500);
  };

  const handleSmokeTest = (deployId: string) => {
    setRunningTests((prev) => new Set([...prev, deployId]));
    setTimeout(() => {
      setRunningTests((prev) => {
        const next = new Set(prev);
        next.delete(deployId);
        return next;
      });
      toast.success("Smoke test passed");
    }, 2000);
  };

  const handleRollback = (deployId: string) => {
    toast.success(`Rollback triggered for ${deployId}`);
  };

  const toggleLogs = (deployId: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(deployId)) {
        next.delete(deployId);
      } else {
        next.add(deployId);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">
            Preview Deployments
          </h1>
          <p className="text-muted-foreground">
            Deploy and test branch previews before merging
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)}>
          <Play className="mr-2 h-4 w-4" />
          New Deployment
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total</CardDescription>
            <CardTitle className="text-2xl">
              {MOCK_DEPLOYMENTS.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active</CardDescription>
            <CardTitle className="text-2xl text-green-600">
              {MOCK_DEPLOYMENTS.filter((d) => d.status === "ready").length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Building</CardDescription>
            <CardTitle className="text-2xl text-blue-600">
              {
                MOCK_DEPLOYMENTS.filter(
                  (d) => d.status === "building" || d.status === "queued"
                ).length
              }
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed</CardDescription>
            <CardTitle className="text-2xl text-red-600">
              {MOCK_DEPLOYMENTS.filter((d) => d.status === "failed").length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Deployments table */}
      <Card>
        <CardHeader>
          <CardTitle>Deployments</CardTitle>
          <CardDescription>
            Preview deployments for this project
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Smoke Test</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_DEPLOYMENTS.map((deploy) => (
                <React.Fragment key={deploy.id}>
                  <TableRow>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {statusIcon(deploy.status)}
                        {statusBadge(deploy.status)}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {deploy.branch}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{deploy.provider}</Badge>
                    </TableCell>
                    <TableCell>
                      {deploy.url ? (
                        <a
                          className="flex items-center gap-1 text-blue-600 text-sm hover:underline"
                          href={deploy.url}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <Globe className="h-3 w-3" />
                          {deploy.url.replace("https://", "").slice(0, 40)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          --
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <SmokeTestBadge passed={deploy.smokeTestPassed} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatTimestamp(deploy.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {deploy.status === "ready" && deploy.url && (
                          <Button
                            disabled={runningTests.has(deploy.id)}
                            onClick={() => handleSmokeTest(deploy.id)}
                            size="sm"
                            variant="outline"
                          >
                            {runningTests.has(deploy.id) ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <FlaskConical className="mr-1 h-3 w-3" />
                            )}
                            Test
                          </Button>
                        )}
                        {deploy.status === "ready" && (
                          <Button
                            onClick={() => handleRollback(deploy.id)}
                            size="sm"
                            variant="outline"
                          >
                            <RotateCcw className="mr-1 h-3 w-3" />
                            Rollback
                          </Button>
                        )}
                        {deploy.logs && (
                          <Button
                            onClick={() => toggleLogs(deploy.id)}
                            size="sm"
                            variant="ghost"
                          >
                            <ChevronDown
                              className={`h-3 w-3 transition-transform ${expandedLogs.has(deploy.id) ? "rotate-180" : ""}`}
                            />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {deploy.logs && expandedLogs.has(deploy.id) && (
                    <TableRow>
                      <TableCell className="bg-muted/50 p-0" colSpan={7}>
                        <pre className="max-h-48 overflow-auto p-4 font-mono text-muted-foreground text-xs">
                          {deploy.logs}
                        </pre>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* New deployment dialog */}
      <Dialog onOpenChange={setShowNewDialog} open={showNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trigger Preview Deployment</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm" htmlFor="branch-input">
                Branch
              </label>
              <input
                className="rounded-md border bg-background px-3 py-2 text-sm"
                id="branch-input"
                placeholder="feat/my-feature"
                type="text"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm" htmlFor="provider-select">
                Provider
              </label>
              <Select
                onValueChange={setSelectedProvider}
                value={selectedProvider}
              >
                <SelectTrigger id="provider-select">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vercel">Vercel</SelectItem>
                  <SelectItem value="netlify">Netlify</SelectItem>
                  <SelectItem value="docker">Docker</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="mt-2"
              disabled={deploying}
              onClick={handleTriggerDeploy}
            >
              {deploying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Deploy
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
