"use client";

interface BenchmarkRun {
  avgScore: number;
  date: string;
  passRate: number;
  suiteId: string;
  tasks: number;
  totalCredits: number;
}

const MOCK_RUNS: BenchmarkRun[] = [
  {
    suiteId: "bench_01j8x9k2m3",
    date: "2026-03-18T14:32:00Z",
    passRate: 87.5,
    avgScore: 0.82,
    totalCredits: 245.6,
    tasks: 24,
  },
  {
    suiteId: "bench_01j7w8h1n4",
    date: "2026-03-17T09:15:00Z",
    passRate: 79.2,
    avgScore: 0.76,
    totalCredits: 198.3,
    tasks: 24,
  },
  {
    suiteId: "bench_01j6v7g0p5",
    date: "2026-03-15T18:45:00Z",
    passRate: 91.7,
    avgScore: 0.89,
    totalCredits: 312.1,
    tasks: 36,
  },
  {
    suiteId: "bench_01j5u6f9q6",
    date: "2026-03-14T11:20:00Z",
    passRate: 66.7,
    avgScore: 0.64,
    totalCredits: 156.8,
    tasks: 18,
  },
  {
    suiteId: "bench_01j4t5e8r7",
    date: "2026-03-12T16:50:00Z",
    passRate: 83.3,
    avgScore: 0.78,
    totalCredits: 278.4,
    tasks: 30,
  },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPassRateColor(rate: number): string {
  if (rate >= 90) {
    return "text-green-400";
  }
  if (rate >= 75) {
    return "text-yellow-400";
  }
  return "text-red-400";
}

export default function BenchmarksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-zinc-100">
          Benchmark Results
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Track agent performance across standardized benchmark suites.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-zinc-800 border-b text-zinc-400">
              <th className="px-4 py-3 font-medium">Suite ID</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 text-right font-medium">Pass Rate %</th>
              <th className="px-4 py-3 text-right font-medium">Avg Score</th>
              <th className="px-4 py-3 text-right font-medium">
                Total Credits
              </th>
              <th className="px-4 py-3 text-right font-medium">Tasks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {MOCK_RUNS.map((run) => (
              <tr
                className="text-zinc-300 transition-colors hover:bg-zinc-800/50"
                key={run.suiteId}
              >
                <td className="px-4 py-3 font-mono text-xs text-zinc-100">
                  {run.suiteId}
                </td>
                <td className="px-4 py-3 text-zinc-400">
                  {formatDate(run.date)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-medium ${getPassRateColor(run.passRate)}`}
                >
                  {run.passRate.toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {run.avgScore.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right text-zinc-400">
                  ${run.totalCredits.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right text-zinc-400">
                  {run.tasks}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
