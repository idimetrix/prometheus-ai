"use client";

import { useMemo, useState } from "react";

export interface FileHealthMetric {
  label: string;
  maxValue?: number;
  value: number;
}

export interface FileDependency {
  direction: "imports" | "imported-by";
  id: string;
  name: string;
}

export interface AnalysisSuggestion {
  category: "refactor" | "performance" | "testing" | "style" | "security";
  description: string;
  id: string;
  line?: number;
  priority: "high" | "medium" | "low";
}

interface AnalysisPanelProps {
  dependencies?: FileDependency[];
  filePath?: string;
  metrics?: FileHealthMetric[];
  onSuggestionClick?: (suggestion: AnalysisSuggestion) => void;
  suggestions?: AnalysisSuggestion[];
}

type TabId = "metrics" | "dependencies" | "suggestions";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "metrics", label: "Health" },
  { id: "dependencies", label: "Deps" },
  { id: "suggestions", label: "Suggestions" },
];

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-500/20 text-red-400",
  medium: "bg-amber-500/20 text-amber-400",
  low: "bg-green-500/20 text-green-400",
};

const CATEGORY_STYLES: Record<string, string> = {
  refactor: "bg-violet-500/20 text-violet-400",
  performance: "bg-cyan-500/20 text-cyan-400",
  testing: "bg-green-500/20 text-green-400",
  style: "bg-blue-500/20 text-blue-400",
  security: "bg-red-500/20 text-red-400",
};

function metricBarColor(pct: number): string {
  if (pct >= 80) {
    return "bg-green-500";
  }
  if (pct >= 50) {
    return "bg-amber-500";
  }
  return "bg-red-500";
}

function metricTextColor(pct: number): string {
  if (pct >= 80) {
    return "text-green-400";
  }
  if (pct >= 50) {
    return "text-amber-400";
  }
  return "text-red-400";
}

