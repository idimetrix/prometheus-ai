"use client";

import { useState } from "react";
import { useSessionStore } from "@/stores/session.store";

export function ReasoningPanel() {
  const { reasoning } = useSessionStore();
  const [collapsedMap, setCollapsedMap] = useState<Record<number, boolean>>({});

  const toggle = (index: number) => {
    setCollapsedMap((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const collapseAll = () => {
    const map: Record<number, boolean> = {};
    reasoning.forEach((_, i) => {
      map[i] = true;
    });
    setCollapsedMap(map);
  };

  const expandAll = () => {
    setCollapsedMap({});
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-violet-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Reasoning</span>
        <span className="ml-auto flex items-center gap-1">
          <button
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400"
            onClick={collapseAll}
            type="button"
          >
            Collapse all
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400"
            onClick={expandAll}
            type="button"
          >
            Expand all
          </button>
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {reasoning.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No reasoning captured yet
          </div>
        ) : (
          <div className="space-y-1">
            {reasoning.map((thought, i) => {
              const isCollapsed = collapsedMap[i] ?? false;
              const preview =
                thought.slice(0, 80) + (thought.length > 80 ? "..." : "");
              return (
                <div
                  className="rounded-lg border border-zinc-800/50 bg-zinc-950/50"
                  key={i}
                >
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    onClick={() => toggle(i)}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${
                        isCollapsed ? "" : "rotate-90"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="m8.25 4.5 7.5 7.5-7.5 7.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="font-medium text-[10px] text-violet-400/70">
                      Step {i + 1}
                    </span>
                    {isCollapsed && (
                      <span className="truncate text-[10px] text-zinc-600">
                        {preview}
                      </span>
                    )}
                  </button>
                  {!isCollapsed && (
                    <div className="border-zinc-800/50 border-t px-3 py-2">
                      <p className="whitespace-pre-wrap text-xs text-zinc-400 italic leading-relaxed">
                        {thought}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
