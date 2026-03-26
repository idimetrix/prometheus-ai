"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@prometheus/ui";
import { Loader2, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface QuotaEdit {
  maxConcurrentSessions: number;
  maxDailyCredits: number;
}

export function AgentAllocation() {
  const [edits, setEdits] = useState<Record<string, QuotaEdit>>({});

  const quotasQuery = trpc.team.quotas.list.useQuery({ limit: 50 });
  const setQuotaMutation = trpc.team.quotas.set.useMutation();
  const utilizationQuery = trpc.team.utilization.useQuery();

  const quotas = quotasQuery.data?.quotas ?? [];
  const utilization = utilizationQuery.data;

  function handleEdit(userId: string, field: keyof QuotaEdit, value: number) {
    setEdits((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? {
          maxConcurrentSessions: 2,
          maxDailyCredits: 100,
        }),
        [field]: value,
      },
    }));
  }

  async function handleSave(userId: string) {
    const edit = edits[userId];
    if (!edit) {
      return;
    }

    try {
      await setQuotaMutation.mutateAsync({
        userId,
        maxConcurrentSessions: edit.maxConcurrentSessions,
        maxDailyCredits: edit.maxDailyCredits,
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      quotasQuery.refetch();
      utilizationQuery.refetch();
      toast.success("Quota updated");
    } catch {
      toast.error("Failed to update quota");
    }
  }

  function getSessionPercent(current: number, max: number): number {
    if (max === 0) {
      return 0;
    }
    return Math.min((current / max) * 100, 100);
  }

  function getCreditPercent(used: number, max: number): number {
    if (max === 0) {
      return 0;
    }
    return Math.min((used / max) * 100, 100);
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      {utilization && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-muted-foreground text-xs">
                Total Active Sessions
              </p>
              <p className="mt-1 font-bold text-2xl">
                {utilization.totalActiveSessions}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-muted-foreground text-xs">
                Credits Used Today
              </p>
              <p className="mt-1 font-bold text-2xl">
                {utilization.totalCreditsUsed}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-muted-foreground text-xs">
                Total Credits Available
              </p>
              <p className="mt-1 font-bold text-2xl">
                {utilization.totalCreditsAvailable}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quota table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Team Agent Quotas</CardTitle>
        </CardHeader>
        <CardContent>
          {quotasQuery.isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!quotasQuery.isLoading && quotas.length === 0 && (
            <p className="py-8 text-center text-muted-foreground text-sm">
              No team quotas configured.
            </p>
          )}
          {!quotasQuery.isLoading && quotas.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Max Sessions</TableHead>
                  <TableHead>Session Usage</TableHead>
                  <TableHead>Max Daily Credits</TableHead>
                  <TableHead>Credit Usage</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotas.map((quota) => {
                  const edit = edits[quota.userId];
                  const maxSessions =
                    edit?.maxConcurrentSessions ?? quota.maxConcurrentSessions;
                  const maxCredits =
                    edit?.maxDailyCredits ?? quota.maxDailyCredits;

                  return (
                    <TableRow key={quota.id}>
                      <TableCell className="font-medium">
                        {quota.userId}
                      </TableCell>
                      <TableCell>
                        <Input
                          className="w-20"
                          min={0}
                          onChange={(e) =>
                            handleEdit(
                              quota.userId,
                              "maxConcurrentSessions",
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                          type="number"
                          value={maxSessions}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Progress
                            className="h-2"
                            value={getSessionPercent(
                              quota.currentActiveSessions,
                              quota.maxConcurrentSessions
                            )}
                          />
                          <span className="text-muted-foreground text-xs">
                            {quota.currentActiveSessions}/
                            {quota.maxConcurrentSessions}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="w-24"
                          min={0}
                          onChange={(e) =>
                            handleEdit(
                              quota.userId,
                              "maxDailyCredits",
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                          type="number"
                          value={maxCredits}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Progress
                            className="h-2"
                            value={getCreditPercent(
                              quota.creditsUsedToday,
                              quota.maxDailyCredits
                            )}
                          />
                          <span className="text-muted-foreground text-xs">
                            {quota.creditsUsedToday}/{quota.maxDailyCredits}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {edit && (
                            <Button
                              disabled={setQuotaMutation.isPending}
                              onClick={() => handleSave(quota.userId)}
                              size="icon"
                              title="Save"
                              variant="ghost"
                            >
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