function MetricsTab({ metrics }: { metrics: FileHealthMetric[] }) {
  if (metrics.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-zinc-600">
        No metrics available
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      {metrics.map((metric) => {
        const max = metric.maxValue ?? 100;
        const pct = Math.round((metric.value / max) * 100);
        const color = metricBarColor(pct);
        const textColor = metricTextColor(pct);

        return (
          <div
            className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5"
            key={metric.label}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">{metric.label}</span>
              <span className={`font-bold font-mono text-xs ${textColor}`}>
                {metric.value}
                {max !== 100 && <span className="text-zinc-600">/{max}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-all ${color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DependenciesTab({ dependencies }: { dependencies: FileDependency[] }) {
  const imports = useMemo(
    () => dependencies.filter((d) => d.direction === "imports"),
    [dependencies]
  );
  const importedBy = useMemo(
    () => dependencies.filter((d) => d.direction === "imported-by"),
    [dependencies]
  );

  if (dependencies.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-zinc-600">
        No dependencies found
      </div>
    );
  }

  return (
    <div className="space-y-3 p-2">
      {/* Imports */}
      <div>
        <h5 className="mb-1 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
          Imports ({imports.length})
        </h5>
        {imports.length === 0 ? (
          <p className="text-[10px] text-zinc-600">None</p>
        ) : (
          <div className="space-y-0.5">
            {imports.map((dep) => (
              <div
                className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1"
                key={dep.id}
              >
                <span className="text-[10px] text-amber-500">{"\u2192"}</span>
                <span className="truncate font-mono text-[11px] text-zinc-300">
                  {dep.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Imported By */}
      <div>
        <h5 className="mb-1 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
          Imported By ({importedBy.length})
        </h5>
        {importedBy.length === 0 ? (
          <p className="text-[10px] text-zinc-600">None</p>
        ) : (
          <div className="space-y-0.5">
            {importedBy.map((dep) => (
              <div
                className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1"
                key={dep.id}
              >
                <span className="text-[10px] text-green-500">{"\u2190"}</span>
                <span className="truncate font-mono text-[11px] text-zinc-300">
                  {dep.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Simple graph visualization */}
      <div>
        <h5 className="mb-1 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
          Graph
        </h5>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: dependency graph visualization */}
          <svg className="w-full" height={120} role="img">
            {/* Imports on left */}
            {imports.slice(0, 4).map((dep, i) => {
              const y = 15 + i * 25;
              return (
                <g key={dep.id}>
                  <text
                    className="text-[9px]"
                    dominantBaseline="middle"
                    fill="#a1a1aa"
                    textAnchor="end"
                    x={80}
                    y={y}
                  >
                    {dep.name.length > 12
                      ? `${dep.name.slice(0, 10)}..`
                      : dep.name}
                  </text>
                  <line
                    stroke="#52525b"
                    strokeWidth={1}
                    x1={85}
                    x2={145}
                    y1={y}
                    y2={60}
                  />
                </g>
              );
            })}
            {/* Center node */}
            <rect
              fill="#8b5cf6"
              fillOpacity={0.2}
              height={24}
              rx={4}
              stroke="#8b5cf6"
              strokeOpacity={0.5}
              width={50}
              x={145}
              y={48}
            />
            <text
              className="font-medium text-[9px]"
              dominantBaseline="middle"
              fill="#c4b5fd"
              textAnchor="middle"
              x={170}
              y={60}
            >
              file
            </text>
            {/* Imported-by on right */}
            {importedBy.slice(0, 4).map((dep, i) => {
              const y = 15 + i * 25;
              return (
                <g key={dep.id}>
                  <line
                    stroke="#52525b"
                    strokeWidth={1}
                    x1={195}
                    x2={255}
                    y1={60}
                    y2={y}
                  />
                  <text
                    className="text-[9px]"
                    dominantBaseline="middle"
                    fill="#a1a1aa"
                    x={260}
                    y={y}
                  >
                    {dep.name.length > 12
                      ? `${dep.name.slice(0, 10)}..`
                      : dep.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

function SuggestionsTab({
  suggestions,
  onSuggestionClick,
}: {
  onSuggestionClick?: (suggestion: AnalysisSuggestion) => void;
  suggestions: AnalysisSuggestion[];
}) {
  if (suggestions.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-zinc-600">
        No suggestions
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {suggestions.map((suggestion) => {
        const priorityStyle =
          PRIORITY_STYLES[suggestion.priority] ?? PRIORITY_STYLES.medium;
        const categoryStyle =
          CATEGORY_STYLES[suggestion.category] ?? CATEGORY_STYLES.style;

        return (
          <button
            className="flex w-full items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-2 text-left transition-colors hover:bg-zinc-900"
            key={suggestion.id}
            onClick={() => onSuggestionClick?.(suggestion)}
            type="button"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[9px] ${categoryStyle}`}
                >
                  {suggestion.category}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[9px] ${priorityStyle}`}
                >
                  {suggestion.priority}
                </span>
                {suggestion.line !== undefined && (
                  <span className="font-mono text-[10px] text-zinc-600">
                    L{suggestion.line}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
                {suggestion.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function AnalysisPanel({
  filePath,
  metrics = [],
  dependencies = [],
  suggestions = [],
  onSuggestionClick,
}: AnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("metrics");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          Analysis
        </h3>
        {filePath && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">
            {filePath}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-zinc-800 border-b">
        {TABS.map((tab) => {
          const tabCounts: Record<TabId, number> = {
            metrics: metrics.length,
            dependencies: dependencies.length,
            suggestions: suggestions.length,
          };
          const count = tabCounts[tab.id];
          return (
            <button
              className={`flex-1 px-3 py-1.5 text-xs transition-colors ${
                activeTab === tab.id
                  ? "border-violet-500 border-b-2 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
              {count > 0 && (
                <span className="ml-1 text-[10px] text-zinc-600">
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "metrics" && <MetricsTab metrics={metrics} />}
        {activeTab === "dependencies" && (
          <DependenciesTab dependencies={dependencies} />
        )}
        {activeTab === "suggestions" && (
          <SuggestionsTab
            onSuggestionClick={onSuggestionClick}
            suggestions={suggestions}
          />
        )}
      </div>
    </div>
  );
}
