"use client";

function getScanStatusVariant(status: string) {
  if (status === "completed") {
    return "default" as const;
  }
  if (status === "failed") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

function _getSeverityVariant(severity: string) {
  if (severity === "critical") {
    return "destructive" as const;
  }
  if (severity === "high") {
    return "default" as const;
  }
  return "secondary" as const;
}

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@prometheus/ui";
import {
  AlertTriangle,
  Bug,
  CheckCircle,
  Clock,
  FileCode,
  Loader2,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";

type Severity = "critical" | "high" | "medium" | "low";
type VulnStatus = "open" | "fixed" | "ignored" | "in_progress";

interface Vulnerability {
  cve: string | null;
  description: string;
  detectedAt: string;
  file: string;
  id: string;
  line: number;
  package: string;
  severity: Severity;
  status: VulnStatus;
  title: string;
}

interface ScanRecord {
  completedAt: string;
  critical: number;
  duration: string;
  findings: number;
  high: number;
  id: string;
  low: number;
  medium: number;
  startedAt: string;
  status: "completed" | "failed" | "running";
}

interface SecurityPolicy {
  description: string;
  enabled: boolean;
  id: string;
  name: string;
}

const MOCK_VULNERABILITIES: Vulnerability[] = [
  {
    id: "vuln-001",
    severity: "critical",
    title: "SQL Injection in query builder",
    description:
      "User input is directly concatenated into SQL query without parameterization.",
    file: "src/lib/db/queries.ts",
    line: 142,
    package: "custom",
    cve: "CVE-2026-0142",
    status: "open",
    detectedAt: "2026-03-26T02:00:00Z",
  },
  {
    id: "vuln-002",
    severity: "critical",
    title: "Prototype pollution in lodash",
    description:
      "lodash@4.17.20 is vulnerable to prototype pollution via the set function.",
    file: "package.json",
    line: 28,
    package: "lodash@4.17.20",
    cve: "CVE-2025-18423",
    status: "in_progress",
    detectedAt: "2026-03-25T02:00:00Z",
  },
  {
    id: "vuln-003",
    severity: "high",
    title: "Cross-site scripting (XSS) in markdown renderer",
    description:
      "Untrusted HTML is rendered without sanitization in the markdown preview component.",
    file: "src/components/preview/markdown.tsx",
    line: 67,
    package: "custom",
    cve: null,
    status: "open",
    detectedAt: "2026-03-26T02:00:00Z",
  },
  {
    id: "vuln-004",
    severity: "high",
    title: "Insecure deserialization in session handler",
    description:
      "Session data is deserialized without validation, allowing arbitrary object injection.",
    file: "src/middleware/session.ts",
    line: 34,
    package: "custom",
    cve: null,
    status: "open",
    detectedAt: "2026-03-24T02:00:00Z",
  },
  {
    id: "vuln-005",
    severity: "high",
    title: "Directory traversal in file upload",
    description:
      "File upload handler does not sanitize file paths, allowing path traversal attacks.",
    file: "src/routes/upload.ts",
    line: 89,
    package: "custom",
    cve: null,
    status: "fixed",
    detectedAt: "2026-03-20T02:00:00Z",
  },
  {
    id: "vuln-006",
    severity: "medium",
    title: "Outdated TLS configuration",
    description:
      "Server accepts TLS 1.0 and 1.1 connections which are deprecated.",
    file: "infra/nginx.conf",
    line: 15,
    package: "nginx",
    cve: null,
    status: "open",
    detectedAt: "2026-03-26T02:00:00Z",
  },
  {
    id: "vuln-007",
    severity: "medium",
    title: "Missing rate limiting on authentication endpoint",
    description:
      "The /auth/login endpoint lacks rate limiting, enabling brute force attacks.",
    file: "src/routes/auth.ts",
    line: 23,
    package: "custom",
    cve: null,
    status: "in_progress",
    detectedAt: "2026-03-23T02:00:00Z",
  },
  {
    id: "vuln-008",
    severity: "medium",
    title: "Vulnerable dependency: axios",
    description:
      "axios@0.21.1 has a server-side request forgery vulnerability.",
    file: "package.json",
    line: 15,
    package: "axios@0.21.1",
    cve: "CVE-2025-27152",
    status: "fixed",
    detectedAt: "2026-03-18T02:00:00Z",
  },
  {
    id: "vuln-009",
    severity: "low",
    title: "Information disclosure in error messages",
    description:
      "Stack traces and internal paths are exposed in API error responses.",
    file: "src/middleware/error-handler.ts",
    line: 12,
    package: "custom",
    cve: null,
    status: "open",
    detectedAt: "2026-03-26T02:00:00Z",
  },
  {
    id: "vuln-010",
    severity: "low",
    title: "Missing security headers",
    description:
      "X-Content-Type-Options and X-Frame-Options headers are not set.",
    file: "src/middleware/headers.ts",
    line: 5,
    package: "custom",
    cve: null,
    status: "ignored",
    detectedAt: "2026-03-22T02:00:00Z",
  },
];

const MOCK_SCANS: ScanRecord[] = [
  {
    id: "scan-001",
    startedAt: "2026-03-26T02:00:00Z",
    completedAt: "2026-03-26T02:08:42Z",
    duration: "8m 42s",
    findings: 8,
    critical: 2,
    high: 2,
    medium: 2,
    low: 2,
    status: "completed",
  },
  {
    id: "scan-002",
    startedAt: "2026-03-25T02:00:00Z",
    completedAt: "2026-03-25T02:09:15Z",
    duration: "9m 15s",
    findings: 9,
    critical: 2,
    high: 3,
    medium: 2,
    low: 2,
    status: "completed",
  },
  {
    id: "scan-003",
    startedAt: "2026-03-24T02:00:00Z",
    completedAt: "2026-03-24T02:07:58Z",
    duration: "7m 58s",
    findings: 10,
    critical: 3,
    high: 3,
    medium: 2,
    low: 2,
    status: "completed",
  },
  {
    id: "scan-004",
    startedAt: "2026-03-23T02:00:00Z",
    completedAt: "2026-03-23T02:04:12Z",
    duration: "4m 12s",
    findings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    status: "failed",
  },
  {
    id: "scan-005",
    startedAt: "2026-03-22T02:00:00Z",
    completedAt: "2026-03-22T02:10:30Z",
    duration: "10m 30s",
    findings: 11,
    critical: 3,
    high: 3,
    medium: 3,
    low: 2,
    status: "completed",
  },
];

const MOCK_POLICIES: SecurityPolicy[] = [
  {
    id: "pol-001",
    name: "Dependency Scanning",
    description:
      "Automatically scan dependencies for known vulnerabilities on every push.",
    enabled: true,
  },
  {
    id: "pol-002",
    name: "Secret Detection",
    description:
      "Block commits containing hardcoded secrets, tokens, or API keys.",
    enabled: true,
  },
  {
    id: "pol-003",
    name: "SAST (Static Analysis)",
    description: "Run static code analysis to detect security anti-patterns.",
    enabled: true,
  },
  {
    id: "pol-004",
    name: "License Compliance",
    description: "Ensure all dependencies use approved open-source licenses.",
    enabled: false,
  },
  {
    id: "pol-005",
    name: "Container Scanning",
    description: "Scan Docker images for OS-level vulnerabilities.",
    enabled: true,
  },
  {
    id: "pol-006",
    name: "Block Critical Merges",
    description:
      "Prevent merging PRs with unresolved critical vulnerabilities.",
    enabled: true,
  },
];

const SEVERITY_CONFIG: Record<
  Severity,
  {
    label: string;
    variant: "destructive" | "default" | "secondary" | "outline";
    color: string;
  }
> = {
  critical: {
    label: "Critical",
    variant: "destructive",
    color: "text-red-500",
  },
  high: { label: "High", variant: "default", color: "text-orange-500" },
  medium: { label: "Medium", variant: "secondary", color: "text-amber-500" },
  low: { label: "Low", variant: "outline", color: "text-blue-500" },
};

const STATUS_CONFIG: Record<
  VulnStatus,
  {
    label: string;
    variant: "destructive" | "default" | "secondary" | "outline";
  }
> = {
  open: { label: "Open", variant: "destructive" },
  in_progress: { label: "In Progress", variant: "secondary" },
  fixed: { label: "Fixed", variant: "default" },
  ignored: { label: "Ignored", variant: "outline" },
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

export default function SecurityDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [vulnerabilities] = useState<Vulnerability[]>(MOCK_VULNERABILITIES);
  const [scans] = useState<ScanRecord[]>(MOCK_SCANS);
  const [policies, setPolicies] = useState<SecurityPolicy[]>(MOCK_POLICIES);
  const [isScanning, setIsScanning] = useState(false);

  const openVulns = vulnerabilities.filter((v) => v.status === "open");
  const criticalCount = openVulns.filter(
    (v) => v.severity === "critical"
  ).length;
  const highCount = openVulns.filter((v) => v.severity === "high").length;
  const mediumCount = openVulns.filter((v) => v.severity === "medium").length;
  const lowCount = openVulns.filter((v) => v.severity === "low").length;
  const fixedCount = vulnerabilities.filter((v) => v.status === "fixed").length;
  const totalFound = vulnerabilities.length;
  const remediationRate =
    totalFound > 0 ? Math.round((fixedCount / totalFound) * 100) : 0;

  function handleRunScan() {
    setIsScanning(true);
    toast.info(`Security scan started for ${projectId}`);
    setTimeout(() => {
      setIsScanning(false);
      toast.success("Security scan completed. 8 findings detected.");
    }, 2500);
  }

  function handleTogglePolicy(policyId: string) {
    setPolicies((prev) =>
      prev.map((p) => {
        if (p.id !== policyId) {
          return p;
        }
        const next = !p.enabled;
        toast.success(`${p.name} ${next ? "enabled" : "disabled"}`);
        return { ...p, enabled: next };
      })
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">
            Security Dashboard
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Vulnerability scanning and security policies for project {projectId}
          </p>
        </div>
        <Button disabled={isScanning} onClick={handleRunScan}>
          {isScanning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Scanning...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Run Scan
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
              <ShieldAlert className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {criticalCount}
              </p>
              <p className="text-muted-foreground text-sm">Critical</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {highCount}
              </p>
              <p className="text-muted-foreground text-sm">High</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Bug className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {mediumCount + lowCount}
              </p>
              <p className="text-muted-foreground text-sm">Medium / Low</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {remediationRate}%
              </p>
              <p className="text-muted-foreground text-sm">Remediation Rate</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground text-sm">Last Scan</p>
              <p className="font-medium text-foreground">
                {formatTimestamp(scans[0]?.completedAt ?? "")}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground text-sm">
                Total Issues Found
              </p>
              <p className="font-medium text-foreground">{totalFound}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-muted-foreground text-sm">Issues Fixed</p>
              <p className="font-medium text-foreground">{fixedCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vulnerabilities</CardTitle>
          <CardDescription>
            {openVulns.length} open issues across {totalFound} total findings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Package</TableHead>
                <TableHead>CVE</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vulnerabilities.map((vuln) => {
                const sevCfg = SEVERITY_CONFIG[vuln.severity];
                const statusCfg = STATUS_CONFIG[vuln.status];
                return (
                  <TableRow key={vuln.id}>
                    <TableCell>
                      <Badge variant={sevCfg.variant}>{sevCfg.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{vuln.title}</p>
                        <p className="max-w-[300px] truncate text-muted-foreground text-xs">
                          {vuln.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono text-xs">
                          {vuln.file}:{vuln.line}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {vuln.package}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      {vuln.cve ?? "--"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusCfg.variant}>
                        {statusCfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatTimestamp(vuln.detectedAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan History</CardTitle>
            <CardDescription>Recent security scan results</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Findings</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell className="text-sm">
                      {formatTimestamp(scan.startedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {scan.duration}
                    </TableCell>
                    <TableCell>
                      {scan.status === "completed" ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{scan.findings}</span>
                          {scan.critical > 0 && (
                            <Badge className="text-xs" variant="destructive">
                              {scan.critical}C
                            </Badge>
                          )}
                          {scan.high > 0 && (
                            <Badge className="text-xs" variant="default">
                              {scan.high}H
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getScanStatusVariant(scan.status)}>
                        {scan.status === "completed" && (
                          <CheckCircle className="mr-1 h-3 w-3" />
                        )}
                        {scan.status.charAt(0).toUpperCase() +
                          scan.status.slice(1)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Security Policies</CardTitle>
            <CardDescription>
              Toggle security checks and enforcement rules
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {policies.map((policy) => (
                <div
                  className="flex items-center justify-between rounded-lg border p-3"
                  key={policy.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{policy.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {policy.description}
                    </p>
                  </div>
                  <Switch
                    aria-label={`Toggle ${policy.name}`}
                    checked={policy.enabled}
                    onCheckedChange={() => handleTogglePolicy(policy.id)}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
