"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@prometheus/ui";
import {
  ArrowUpRight,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  Plus,
  Rocket,
  RotateCcw,
} from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";

type DeploymentStatus = "success" | "failed" | "pending" | "deploying";
type Environment = "dev" | "staging" | "prod";

interface Deployment {
  branch: string;
  commitSha: string;
  deployedBy: string;
  duration: string;
  environment: Environment;
  id: string;
  status: DeploymentStatus;
  timestamp: string;
  url: string;
  version: string;
}

const MOCK_DEPLOYMENTS: Deployment[] = [
  {
    id: "dep-001",
    version: "v2.14.0",
    branch: "main",
    environment: "prod",
    status: "success",
    deployedBy: "Sarah Chen",
    timestamp: "2026-03-26T14:30:00Z",
    url: "https://app.prometheus.dev",
    commitSha: "a1b2c3d",
    duration: "2m 34s",
  },
  {
    id: "dep-002",
    version: "v2.14.0-rc.3",
    branch: "main",
    environment: "staging",
    status: "success",
    deployedBy: "Sarah Chen",
    timestamp: "2026-03-26T13:45:00Z",
    url: "https://staging.prometheus.dev",
    commitSha: "a1b2c3d",
    duration: "2m 12s",
  },
  {
    id: "dep-003",
    version: "v2.14.0-rc.2",
    branch: "feat/auth-flow",
    environment: "dev",
    status: "deploying",
    deployedBy: "James Wilson",
    timestamp: "2026-03-26T13:20:00Z",
    url: "https://dev-feat-auth.prometheus.dev",
    commitSha: "e4f5g6h",
    duration: "1m 48s",
  },
  {
    id: "dep-004",
    version: "v2.13.2",
    branch: "fix/memory-leak",
    environment: "staging",
    status: "failed",
    deployedBy: "Maria Lopez",
    timestamp: "2026-03-26T11:15:00Z",
    url: "https://staging.prometheus.dev",
    commitSha: "i7j8k9l",
    duration: "0m 42s",
  },
  {
    id: "dep-005",
    version: "v2.13.1",
    branch: "main",
    environment: "prod",
    status: "success",
    deployedBy: "Alex Kim",
    timestamp: "2026-03-25T16:00:00Z",
    url: "https://app.prometheus.dev",
    commitSha: "m0n1o2p",
    duration: "2m 58s",
  },
  {
    id: "dep-006",
    version: "v2.14.0-rc.1",
    branch: "feat/dashboard-v2",
    environment: "dev",
    status: "pending",
    deployedBy: "James Wilson",
    timestamp: "2026-03-25T14:30:00Z",
    url: "https://dev-dashboard.prometheus.dev",
    commitSha: "q3r4s5t",
    duration: "--",
  },
  {
    id: "dep-007",
    version: "v2.13.0",
    branch: "main",
    environment: "prod",
    status: "success",
    deployedBy: "Sarah Chen",
    timestamp: "2026-03-24T10:00:00Z",
    url: "https://app.prometheus.dev",
    commitSha: "u6v7w8x",
    duration: "3m 05s",
  },
  {
    id: "dep-008",
    version: "v2.12.5",
    branch: "hotfix/csrf-token",
    environment: "prod",
    status: "success",
    deployedBy: "Alex Kim",
    timestamp: "2026-03-23T22:15:00Z",
    url: "https://app.prometheus.dev",
    commitSha: "y9z0a1b",
    duration: "2m 21s",
  },
  {
    id: "dep-009",
    version: "v2.13.0-rc.5",
    branch: "feat/analytics",
    environment: "staging",
    status: "failed",
    deployedBy: "Maria Lopez",
    timestamp: "2026-03-23T15:45:00Z",
    url: "https://staging.prometheus.dev",
    commitSha: "c2d3e4f",
    duration: "1m 10s",
  },
  {
    id: "dep-010",
    version: "v2.12.4",
    branch: "main",
    environment: "prod",
    status: "success",
    deployedBy: "Sarah Chen",
    timestamp: "2026-03-22T09:30:00Z",
    url: "https://app.prometheus.dev",
    commitSha: "g5h6i7j",
    duration: "2m 47s",
  },
];

const STATUS_CONFIG: Record<
  DeploymentStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  success: { label: "Success", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  pending: { label: "Pending", variant: "outline" },
  deploying: { label: "Deploying", variant: "secondary" },
};

