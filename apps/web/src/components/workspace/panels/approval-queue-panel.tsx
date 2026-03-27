"use client";

import { Badge, Button, Card, ScrollArea } from "@prometheus/ui";
import {
  AlertTriangle,
  Check,
  Clock,
  GitBranch,
  Rocket,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RiskLevel = "low" | "medium" | "high" | "critical";
type ApprovalType =
  | "deployment"
  | "file_delete"
  | "git_force_push"
  | "secret_access"
  | "schema_migration";
type ApprovalStatus = "pending" | "approved" | "rejected";

interface ApprovalItem {
  createdAt: string;
  description: string;
  id: string;
  metadata: Record<string, string>;
  requester: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  type: ApprovalType;
}

interface ApprovalQueuePanelProps {
  className?: string;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_CONFIG: Record<RiskLevel, { color: string; label: string }> = {
  low: { label: "Low", color: "bg-green-500/20 text-green-400" },
  medium: { label: "Medium", color: "bg-yellow-500/20 text-yellow-400" },
  high: { label: "High", color: "bg-orange-500/20 text-orange-400" },
  critical: { label: "Critical", color: "bg-red-500/20 text-red-400" },
};

const TYPE_CONFIG: Record<
  ApprovalType,
  { icon: typeof Rocket; label: string }
> = {
  deployment: { label: "Deployment", icon: Rocket },
  file_delete: { label: "File Delete", icon: Trash2 },
  git_force_push: { label: "Force Push", icon: GitBranch },
  secret_access: { label: "Secret Access", icon: Shield },
  schema_migration: { label: "Schema Migration", icon: AlertTriangle },
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_APPROVALS: ApprovalItem[] = [
  {
    id: "appr_001",
    type: "deployment",
    description: "Deploy v2.4.0 to production environment (us-east-1)",
    riskLevel: "high",
    requester: "Agent: Deploy Specialist",
    status: "pending",
    createdAt: "2026-03-26T09:15:00Z",
    metadata: {
      environment: "production",
      version: "v2.4.0",
      region: "us-east-1",
    },
  },
  {
    id: "appr_002",
    type: "file_delete",
    description:
      "Remove legacy migration files from src/db/migrations/ (12 files)",
    riskLevel: "medium",
    requester: "Agent: Refactoring Assistant",
    status: "pending",
    createdAt: "2026-03-26T09:22:00Z",
    metadata: { fileCount: "12", directory: "src/db/migrations/" },
  },
  {
    id: "appr_003",
    type: "git_force_push",
    description: "Force push to feature/auth-refactor after interactive rebase",
    riskLevel: "critical",
    requester: "Agent: Git Operations",
    status: "pending",
    createdAt: "2026-03-26T09:30:00Z",
    metadata: { branch: "feature/auth-refactor", commits: "3 squashed" },
  },
  {
    id: "appr_004",
    type: "schema_migration",
    description:
      "Add index on sessions.org_id and drop unused column sessions.legacy_ref",
    riskLevel: "high",
    requester: "Agent: Database Specialist",
    status: "pending",
    createdAt: "2026-03-26T09:45:00Z",
    metadata: { table: "sessions", operation: "alter" },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApprovalQueuePanel({
  className,
  onApprove,
  onReject,
}: ApprovalQueuePanelProps) {
  const [items, setItems] = useState<ApprovalItem[]>(MOCK_APPROVALS);

  const pendingCount = items.filter((i) => i.status === "pending").length;

  const handleApprove = useCallback(
    (id: string) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: "approved" as const } : item
        )
      );
      onApprove?.(id);
    },
    [onApprove]
  );

  const handleReject = useCallback(
    (id: string) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: "rejected" as const } : item
        )
      );
      onReject?.(id);
    },
    [onReject]
  );

  return (
    <Card
      className={`flex flex-col border-zinc-800 bg-zinc-950 ${className ?? ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-violet-400" />
          <h3 className="font-medium text-sm text-zinc-200">Approval Queue</h3>
          {pendingCount > 0 && (
            <Badge
              className="bg-violet-500/20 text-violet-400"
              variant="secondary"
            >
              {pendingCount}
            </Badge>
          )}
        </div>
      </div>

      {/* Items */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {items.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-600">
              No pending approvals
            </div>
          ) : (
            items.map((item) => {
              const riskConfig = RISK_CONFIG[item.riskLevel];
              const typeConfig = TYPE_CONFIG[item.type];
              const Icon = typeConfig.icon;
              const isPending = item.status === "pending";

              return (
                <div
                  className={`rounded-lg border p-3 transition-colors ${
                    isPending
                      ? "border-zinc-800 bg-zinc-900/50"
                      : "border-zinc-800/50 bg-zinc-900/20 opacity-60"
                  }`}
                  key={item.id}
                >
                  {/* Top row: type + risk */}
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-zinc-500" />
                    <Badge
                      className="bg-zinc-800 text-zinc-400"
                      variant="secondary"
                    >
                      {typeConfig.label}
                    </Badge>
                    <Badge className={riskConfig.color} variant="secondary">
                      {riskConfig.label} Risk
                    </Badge>
                    {!isPending && (
                      <Badge
                        className={
                          item.status === "approved"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-red-500/20 text-red-400"
                        }
                        variant="secondary"
                      >
                        {item.status === "approved" ? "Approved" : "Rejected"}
                      </Badge>
                    )}
                  </div>

                  {/* Description */}
                  <p className="mb-2 text-xs text-zinc-300">
                    {item.description}
                  </p>

                  {/* Meta row */}
                  <div className="mb-2 flex items-center gap-3 text-[10px] text-zinc-500">
                    <span>{item.requester}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {timeAgo(item.createdAt)}
                    </span>
                  </div>

                  {/* Actions */}
                  {isPending && (
                    <div className="flex items-center gap-2">
                      <Button
                        className="h-7 bg-green-500/10 text-green-400 text-xs hover:bg-green-500/20"
                        onClick={() => handleApprove(item.id)}
                        size="sm"
                        variant="ghost"
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Approve
                      </Button>
                      <Button
                        className="h-7 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20"
                        onClick={() => handleReject(item.id)}
                        size="sm"
                        variant="ghost"
                      >
                        <X className="mr-1 h-3 w-3" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
