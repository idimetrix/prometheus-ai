"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ─── Benchmark data — updated after each SWE-bench/HumanEval run ─────────────

// Prometheus scores pending — remove from comparison until benchmarks complete
const SWE_BENCH_DATA = [
  { name: "Devin", score: 13.86, fill: "#6366f1" },
  { name: "Claude Code", score: 49.0, fill: "#06b6d4" },
  { name: "Codex (GPT-5.3)", score: 69.0, fill: "#10b981" },
];

const HUMAN_EVAL_DATA = [
  { name: "Devin", score: 75.0, fill: "#6366f1" },
  { name: "Claude Code", score: 92.0, fill: "#06b6d4" },
  { name: "Codex (GPT-5.3)", score: 87.1, fill: "#10b981" },
];

const COMPARISON_ROWS = [
  {
    metric: "SWE-bench Verified",
    prometheus: "TBD",
    devin: "13.86%",
    claudeCode: "49.0%",
    codex: "TBD",
  },
  {
    metric: "HumanEval",
    prometheus: "TBD",
    devin: "TBD",
    claudeCode: "92.0%",
    codex: "87.1%",
  },
  {
    metric: "Multi-file Edits",
    prometheus: "TBD",
    devin: "Yes",
    claudeCode: "Yes",
    codex: "Yes",
  },
  {
    metric: "Parallel Agents",
    prometheus: "Up to 100",
    devin: "1",
    claudeCode: "1",
    codex: "Up to 5",
  },
  {
    metric: "Self-hosted Option",
    prometheus: "Yes",
    devin: "No",
    claudeCode: "No",
    codex: "No",
  },
  {
    metric: "Multi-model Support",
    prometheus: "Yes (6+ providers)",
    devin: "Proprietary",
    claudeCode: "Claude only",
    codex: "GPT only",
  },
  {
    metric: "Project Memory",
    prometheus: "6-layer brain",
    devin: "Basic",
    claudeCode: "Session-based",
    codex: "Session-based",
  },
];

// ─── Chart component ─────────────────────────────────────────────────────────

function BenchmarkChart({
  title,
  data,
  unit,
}: {
  title: string;
  data: Array<{ name: string; score: number; fill: string }>;
  unit: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h3 className="mb-4 font-semibold text-lg text-zinc-200">{title}</h3>
      <ResponsiveContainer height={300} width="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fontSize: 12 }} />
          <YAxis stroke="#a1a1aa" tick={{ fontSize: 12 }} unit={unit} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "0.5rem",
              color: "#e4e4e7",
            }}
          />
          <Bar dataKey="score" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function BenchmarksPage() {
  const [_tab, setTab] = useState<"charts" | "table">("charts");

  return (
    <div className="py-24">
      <div className="mx-auto max-w-5xl px-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-bold text-4xl text-zinc-100">
            Competitive Benchmarks
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-500">
            How Prometheus compares to other AI coding agents on industry
            benchmarks.
          </p>
          <div className="mt-4 inline-flex rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-2 text-amber-400 text-sm">
            Results coming soon — benchmarks are in progress
          </div>
        </div>

        {/* Tab switcher */}
        <div className="mt-12 flex justify-center gap-2">
          <button
            className={`rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
              _tab === "charts"
                ? "bg-violet-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => setTab("charts")}
            type="button"
          >
            Charts
          </button>
          <button
            className={`rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
              _tab === "table"
                ? "bg-violet-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => setTab("table")}
            type="button"
          >
            Comparison Table
          </button>
        </div>

        {/* Charts view */}
        {_tab === "charts" && (
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <BenchmarkChart
              data={SWE_BENCH_DATA}
              title="SWE-bench Verified"
              unit="%"
            />
            <BenchmarkChart data={HUMAN_EVAL_DATA} title="HumanEval" unit="%" />
          </div>
        )}

        {/* Table view */}
        {_tab === "table" && (
          <div className="mt-10 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-zinc-800 border-b bg-zinc-900/80">
                  <th className="px-4 py-3 font-semibold text-zinc-300">
                    Metric
                  </th>
                  <th className="px-4 py-3 font-semibold text-violet-400">
                    Prometheus
                  </th>
                  <th className="px-4 py-3 font-semibold text-zinc-300">
                    Devin
                  </th>
                  <th className="px-4 py-3 font-semibold text-zinc-300">
                    Claude Code
                  </th>
                  <th className="px-4 py-3 font-semibold text-zinc-300">
                    Codex
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr
                    className="border-zinc-800/50 border-b last:border-0"
                    key={row.metric}
                  >
                    <td className="px-4 py-3 font-medium text-zinc-400">
                      {row.metric}
                    </td>
                    <td className="px-4 py-3 text-violet-300">
                      {row.prometheus}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{row.devin}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {row.claudeCode}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{row.codex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