const ENV_CONFIG: Record<
  Environment,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  prod: { label: "Production", variant: "default" },
  staging: { label: "Staging", variant: "secondary" },
  dev: { label: "Development", variant: "outline" },
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DeploymentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [deployments, setDeployments] =
    useState<Deployment[]>(MOCK_DEPLOYMENTS);
  const [envFilter, setEnvFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [deployBranch, setDeployBranch] = useState("main");
  const [deployEnv, setDeployEnv] = useState<Environment>("dev");
  const [isDeploying, setIsDeploying] = useState(false);

  const filteredDeployments = deployments.filter((d) => {
    if (envFilter !== "all" && d.environment !== envFilter) {
      return false;
    }
    if (statusFilter !== "all" && d.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const successCount = deployments.filter((d) => d.status === "success").length;
  const failedCount = deployments.filter((d) => d.status === "failed").length;
  const activeCount = deployments.filter(
    (d) => d.status === "deploying" || d.status === "pending"
  ).length;

  function handleRollback(deploymentId: string) {
    const deployment = deployments.find((d) => d.id === deploymentId);
    if (!deployment) {
      return;
    }
    toast.success(
      `Rolling back ${deployment.environment} to ${deployment.version}`
    );
    setDeployments((prev) =>
      prev.map((d) =>
        d.id === deploymentId ? { ...d, status: "deploying" as const } : d
      )
    );
  }

  function handleDeploy() {
    setIsDeploying(true);
    const newDeployment: Deployment = {
      id: `dep-${String(Date.now())}`,
      version: "v2.14.1-dev",
      branch: deployBranch,
      environment: deployEnv,
      status: "deploying",
      deployedBy: "You",
      timestamp: new Date().toISOString(),
      url: `https://${deployEnv === "prod" ? "app" : deployEnv}.prometheus.dev`,
      commitSha: "new0000",
      duration: "--",
    };

    setTimeout(() => {
      setDeployments((prev) => [newDeployment, ...prev]);
      setIsDeploying(false);
      setDeployDialogOpen(false);
      setDeployBranch("main");
      setDeployEnv("dev");
      toast.success(`Deployment to ${ENV_CONFIG[deployEnv].label} started`);
    }, 800);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Deployments</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Deployment history and management for project {projectId}
          </p>
        </div>
        <Button onClick={() => setDeployDialogOpen(true)}>
          <Rocket className="mr-2 h-4 w-4" />
          Deploy
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <ArrowUpRight className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {successCount}
              </p>
              <p className="text-muted-foreground text-sm">Successful</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
              <RotateCcw className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {failedCount}
              </p>
              <p className="text-muted-foreground text-sm">Failed</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Clock className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {activeCount}
              </p>
              <p className="text-muted-foreground text-sm">In Progress</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Deployment History</CardTitle>
            <div className="flex items-center gap-3">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select onValueChange={setEnvFilter} value={envFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Environments</SelectItem>
                  <SelectItem value="prod">Production</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="dev">Development</SelectItem>
                </SelectContent>
              </Select>
              <Select onValueChange={setStatusFilter} value={statusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="deploying">Deploying</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Deployed By</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeployments.map((deployment) => {
                const statusCfg = STATUS_CONFIG[deployment.status];
                const envCfg = ENV_CONFIG[deployment.environment];
                return (
                  <TableRow key={deployment.id}>
                    <TableCell>
                      <Badge variant={statusCfg.variant}>
                        {deployment.status === "deploying" && (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        )}
                        {statusCfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {deployment.version}
                    </TableCell>
                    <TableCell>
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                        {deployment.branch}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={envCfg.variant}>{envCfg.label}</Badge>
                    </TableCell>
                    <TableCell>{deployment.deployedBy}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(deployment.timestamp)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {deployment.duration}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {deployment.url && deployment.status === "success" && (
                          <Button
                            aria-label="Open deployment URL"
                            onClick={() =>
                              window.open(deployment.url, "_blank")
                            }
                            size="sm"
                            variant="ghost"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                        {deployment.status === "success" &&
                          deployment.environment === "prod" && (
                            <Button
                              onClick={() => handleRollback(deployment.id)}
                              size="sm"
                              variant="outline"
                            >
                              <RotateCcw className="mr-1 h-3 w-3" />
                              Rollback
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredDeployments.length === 0 && (
                <TableRow>
                  <TableCell
                    className="py-8 text-center text-muted-foreground"
                    colSpan={8}
                  >
                    No deployments found matching your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setDeployDialogOpen} open={deployDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Deployment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="deploy-branch">Branch</Label>
              <Input
                className="mt-1.5"
                id="deploy-branch"
                onChange={(e) => setDeployBranch(e.target.value)}
                placeholder="main"
                value={deployBranch}
              />
            </div>
            <div>
              <Label htmlFor="deploy-env">Environment</Label>
              <Select
                onValueChange={(v) => setDeployEnv(v as Environment)}
                value={deployEnv}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="prod">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setDeployDialogOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={isDeploying || !deployBranch.trim()}
                onClick={handleDeploy}
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Start Deploy
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
