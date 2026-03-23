"use client";

import { Badge, Card, CardContent } from "@prometheus/ui";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthMetric {
  /** Current value 0-100 */
  current: number;
  /** Machine-readable key */
  key: string;
  /** Display label */
  label: string;
}

export interface HealthHistoryPoint {
  date: string;
  score: number;
}

export interface HealthRecommendation {
  /** Action text, e.g. "Run security audit" */
  action: string;
  id: string;
  /** Impact level */
  impact: "high" | "medium" | "low";
  /** Metric key this relates to */
  metricKey: string;
}

interface ProjectHealthProps {
  /** Score history over time */
  history?: HealthHistoryPoint[];
  /** Health metrics across dimensions */
  metrics: HealthMetric[];
  /** Callback when a recommendation is clicked */
  onRecommendationClick?: (rec: HealthRecommendation) => void;
  /** Overall health score 0-100 */
  overallScore: number;
  /** Actionable recommendations */
  recommendations?: HealthRecommendation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 80) {
    return "text-green-400";
  }
  if (score >= 60) {
    return "text-amber-400";
  }
  return "text-red-400";
}

function scoreRingStroke(score: number): string {
  if (score >= 80) {
    return "stroke-green-500";
  }
  if (score >= 60) {
    return "stroke-amber-500";
  }
  return "stroke-red-500";
}

function scoreBg(score: number): string {
  if (score >= 80) {
    return "bg-green-500";
  }
  if (score >= 60) {
    return "bg-amber-500";
  }
  return "bg-red-500";
}

const IMPACT_STYLES: Record<string, { badge: string; label: string }> = {
  high: { badge: "bg-red-500/20 text-red-400", label: "High" },
  medium: { badge: "bg-amber-500/20 text-amber-400", label: "Medium" },
  low: { badge: "bg-blue-500/20 text-blue-400", label: "Low" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <svg aria-hidden="true" className="shrink-0" height={size} width={size}>
      <circle
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="#27272a"
        strokeWidth={8}
      />
      <circle
        className={`${scoreRingStroke(score)} transition-all duration-700`}
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth={8}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        className={`font-bold text-2xl ${scoreColor(score)}`}
        dominantBaseline="central"
        fill="currentColor"
        textAnchor="middle"
        x={size / 2}
        y={size / 2}
      >
        {score}
      </text>
    </svg>
  );
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">{label}</span>
        <span className={`font-mono text-xs ${scoreColor(value)}`}>
          {value}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${scoreBg(value)}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectHealth({
  overallScore,
  metrics,
  history = [],
  recommendations = [],
  onRecommendationClick,
}: ProjectHealthProps) {
  const [showAllRecs, setShowAllRecs] = useState(false);
  const displayedRecs = showAllRecs
    ? recommendations
    : recommendations.slice(0, 5);

  const radarData = useMemo(
    () =>
      metrics.map((m) => ({
        metric: m.label,
        value: m.current,
        fullMark: 100,
      })),
    [metrics]
  );

  return (
    <Card className="flex flex-col border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-4 py-3">
        <svg
          aria-hidden="true"
          className="h-4 w-4 text-violet-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h3 className="font-medium text-sm text-zinc-200">Project Health</h3>
      </div>

      <CardContent className="flex-1 overflow-auto p-4">
        {/* Top section: Score ring + metrics */}
        <div className="flex items-start gap-6">
          <div className="flex flex-col items-center gap-1">
            <ScoreRing score={overallScore} />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Health Score
            </span>
          </div>

          <div className="flex-1 space-y-2">
            {metrics.map((m) => (
              <MetricBar key={m.key} label={m.label} value={m.current} />
            ))}
          </div>
        </div>

        {/* Radar chart */}
        {metrics.length >= 3 && (
          <div className="mt-6">
            <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
              Health Radar
            </h4>
            <div className="h-56 w-full">
              <ResponsiveContainer height="100%" width="100%">
                <RadarChart data={radarData} outerRadius="75%">
                  <PolarGrid stroke="#27272a" />
                  <PolarAngleAxis
                    dataKey="metric"
                    fontSize={10}
                    tick={{ fill: "#71717a" }}
                  />
                  <Radar
                    dataKey="value"
                    fill="#8b5cf6"
                    fillOpacity={0.2}
                    name="Health"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      fontSize: "11px",
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* History chart */}
        {history.length > 0 && (
          <div className="mt-6">
            <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
              Score History
            </h4>
            <div className="h-40 w-full">
              <ResponsiveContainer height="100%" width="100%">
                <LineChart data={history}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    fontSize={10}
                    stroke="#52525b"
                    tick={{ fill: "#71717a" }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    fontSize={10}
                    stroke="#52525b"
                    tick={{ fill: "#71717a" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      fontSize: "11px",
                    }}
                  />
                  <Line
                    dataKey="score"
                    dot={false}
                    name="Health Score"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    type="monotone"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                Recommendations ({recommendations.length})
              </h4>
              {recommendations.length > 5 && (
                <button
                  className="text-[10px] text-violet-400 hover:text-violet-300"
                  onClick={() => setShowAllRecs((p) => !p)}
                  type="button"
                >
                  {showAllRecs ? "Show less" : "Show all"}
                </button>
              )}
            </div>
            <div className="space-y-1">
              {displayedRecs.map((rec) => {
                const impact = IMPACT_STYLES[rec.impact] ?? IMPACT_STYLES.low;
                return (
                  <button
                    className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-2 text-left transition-colors hover:bg-zinc-900"
                    key={rec.id}
                    onClick={() => onRecommendationClick?.(rec)}
                    type="button"
                  >
                    <span className="text-xs text-zinc-300">{rec.action}</span>
                    <Badge
                      className={`ml-auto shrink-0 ${impact?.badge}`}
                      variant="secondary"
                    >
                      {impact?.label}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
