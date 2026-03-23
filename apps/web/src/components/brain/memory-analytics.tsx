"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryLayerStats {
  activeEntries: number;
  avgConfidence: number;
  decayedEntries: number;
  lastUpdated: string;
  name: string;
  totalEntries: number;
}

interface TopPattern {
  agentRole: string;
  confidence: number;
  occurrences: number;
  pattern: string;
  type: string;
}

interface MemoryAnalyticsData {
  decayRate: number;
  layers: MemoryLayerStats[];
  promotedCount: number;
  topPatterns: TopPattern[];
  totalMemories: number;
  utilizationPercent: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MemoryAnalyticsProps {
  apiBaseUrl?: string;
  projectId: string;
}

export function MemoryAnalytics({
  projectId,
  apiBaseUrl = "/api",
}: MemoryAnalyticsProps) {
  const [data, setData] = useState<MemoryAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(
        `${apiBaseUrl}/projects/${projectId}/memory/analytics`
      );
      if (!res.ok) {
        throw new Error(`HTTP ${String(res.status)}`);
      }
      const json = (await res.json()) as MemoryAnalyticsData;
      setData(json);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [projectId, apiBaseUrl]);

  useEffect(() => {
    fetchAnalytics().catch(() => undefined);
    const interval = setInterval(() => {
      fetchAnalytics().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center p-8 text-zinc-400">
        Loading memory analytics...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-red-400">
        Error loading memory analytics: {error}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard
          label="Total Memories"
          value={String(data.totalMemories)}
        />
        <SummaryCard
          label="Promoted Patterns"
          value={String(data.promotedCount)}
        />
        <SummaryCard
          label="Decay Rate"
          value={`${(data.decayRate * 100).toFixed(1)}%`}
        />
        <SummaryCard
          label="Utilization"
          value={`${data.utilizationPercent.toFixed(0)}%`}
        />
      </div>

      {/* Memory Layers */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-3 font-semibold text-sm text-zinc-300">
          Memory Layers
        </h3>
        <div className="space-y-3">
          {data.layers.map((layer) => (
            <LayerRow key={layer.name} layer={layer} />
          ))}
        </div>
      </div>

      {/* Top Patterns */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-3 font-semibold text-sm text-zinc-300">
          Top Patterns (Most Referenced)
        </h3>
        <div className="space-y-2">
          {data.topPatterns.map((pattern, idx) => (
            <PatternRow
              key={`${pattern.pattern}-${String(idx)}`}
              pattern={pattern}
            />
          ))}
          {data.topPatterns.length === 0 && (
            <p className="text-sm text-zinc-500">
              No patterns extracted yet. Run more sessions to build learnings.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="font-bold text-lg text-zinc-100">{value}</p>
    </div>
  );
}

function LayerRow({ layer }: { layer: MemoryLayerStats }) {
  const utilization =
    layer.totalEntries > 0
      ? (layer.activeEntries / layer.totalEntries) * 100
      : 0;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm text-zinc-200">
            {layer.name}
          </span>
          <span className="text-xs text-zinc-500">
            {layer.activeEntries}/{layer.totalEntries} active
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800">
          <div
            className="h-1.5 rounded-full bg-violet-500 transition-all"
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>
      </div>
      <div className="text-right">
        <span className="text-xs text-zinc-400">
          {(layer.avgConfidence * 100).toFixed(0)}% conf
        </span>
      </div>
    </div>
  );
}

function PatternRow({ pattern }: { pattern: TopPattern }) {
  const badgeColor = getTypeBadgeColor(pattern.type);

  return (
    <div className="flex items-start gap-2 rounded border border-zinc-800 p-2">
      <span
        className={`mt-0.5 inline-block rounded px-1.5 py-0.5 font-semibold text-[10px] uppercase ${badgeColor}`}
      >
        {pattern.type}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-300">{pattern.pattern}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {pattern.agentRole} &middot; {pattern.occurrences}x &middot;{" "}
          {(pattern.confidence * 100).toFixed(0)}% confidence
        </p>
      </div>
    </div>
  );
}

function getTypeBadgeColor(type: string): string {
  switch (type) {
    case "tool_pattern":
      return "bg-blue-900/50 text-blue-400";
    case "error_resolution":
      return "bg-red-900/50 text-red-400";
    case "quality_correlation":
      return "bg-green-900/50 text-green-400";
    case "iteration_insight":
      return "bg-amber-900/50 text-amber-400";
    default:
      return "bg-zinc-800 text-zinc-400";
  }
}
