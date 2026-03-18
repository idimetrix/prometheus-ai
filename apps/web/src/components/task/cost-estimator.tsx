"use client";

import { useMemo } from "react";

type Mode = "task" | "plan" | "ask" | "watch" | "fleet";

interface CostEstimatorProps {
  descriptionLength: number;
  mode: Mode;
}

const BASE_COSTS: Record<Mode, number> = {
  ask: 2,
  plan: 10,
  task: 5,
  watch: 3,
  fleet: 15,
};

function estimateCost(mode: Mode, descriptionLength: number): number {
  const base = BASE_COSTS[mode] ?? 5;
  // Longer descriptions imply more complex tasks
  if (mode === "task" || mode === "fleet") {
    const lengthMultiplier = Math.max(
      1,
      Math.floor(descriptionLength / 500) + 1
    );
    return base * lengthMultiplier;
  }
  return base;
}

function getCostColor(cost: number): {
  bg: string;
  text: string;
  label: string;
} {
  if (cost <= 5) {
    return { bg: "bg-green-500/10", text: "text-green-400", label: "Low" };
  }
  if (cost <= 15) {
    return {
      bg: "bg-yellow-500/10",
      text: "text-yellow-400",
      label: "Moderate",
    };
  }
  return { bg: "bg-red-500/10", text: "text-red-400", label: "High" };
}

export function CostEstimator({ mode, descriptionLength }: CostEstimatorProps) {
  const cost = useMemo(
    () => estimateCost(mode, descriptionLength),
    [mode, descriptionLength]
  );

  const color = useMemo(() => getCostColor(cost), [cost]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <svg
          aria-hidden="true"
          className="h-4 w-4 text-yellow-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
        </svg>
        <span className="font-medium text-sm text-zinc-300">
          ~{cost} credits
        </span>
      </div>
      <span
        className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${color.bg} ${color.text}`}
      >
        {color.label}
      </span>
    </div>
  );
}
