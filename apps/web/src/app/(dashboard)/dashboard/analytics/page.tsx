"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const overviewQuery = trpc.stats.overview.useQuery(
    { days },
    { retry: false },
  );
  const taskMetricsQuery = trpc.stats.taskMetrics.useQuery(
    { days, groupBy: "day" },
    { retry: false },
  );
  const modelUsageQuery = trpc.stats.modelUsage.useQuery(
    { days },
    { retry: false },
  );
  const roiQuery = trpc.stats.roi.useQuery(undefined, { retry: false });

  const overview = overviewQuery.data;
  const taskMetrics = taskMetricsQuery.data?.dataPoints ?? [];
  const modelUsage = modelUsageQuery.data?.byModel ?? [];
  const roi = roiQuery.data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Track your usage, costs, and productivity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                days === d
                  ? "bg-violet-600 text-white"
                  : "border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Overview stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
              <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-zinc-500">Tasks Completed</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-zinc-100">
            {overview?.tasksCompleted ?? 0}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            in the last {days} days
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10">
              <svg className="h-4 w-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-zinc-500">Credits Used</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-zinc-100">
            {overview?.creditsUsed?.toLocaleString() ?? 0}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            in the last {days} days
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
              <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75Z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-zinc-500">Success Rate</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-zinc-100">
            {overview?.successRate
              ? `${(overview.successRate * 100).toFixed(1)}%`
              : "--"}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            task completion rate
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
              <svg className="h-4 w-4 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
              </svg>
            </div>
            <span className="text-xs font-medium text-zinc-500">ROI</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-zinc-100">
            {roi?.roiMultiplier ? `${roi.roiMultiplier}x` : "--"}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {roi?.estimatedHoursSaved
              ? `${roi.estimatedHoursSaved}h saved`
              : "No data yet"}
          </div>
        </div>
      </div>

      {/* ROI summary */}
      {roi && (roi.estimatedValueUsd > 0 || roi.estimatedHoursSaved > 0) && (
        <div className="rounded-xl border border-violet-800/30 bg-violet-950/20 p-6">
          <h3 className="text-sm font-semibold text-violet-300">
            Return on Investment
          </h3>
          <div className="mt-4 grid gap-6 md:grid-cols-4">
            <div>
              <div className="text-xs text-zinc-500">Hours Saved</div>
              <div className="mt-1 text-2xl font-bold text-zinc-100">
                {roi.estimatedHoursSaved}h
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Estimated Value</div>
              <div className="mt-1 text-2xl font-bold text-green-400">
                ${roi.estimatedValueUsd.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Credits Cost</div>
              <div className="mt-1 text-2xl font-bold text-zinc-100">
                {roi.creditsCost}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">ROI Multiplier</div>
              <div className="mt-1 text-2xl font-bold text-violet-400">
                {roi.roiMultiplier}x
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task completion table */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-zinc-200">
          Task History
        </h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
          {taskMetrics.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              No task data yet. Complete tasks to see metrics here.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium text-right">
                    Completed
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Failed</th>
                  <th className="px-4 py-3 font-medium text-right">Credits</th>
                  <th className="px-4 py-3 font-medium">Success</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {taskMetrics.map((dp, i) => {
                  const total = dp.completed + dp.failed;
                  const rate =
                    total > 0
                      ? ((dp.completed / total) * 100).toFixed(0)
                      : "--";
                  return (
                    <tr key={i} className="text-sm">
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">
                        {new Date(dp.date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-right text-green-400">
                        {dp.completed}
                      </td>
                      <td className="px-4 py-2.5 text-right text-red-400">
                        {dp.failed}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">
                        {dp.credits}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-zinc-800">
                            <div
                              className="h-1.5 rounded-full bg-green-500"
                              style={{
                                width: `${total > 0 ? (dp.completed / total) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs text-zinc-500">
                            {rate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Model usage breakdown */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-zinc-200">
          Model Usage
        </h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
          {modelUsage.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              No model usage data yet.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium text-right">Requests</th>
                  <th className="px-4 py-3 font-medium text-right">Tokens</th>
                  <th className="px-4 py-3 font-medium text-right">Cost</th>
                  <th className="px-4 py-3 font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {modelUsage.map((model) => {
                  const totalModelTokens = modelUsage.reduce(
                    (s, m) => s + m.tokens,
                    0,
                  );
                  const share =
                    totalModelTokens > 0
                      ? (model.tokens / totalModelTokens) * 100
                      : 0;
                  return (
                    <tr key={model.model} className="text-sm">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-zinc-300">
                          {model.model}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-400">
                        {model.requests.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">
                        {model.tokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">
                        ${model.cost.toFixed(4)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-zinc-800">
                            <div
                              className="h-1.5 rounded-full bg-violet-500"
                              style={{ width: `${share}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs text-zinc-500">
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
