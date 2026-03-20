"use client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfidenceGaugeProps {
  iteration: number;
  maxIterations: number;
  score: number; // 0-1
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GAUGE_RADIUS = 40;
const GAUGE_STROKE = 6;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

// Arc spans 270 degrees (3/4 of full circle)
const ARC_FRACTION = 0.75;
const ARC_LENGTH = GAUGE_CIRCUMFERENCE * ARC_FRACTION;

// SVG viewBox center
const CENTER = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGaugeColor(score: number): { stroke: string; text: string } {
  if (score > 0.7) {
    return { stroke: "stroke-green-500", text: "text-green-400" };
  }
  if (score >= 0.4) {
    return { stroke: "stroke-yellow-500", text: "text-yellow-400" };
  }
  return { stroke: "stroke-red-500", text: "text-red-400" };
}

function getGaugeBgColor(score: number): string {
  if (score > 0.7) {
    return "bg-green-500/10";
  }
  if (score >= 0.4) {
    return "bg-yellow-500/10";
  }
  return "bg-red-500/10";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfidenceGauge({
  score,
  iteration,
  maxIterations,
}: ConfidenceGaugeProps) {
  const clampedScore = Math.max(0, Math.min(1, score));
  const percentage = Math.round(clampedScore * 100);
  const filledLength = ARC_LENGTH * clampedScore;
  const dashOffset = ARC_LENGTH - filledLength;
  const colors = getGaugeColor(clampedScore);
  const bgColor = getGaugeBgColor(clampedScore);

  return (
    <div className={`flex flex-col items-center rounded-lg p-3 ${bgColor}`}>
      <div className="relative h-24 w-24">
        <svg className="-rotate-[225deg]" viewBox="0 0 100 100">
          <title>Confidence gauge</title>
          {/* Background arc */}
          <circle
            className="stroke-zinc-800"
            cx={CENTER}
            cy={CENTER}
            fill="none"
            r={GAUGE_RADIUS}
            strokeDasharray={`${ARC_LENGTH} ${GAUGE_CIRCUMFERENCE}`}
            strokeLinecap="round"
            strokeWidth={GAUGE_STROKE}
          />
          {/* Filled arc */}
          <circle
            className={`transition-all duration-500 ${colors.stroke}`}
            cx={CENTER}
            cy={CENTER}
            fill="none"
            r={GAUGE_RADIUS}
            strokeDasharray={`${ARC_LENGTH} ${GAUGE_CIRCUMFERENCE}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth={GAUGE_STROKE}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-bold text-lg ${colors.text}`}>
            {percentage}%
          </span>
        </div>
      </div>

      {/* Iteration counter */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[10px] text-zinc-500">Iteration</span>
        <span className="font-mono text-xs text-zinc-300">
          {iteration}
          <span className="text-zinc-600">/{maxIterations}</span>
        </span>
      </div>

      {/* Iteration progress dots */}
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: maxIterations }, (_, i) => (
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              i < iteration ? "bg-zinc-400" : "bg-zinc-800"
            }`}
            key={`iter-${String(i)}`}
          />
        ))}
      </div>
    </div>
  );
}

export type { ConfidenceGaugeProps };
