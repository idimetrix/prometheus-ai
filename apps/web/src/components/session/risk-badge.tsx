"use client";

interface RiskBadgeProps {
  level: "low" | "medium" | "high" | "critical";
  size?: "sm" | "md";
}

const BADGE_STYLES: Record<string, string> = {
  low: "bg-green-500/10 text-green-400 border-green-500/30",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
};

export function RiskBadge({ level, size = "sm" }: RiskBadgeProps) {
  const sizeClass =
    size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2.5 py-1 text-sm";

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${BADGE_STYLES[level]} ${sizeClass}`}
    >
      {level}
    </span>
  );
}
