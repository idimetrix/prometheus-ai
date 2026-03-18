"use client";

import { useState } from "react";
import type { SessionEvent } from "@/stores/session.store";

interface ReasoningProps {
  event: SessionEvent;
}

export function Reasoning({ event }: ReasoningProps) {
  const [expanded, setExpanded] = useState(false);
  const content =
    (event.data.content as string) ?? (event.data.thought as string) ?? "";

  // Show preview (first 120 chars) when collapsed
  const preview =
    content.length > 120 ? `${content.slice(0, 120)}...` : content;

  return (
    <div className="rounded-lg border border-violet-800/30 bg-violet-950/10 p-3">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20">
          <svg
            aria-hidden="true"
            className="h-3 w-3 text-violet-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="font-medium text-violet-400 text-xs">Thinking</span>
        <svg
          aria-hidden="true"
          className={`ml-auto h-3 w-3 text-zinc-500 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="m19.5 8.25-7.5 7.5-7.5-7.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div
        className={`mt-2 overflow-hidden transition-all duration-200 ${
          expanded ? "max-h-96" : "max-h-12"
        }`}
      >
        <div className="text-violet-300/70 text-xs italic leading-relaxed">
          {expanded ? content : preview}
        </div>
      </div>

      {event.timestamp && (
        <div className="mt-1 text-[10px] text-zinc-600">
          {new Date(event.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </div>
      )}
    </div>
  );
}
