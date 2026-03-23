"use client";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type HealthStatus = "healthy" | "warning" | "critical";

interface QualityMetric {
  label: string;
  status: HealthStatus;
  trend: number[];
  value: number;
}

interface SecurityItem {
  count: number;
  label: string;
  severity: "low" | "medium" | "high" | "critical";
}

interface ProjectHealthDashboardProps {
  className?: string;
  lastScanAt?: number;
  qualityMetrics: QualityMetric[];
  securityItems: SecurityItem[];
  testCoverage: number;
  testsPassing: number;
  testsTotal: number;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const STATUS_COLOR: Record<HealthStatus, string> = {
  critical: "text-red-400",
  healthy: "text-green-400",
  warning: "text-yellow-400",
};

const STATUS_BG: Record<HealthStatus, string> = {
  critical: "bg-red-500",
  healthy: "bg-green-500",
  warning: "bg-yellow-500",
};

const SEVERITY_COLOR: Record<SecurityItem["severity"], string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  low: "text-zinc-400",
  medium: "text-yellow-400",
};

function overallStatus(metrics: QualityMetric[]): HealthStatus {
  if (metrics.some((m) => m.status === "critical")) {
    return "critical";
  }
  if (metrics.some((m) => m.status === "warning")) {
    return "warning";
  }
  return "healthy";
}

/* -------------------------------------------------------------------------- */
/*  Mini sparkline                                                             */
/* -------------------------------------------------------------------------- */

function MiniTrend({ data }: { data: number[] }) {
  if (data.length < 2) {
    return null;
  }

  const width = 60;
  const height = 20;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg aria-hidden="true" className="shrink-0" height={height} width={width}>
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function ProjectHealthDashboard({
  qualityMetrics,
  testCoverage,
  testsPassing,
  testsTotal,
  securityItems,
  lastScanAt,
  className = "",
}: ProjectHealthDashboardProps) {
  const overall = overallStatus(qualityMetrics);
  const totalSecurityIssues = securityItems.reduce(
    (sum, item) => sum + item.count,
    0
  );

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Overall status */}
      <div className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
        <div className={`h-4 w-4 rounded-full ${STATUS_BG[overall]}`} />
        <div>
          <h3 className="font-semibold text-sm text-zinc-200">
            Project Health
          </h3>
          <span className={`text-xs ${STATUS_COLOR[overall]} capitalize`}>
            {overall}
          </span>
        </div>
        {lastScanAt && (
          <span className="ml-auto text-[10px] text-zinc-600">
            Last scan: {new Date(lastScanAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* Test Coverage */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <span className="text-xs text-zinc-500">Test Coverage</span>
          <div className="mt-2 flex items-end gap-2">
            <span className="font-bold text-2xl text-zinc-100">
              {testCoverage}%
            </span>
            <span className="mb-0.5 text-xs text-zinc-500">
              {testsPassing}/{testsTotal} passing
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full ${(() => {
                if (testCoverage >= 80) {
                  return "bg-green-500";
                }
                if (testCoverage >= 60) {
                  return "bg-yellow-500";
                }
                return "bg-red-500";
              })()}`}
              style={{ width: `${testCoverage}%` }}
            />
          </div>
        </div>

        {/* Quality */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <span className="text-xs text-zinc-500">Quality Metrics</span>
          <div className="mt-2 flex flex-col gap-1.5">
            {qualityMetrics.map((metric) => (
              <div
                className="flex items-center justify-between"
                key={metric.label}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_BG[metric.status]}`}
                  />
                  <span className="text-xs text-zinc-400">{metric.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MiniTrend data={metric.trend} />
                  <span className={`text-xs ${STATUS_COLOR[metric.status]}`}>
                    {metric.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Security */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <span className="text-xs text-zinc-500">Security</span>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {totalSecurityIssues} issue{totalSecurityIssues === 1 ? "" : "s"}
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {securityItems.map((item) => (
              <div
                className="flex items-center justify-between"
                key={item.label}
              >
                <span className="text-xs text-zinc-400">{item.label}</span>
                <span className={`text-xs ${SEVERITY_COLOR[item.severity]}`}>
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export type {
  HealthStatus,
  ProjectHealthDashboardProps,
  QualityMetric,
  SecurityItem,
};
