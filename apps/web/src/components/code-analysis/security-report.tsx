"use client";

import { useMemo, useState } from "react";

export type VulnerabilitySeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

export interface SecurityFinding {
  description: string;
  filePath: string;
  fixSuggestion?: string;
  id: string;
  line?: number;
  ruleId?: string;
  severity: VulnerabilitySeverity;
}

interface SecurityReportProps {
  findings: SecurityFinding[];
  onFindingClick?: (finding: SecurityFinding) => void;
}

const SEVERITY_ORDER: VulnerabilitySeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

const SEVERITY_STYLES: Record<
  VulnerabilitySeverity,
  { badge: string; bg: string; border: string; dot: string; text: string }
> = {
  critical: {
    badge: "bg-red-600/20 text-red-400 border-red-500/30",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    dot: "bg-red-500",
    text: "text-red-400",
  },
  high: {
    badge: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    dot: "bg-orange-500",
    text: "text-orange-400",
  },
  medium: {
    badge: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    dot: "bg-amber-500",
    text: "text-amber-400",
  },
  low: {
    badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    dot: "bg-blue-500",
    text: "text-blue-400",
  },
  info: {
    badge: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/30",
    dot: "bg-zinc-500",
    text: "text-zinc-400",
  },
};

function SeverityCounter({
  count,
  severity,
}: {
  count: number;
  severity: VulnerabilitySeverity;
}) {
  const styles = SEVERITY_STYLES[severity];
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2 ${styles.bg} ${styles.border}`}
    >
      <span className={`font-bold font-mono text-lg ${styles.text}`}>
        {count}
      </span>
      <span className="text-[9px] text-zinc-500 uppercase tracking-wider">
        {severity}
      </span>
    </div>
  );
}

function FindingCard({
  finding,
  onClick,
}: {
  finding: SecurityFinding;
  onClick?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const styles = SEVERITY_STYLES[finding.severity];

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg}`}>
      <button
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        onClick={() => {
          setExpanded((prev) => !prev);
          onClick?.();
        }}
        type="button"
      >
        <span
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${styles.dot}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 font-medium text-[9px] ${styles.badge}`}
            >
              {finding.severity}
            </span>
            {finding.ruleId && (
              <span className="font-mono text-[10px] text-zinc-500">
                {finding.ruleId}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-300">{finding.description}</p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
            {finding.filePath}
            {finding.line !== undefined && `:${finding.line}`}
          </p>
        </div>
        <svg
          className={`mt-1 h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <title>Toggle details</title>
          <path
            d="M19 9l-7 7-7-7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {expanded && finding.fixSuggestion && (
        <div className="border-zinc-800 border-t px-3 py-2.5">
          <h5 className="mb-1 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Fix Suggestion
          </h5>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {finding.fixSuggestion}
          </p>
        </div>
      )}
    </div>
  );
}

export function SecurityReport({
  findings,
  onFindingClick,
}: SecurityReportProps) {
  const [filterSeverity, setFilterSeverity] = useState<
    VulnerabilitySeverity | "all"
  >("all");

  const countsBySeverity = useMemo(() => {
    const counts: Record<VulnerabilitySeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const f of findings) {
      counts[f.severity]++;
    }
    return counts;
  }, [findings]);

  const filteredFindings = useMemo(() => {
    const sorted = [...findings].sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    );
    if (filterSeverity === "all") {
      return sorted;
    }
    return sorted.filter((f) => f.severity === filterSeverity);
  }, [findings, filterSeverity]);

  const totalCount = findings.length;
  const criticalHighCount = countsBySeverity.critical + countsBySeverity.high;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-zinc-200">Security Report</h3>
        <div className="flex items-center gap-2">
          {criticalHighCount > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-medium text-[10px] text-red-400">
              {criticalHighCount} critical/high
            </span>
          )}
          <span className="font-mono text-xs text-zinc-500">
            {totalCount} finding{totalCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Severity Counters */}
      <div className="grid grid-cols-5 gap-2">
        {SEVERITY_ORDER.map((sev) => (
          <SeverityCounter
            count={countsBySeverity[sev]}
            key={sev}
            severity={sev}
          />
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          Filter
        </span>
        <button
          className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
            filterSeverity === "all"
              ? "bg-violet-500/20 text-violet-400"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          onClick={() => setFilterSeverity("all")}
          type="button"
        >
          All
        </button>
        {SEVERITY_ORDER.map((sev) => {
          const styles = SEVERITY_STYLES[sev];
          return (
            <button
              className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                filterSeverity === sev
                  ? `${styles.badge}`
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={sev}
              onClick={() => setFilterSeverity(sev)}
              type="button"
            >
              {sev} ({countsBySeverity[sev]})
            </button>
          );
        })}
      </div>

      {/* Findings List */}
      {filteredFindings.length === 0 ? (
        <div className="py-6 text-center text-xs text-zinc-600">
          {filterSeverity === "all"
            ? "No security findings"
            : `No ${filterSeverity} findings`}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredFindings.map((finding) => (
            <FindingCard
              finding={finding}
              key={finding.id}
              onClick={() => onFindingClick?.(finding)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
