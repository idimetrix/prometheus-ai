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
  Input,
  Label,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@prometheus/ui";
import {
  AlertTriangle,
  Check,
  CheckCircle,
  Clock,
  Shield,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ApprovalStatus = "pending" | "approved" | "rejected";

interface ApprovalRequest {
  actionDescription: string;
  actionType: string;
  id: string;
  project: string;
  rejectionReason: string | null;
  requester: string;
  requesterEmail: string;
  reviewedAt: string | null;
  reviewer: string | null;
  risk: "low" | "medium" | "high";
  status: ApprovalStatus;
  timestamp: string;
}

const MOCK_APPROVALS: ApprovalRequest[] = [
  {
    id: "apr-001",
    actionType: "deployment.production",
    actionDescription: "Deploy v2.14.0 to production environment",
    requester: "James Wilson",
    requesterEmail: "james@acme.dev",
    project: "prometheus-web",
    timestamp: "2026-03-26T14:20:00Z",
    status: "pending",
    reviewer: null,
    reviewedAt: null,
    rejectionReason: null,
    risk: "high",
  },
  {
    id: "apr-002",
    actionType: "secret.rotation",
    actionDescription: "Rotate database credentials for production",
    requester: "Alex Kim",
    requesterEmail: "alex@acme.dev",
    project: "prometheus-api",
    timestamp: "2026-03-26T13:45:00Z",
    status: "pending",
    reviewer: null,
    reviewedAt: null,
    rejectionReason: null,
    risk: "high",
  },
  {
    id: "apr-003",
    actionType: "member.role_change",
    actionDescription: "Promote Jordan Patel to Admin role",
    requester: "Sarah Chen",
    requesterEmail: "sarah@acme.dev",
    project: "Organization",
    timestamp: "2026-03-26T11:30:00Z",
    status: "pending",
    reviewer: null,
    reviewedAt: null,
    rejectionReason: null,
    risk: "medium",
  },
  {
    id: "apr-004",
    actionType: "database.migration",
    actionDescription: "Run migration #47: Add indexes to sessions table",
    requester: "Maria Lopez",
    requesterEmail: "maria@acme.dev",
    project: "prometheus-api",
    timestamp: "2026-03-26T10:15:00Z",
    status: "pending",
    reviewer: null,
    reviewedAt: null,
    rejectionReason: null,
    risk: "medium",
  },
  {
    id: "apr-005",
    actionType: "deployment.production",
    actionDescription: "Deploy hotfix v2.13.2 to production",
    requester: "Alex Kim",
    requesterEmail: "alex@acme.dev",
    project: "prometheus-api",
    timestamp: "2026-03-25T22:10:00Z",
    status: "approved",
    reviewer: "Sarah Chen",
    reviewedAt: "2026-03-25T22:15:00Z",
    rejectionReason: null,
    risk: "high",
  },
  {
    id: "apr-006",
    actionType: "secret.create",
    actionDescription: "Add Stripe API key to staging environment",
    requester: "Jordan Patel",
    requesterEmail: "jordan@acme.dev",
    project: "prometheus-web",
    timestamp: "2026-03-25T16:40:00Z",
    status: "approved",
    reviewer: "James Wilson",
    reviewedAt: "2026-03-25T17:00:00Z",
    rejectionReason: null,
    risk: "low",
  },
  {
    id: "apr-007",
    actionType: "member.invite",
    actionDescription: "Invite external contractor (contract-dev@vendor.io)",
    requester: "Sarah Chen",
    requesterEmail: "sarah@acme.dev",
    project: "Organization",
    timestamp: "2026-03-25T14:20:00Z",
    status: "approved",
    reviewer: "James Wilson",
    reviewedAt: "2026-03-25T14:55:00Z",
    rejectionReason: null,
    risk: "medium",
  },
  {
    id: "apr-008",
    actionType: "deployment.production",
    actionDescription: "Deploy v2.12.0-beta to production (skipping staging)",
    requester: "Jordan Patel",
    requesterEmail: "jordan@acme.dev",
    project: "mobile-app",
    timestamp: "2026-03-24T09:30:00Z",
    status: "rejected",
    reviewer: "Sarah Chen",
    reviewedAt: "2026-03-24T10:00:00Z",
    rejectionReason:
      "Beta versions should not be deployed to production. Please promote through staging first.",
    risk: "high",
  },
  {
    id: "apr-009",
    actionType: "database.delete",
    actionDescription: "Drop legacy analytics tables from production database",
    requester: "James Wilson",
    requesterEmail: "james@acme.dev",
    project: "data-pipeline",
    timestamp: "2026-03-23T15:00:00Z",
    status: "rejected",
    reviewer: "Alex Kim",
    reviewedAt: "2026-03-23T16:30:00Z",
    rejectionReason:
      "Tables are still referenced by the reporting service. Please migrate the reporting queries first.",
    risk: "high",
  },
  {
    id: "apr-010",
    actionType: "secret.rotation",
    actionDescription: "Rotate OAuth client secrets for GitHub integration",
    requester: "Maria Lopez",
    requesterEmail: "maria@acme.dev",
    project: "prometheus-api",
    timestamp: "2026-03-23T11:00:00Z",
    status: "approved",
    reviewer: "Alex Kim",
    reviewedAt: "2026-03-23T11:20:00Z",
    rejectionReason: null,
    risk: "medium",
  },
];

const RISK_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  low: { label: "Low", variant: "secondary" },
  medium: { label: "Medium", variant: "default" },
  high: { label: "High", variant: "destructive" },
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

function getActionLabel(actionType: string): string {
  const labels: Record<string, string> = {
    "deployment.production": "Production Deploy",
    "secret.rotation": "Secret Rotation",
    "secret.create": "Secret Creation",
    "member.role_change": "Role Change",
    "member.invite": "Member Invite",
    "database.migration": "Database Migration",
    "database.delete": "Database Delete",
  };
  return labels[actionType] ?? actionType;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>(MOCK_APPROVALS);
  const [activeTab, setActiveTab] = useState("pending");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const approvedApprovals = approvals.filter((a) => a.status === "approved");
  const rejectedApprovals = approvals.filter((a) => a.status === "rejected");

  function handleApproveClick(id: string) {
    setApprovingId(id);
    setConfirmDialogOpen(true);
  }

  function handleConfirmApprove() {
    if (!approvingId) {
      return;
    }
    setApprovals((prev) =>
      prev.map((a) =>
        a.id === approvingId
          ? {
              ...a,
              status: "approved" as const,
              reviewer: "You",
              reviewedAt: new Date().toISOString(),
            }
          : a
      )
    );
    const item = approvals.find((a) => a.id === approvingId);
    toast.success(`Approved: ${item?.actionDescription ?? "request"}`);
    setConfirmDialogOpen(false);
    setApprovingId(null);
  }

  function handleRejectClick(id: string) {
    setRejectingId(id);
    setRejectionReason("");
    setRejectDialogOpen(true);
  }

  function handleConfirmReject() {
    if (!(rejectingId && rejectionReason.trim())) {
      return;
    }
    setApprovals((prev) =>
      prev.map((a) =>
        a.id === rejectingId
          ? {
              ...a,
              status: "rejected" as const,
              reviewer: "You",
              reviewedAt: new Date().toISOString(),
              rejectionReason: rejectionReason.trim(),
            }
          : a
      )
    );
    const item = approvals.find((a) => a.id === rejectingId);
    toast.success(`Rejected: ${item?.actionDescription ?? "request"}`);
    setRejectDialogOpen(false);
    setRejectingId(null);
    setRejectionReason("");
  }

  function renderTable(items: ApprovalRequest[]) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Action</TableHead>
            <TableHead>Requester</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead>Requested</TableHead>
            {activeTab !== "pending" && <TableHead>Reviewed By</TableHead>}
            {activeTab === "rejected" && <TableHead>Reason</TableHead>}
            {activeTab === "pending" && (
              <TableHead className="text-right">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((approval) => {
            const riskCfg = RISK_CONFIG[approval.risk];
            return (
              <TableRow key={approval.id}>
                <TableCell>
                  <div>
                    <p className="font-medium text-sm">
                      {getActionLabel(approval.actionType)}
                    </p>
                    <p className="max-w-[280px] truncate text-muted-foreground text-xs">
                      {approval.actionDescription}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-sm">{approval.requester}</p>
                    <p className="text-muted-foreground text-xs">
                      {approval.requesterEmail}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{approval.project}</TableCell>
                <TableCell>
                  <Badge variant={riskCfg?.variant ?? "outline"}>
                    {riskCfg?.label ?? "Unknown"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatTimestamp(approval.timestamp)}
                </TableCell>
                {activeTab !== "pending" && (
                  <TableCell>
                    <div>
                      <p className="text-sm">{approval.reviewer}</p>
                      {approval.reviewedAt && (
                        <p className="text-muted-foreground text-xs">
                          {formatTimestamp(approval.reviewedAt)}
                        </p>
                      )}
                    </div>
                  </TableCell>
                )}
                {activeTab === "rejected" && (
                  <TableCell className="max-w-[200px] truncate text-muted-foreground text-xs">
                    {approval.rejectionReason}
                  </TableCell>
                )}
                {activeTab === "pending" && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        onClick={() => handleApproveClick(approval.id)}
                        size="sm"
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Approve
                      </Button>
                      <Button
                        onClick={() => handleRejectClick(approval.id)}
                        size="sm"
                        variant="destructive"
                      >
                        <X className="mr-1 h-3 w-3" />
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {items.length === 0 && (
            <TableRow>
              <TableCell
                className="py-8 text-center text-muted-foreground"
                colSpan={activeTab === "pending" ? 6 : 7}
              >
                No {activeTab} approval requests.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">Approvals</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Review and manage approval requests for sensitive actions.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {pendingApprovals.length}
              </p>
              <p className="text-muted-foreground text-sm">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {approvedApprovals.length}
              </p>
              <p className="text-muted-foreground text-sm">Approved</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
              <XCircle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {rejectedApprovals.length}
              </p>
              <p className="text-muted-foreground text-sm">Rejected</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval Requests</CardTitle>
          <CardDescription>
            {pendingApprovals.length > 0
              ? `${pendingApprovals.length} request(s) awaiting your review`
              : "All caught up. No pending requests."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs onValueChange={setActiveTab} value={activeTab}>
            <TabsList>
              <TabsTrigger value="pending">
                Pending
                {pendingApprovals.length > 0 && (
                  <Badge className="ml-2" variant="secondary">
                    {pendingApprovals.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </TabsList>
            <TabsContent className="pt-4" value="pending">
              {renderTable(pendingApprovals)}
            </TabsContent>
            <TabsContent className="pt-4" value="approved">
              {renderTable(approvedApprovals)}
            </TabsContent>
            <TabsContent className="pt-4" value="rejected">
              {renderTable(rejectedApprovals)}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setConfirmDialogOpen} open={confirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Approval</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <p className="font-medium text-sm">
                  Are you sure you want to approve this action?
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  {approvals.find((a) => a.id === approvingId)
                    ?.actionDescription ?? ""}
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setConfirmDialogOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmApprove}>
                <Shield className="mr-2 h-4 w-4" />
                Confirm Approval
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setRejectDialogOpen} open={rejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-muted-foreground text-sm">
              Rejecting:{" "}
              <span className="font-medium text-foreground">
                {approvals.find((a) => a.id === rejectingId)
                  ?.actionDescription ?? ""}
              </span>
            </p>
            <div>
              <Label htmlFor="rejection-reason">
                Reason for Rejection <span className="text-destructive">*</span>
              </Label>
              <Input
                className="mt-1.5"
                id="rejection-reason"
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this request is being rejected..."
                value={rejectionReason}
              />
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setRejectDialogOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={!rejectionReason.trim()}
                onClick={handleConfirmReject}
                variant="destructive"
              >
                <X className="mr-2 h-4 w-4" />
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
