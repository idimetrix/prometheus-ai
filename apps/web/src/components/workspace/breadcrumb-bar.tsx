"use client";

import { useSessionStore } from "@/stores/session.store";

interface BreadcrumbSegment {
  active: boolean;
  label: string;
}

function ChevronSeparator() {
  return <span className="text-zinc-700">/</span>;
}

export function BreadcrumbBar() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeFilePath = useSessionStore((s) => s.activeFilePath);
  const agents = useSessionStore((s) => s.agents);

  const activeAgent = agents.find((a) => a.status === "working");

  const segments: BreadcrumbSegment[] = [{ label: "Project", active: true }];

  if (activeSessionId) {
    segments.push({
      label: activeSessionId.slice(0, 8),
      active: true,
    });
  }

  if (activeAgent) {
    segments.push({
      label: activeAgent.role,
      active: true,
    });
  }

  if (activeFilePath) {
    const fileName = activeFilePath.split("/").pop() ?? activeFilePath;
    segments.push({
      label: fileName,
      active: true,
    });
  }

  return (
    <div className="flex items-center gap-1.5 border-zinc-800 border-b bg-zinc-900/30 px-3 py-1.5">
      {segments.map((segment, idx) => (
        <div className="flex items-center gap-1.5" key={segment.label}>
          {idx > 0 && <ChevronSeparator />}
          <button
            className={`border-0 bg-transparent p-0 text-xs transition-colors ${
              idx === segments.length - 1
                ? "text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            type="button"
          >
            {segment.label}
          </button>
        </div>
      ))}
    </div>
  );
}
