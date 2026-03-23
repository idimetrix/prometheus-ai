"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CreditCard,
  DollarSign,
  TrendingUp,
  Users,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RevenueOverview {
  creditPackRevenue: number;
  monthlyRecurringRevenue: number;
  revenueGrowthPercent: number;
  totalRevenue: number;
}

export interface SubscriptionsByPlan {
  count: number;
  plan: string;
  revenue: number;
}

export interface CreditVolume {
  averageUtilization: number;
  totalCreditsConsumed: number;
  totalCreditsGranted: number;
  totalCreditsPurchased: number;
}

export interface TopConsumer {
  costUsd: number;
  creditsUsed: number;
  orgId: string;
  orgName: string;
  plan: string;
  tasksCompleted: number;
}

export interface ChurnRiskOrg {
  creditsRemaining: number;
  daysInactive: number;
  orgId: string;
  orgName: string;
  plan: string;
  reason: string;
  riskLevel: "high" | "medium" | "low";
}

export interface CreditAdjustment {
  amount: number;
  orgId: string;
  reason: string;
  type: "bonus" | "refund" | "manual";
}

export interface BillingAdminProps {
  /** Organizations at risk of churning */
  churnRisk: ChurnRiskOrg[];
  /** Credit volume metrics */
  creditVolume: CreditVolume;
  /** Whether an adjustment is being processed */
  isAdjusting?: boolean;
  /** Callback for manual credit adjustment */
  onCreditAdjustment: (adjustment: CreditAdjustment) => Promise<void>;
  /** Revenue overview data */
  revenue: RevenueOverview;
  /** Subscriptions grouped by plan */
  subscriptionsByPlan: SubscriptionsByPlan[];
  /** Top credit consumers */
  topConsumers: TopConsumer[];
}

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function MetricCard({
  icon,
  label,
  value,
  subtext,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  trend?: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="font-bold text-2xl">{value}</p>
          {subtext && (
            <p className="text-muted-foreground text-xs">{subtext}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="rounded-md bg-muted p-2">{icon}</div>
          {trend != null && (
            <div
              className={`flex items-center gap-0.5 text-xs ${
                trend >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {trend >= 0 ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {Math.abs(trend).toFixed(1)}%
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCredits(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toLocaleString();
}

function getRiskBadgeVariant(
  riskLevel: "high" | "medium" | "low"
): "destructive" | "secondary" | "outline" {
  if (riskLevel === "high") {
    return "destructive";
  }
  if (riskLevel === "medium") {
    return "secondary";
  }
  return "outline";
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function BillingAdmin({
  revenue,
  subscriptionsByPlan,
  creditVolume,
  topConsumers,
  churnRisk,
  onCreditAdjustment,
  isAdjusting = false,
}: BillingAdminProps) {
  const [adjustmentOrgId, setAdjustmentOrgId] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<
    "bonus" | "refund" | "manual"
  >("manual");

  const totalSubscriptions = useMemo(
    () => subscriptionsByPlan.reduce((sum, p) => sum + p.count, 0),
    [subscriptionsByPlan]
  );

  const handleAdjustment = useCallback(async () => {
    if (!(adjustmentOrgId && adjustmentAmount && adjustmentReason)) {
      return;
    }
    await onCreditAdjustment({
      orgId: adjustmentOrgId,
      amount: Number.parseInt(adjustmentAmount, 10),
      reason: adjustmentReason,
      type: adjustmentType,
    });
    setAdjustmentOrgId("");
    setAdjustmentAmount("");
    setAdjustmentReason("");
  }, [
    adjustmentOrgId,
    adjustmentAmount,
    adjustmentReason,
    adjustmentType,
    onCreditAdjustment,
  ]);

  return (
    <div className="space-y-6">
      {/* Revenue Overview */}
      <div>
        <h2 className="mb-3 font-semibold text-lg">Revenue Overview</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<DollarSign className="h-4 w-4" />}
            label="Monthly Recurring Revenue"
            subtext="Subscription revenue"
            trend={revenue.revenueGrowthPercent}
            value={formatCurrency(revenue.monthlyRecurringRevenue)}
          />
          <MetricCard
            icon={<CreditCard className="h-4 w-4" />}
            label="Credit Pack Revenue"
            subtext="One-time purchases"
            value={formatCurrency(revenue.creditPackRevenue)}
          />
          <MetricCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Total Revenue"
            subtext="All sources"
            value={formatCurrency(revenue.totalRevenue)}
          />
          <MetricCard
            icon={<Users className="h-4 w-4" />}
            label="Total Subscriptions"
            subtext={`${subscriptionsByPlan.length} plans`}
            value={totalSubscriptions.toLocaleString()}
          />
        </div>
      </div>

      {/* Subscriptions by Plan */}
      <div>
        <h2 className="mb-3 font-semibold text-lg">Subscriptions by Plan</h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-muted-foreground text-xs">
                  <th className="p-3">Plan</th>
                  <th className="p-3 text-right">Subscribers</th>
                  <th className="p-3 text-right">Revenue</th>
                  <th className="p-3 text-right">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {subscriptionsByPlan.map((plan) => (
                  <tr className="border-b last:border-0" key={plan.plan}>
                    <td className="p-3 font-medium">{plan.plan}</td>
                    <td className="p-3 text-right">{plan.count}</td>
                    <td className="p-3 text-right">
                      {formatCurrency(plan.revenue)}
                    </td>
                    <td className="p-3 text-right">
                      {totalSubscriptions > 0
                        ? ((plan.count / totalSubscriptions) * 100).toFixed(1)
                        : 0}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Credit Volume */}
      <div>
        <h2 className="mb-3 font-semibold text-lg">Credit Volume</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Credits Granted"
            subtext="Subscriptions + bonuses"
            value={formatCredits(creditVolume.totalCreditsGranted)}
          />
          <MetricCard
            icon={<ArrowDown className="h-4 w-4" />}
            label="Credits Consumed"
            subtext="Task executions"
            value={formatCredits(creditVolume.totalCreditsConsumed)}
          />
          <MetricCard
            icon={<CreditCard className="h-4 w-4" />}
            label="Credits Purchased"
            subtext="Credit packs"
            value={formatCredits(creditVolume.totalCreditsPurchased)}
          />
          <MetricCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Utilization Rate"
            subtext="Consumed / Granted"
            value={`${creditVolume.averageUtilization.toFixed(1)}%`}
          />
        </div>
      </div>

      {/* Top Consumers */}
      <div>
        <h2 className="mb-3 font-semibold text-lg">Top Consumers</h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-muted-foreground text-xs">
                  <th className="p-3">Organization</th>
                  <th className="p-3">Plan</th>
                  <th className="p-3 text-right">Credits Used</th>
                  <th className="p-3 text-right">Cost</th>
                  <th className="p-3 text-right">Tasks</th>
                </tr>
              </thead>
              <tbody>
                {topConsumers.map((consumer) => (
                  <tr className="border-b last:border-0" key={consumer.orgId}>
                    <td className="p-3">
                      <div>
                        <p className="font-medium">{consumer.orgName}</p>
                        <p className="text-muted-foreground text-xs">
                          {consumer.orgId}
                        </p>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary">{consumer.plan}</Badge>
                    </td>
                    <td className="p-3 text-right">
                      {consumer.creditsUsed.toLocaleString()}
                    </td>
                    <td className="p-3 text-right">
                      ${consumer.costUsd.toFixed(2)}
                    </td>
                    <td className="p-3 text-right">
                      {consumer.tasksCompleted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Churn Risk */}
      <div>
        <h2 className="mb-3 font-semibold text-lg">Churn Risk</h2>
        {churnRisk.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              No organizations currently flagged for churn risk.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="p-3">Organization</th>
                    <th className="p-3">Risk</th>
                    <th className="p-3">Reason</th>
                    <th className="p-3 text-right">Days Inactive</th>
                    <th className="p-3 text-right">Credits Left</th>
                  </tr>
                </thead>
                <tbody>
                  {churnRisk.map((org) => (
                    <tr className="border-b last:border-0" key={org.orgId}>
                      <td className="p-3">
                        <div>
                          <p className="font-medium">{org.orgName}</p>
                          <p className="text-muted-foreground text-xs">
                            {org.plan}
                          </p>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant={getRiskBadgeVariant(org.riskLevel)}>
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {org.riskLevel}
                        </Badge>
                      </td>
                      <td className="p-3 text-sm">{org.reason}</td>
                      <td className="p-3 text-right">{org.daysInactive}</td>
                      <td className="p-3 text-right">
                        {org.creditsRemaining.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Manual Credit Adjustment */}
      <div>
        <h2 className="mb-3 font-semibold text-lg">Manual Credit Adjustment</h2>
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label
                  className="text-muted-foreground text-sm"
                  htmlFor="adj-org-id"
                >
                  Organization ID
                </label>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  disabled={isAdjusting}
                  id="adj-org-id"
                  onChange={(e) => setAdjustmentOrgId(e.target.value)}
                  placeholder="org_..."
                  type="text"
                  value={adjustmentOrgId}
                />
              </div>
              <div className="space-y-1">
                <label
                  className="text-muted-foreground text-sm"
                  htmlFor="adj-amount"
                >
                  Amount (positive = add)
                </label>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  disabled={isAdjusting}
                  id="adj-amount"
                  onChange={(e) => setAdjustmentAmount(e.target.value)}
                  placeholder="100"
                  type="number"
                  value={adjustmentAmount}
                />
              </div>
              <div className="space-y-1">
                <label
                  className="text-muted-foreground text-sm"
                  htmlFor="adj-type"
                >
                  Type
                </label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  disabled={isAdjusting}
                  id="adj-type"
                  onChange={(e) =>
                    setAdjustmentType(
                      e.target.value as "bonus" | "refund" | "manual"
                    )
                  }
                  value={adjustmentType}
                >
                  <option value="manual">Manual Adjustment</option>
                  <option value="bonus">Bonus</option>
                  <option value="refund">Refund</option>
                </select>
              </div>
              <div className="space-y-1">
                <label
                  className="text-muted-foreground text-sm"
                  htmlFor="adj-reason"
                >
                  Reason
                </label>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  disabled={isAdjusting}
                  id="adj-reason"
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Customer support request #123"
                  type="text"
                  value={adjustmentReason}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                disabled={
                  !(adjustmentOrgId && adjustmentAmount && adjustmentReason) ||
                  isAdjusting
                }
                onClick={handleAdjustment}
                variant="default"
              >
                {isAdjusting ? "Processing..." : "Apply Adjustment"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
