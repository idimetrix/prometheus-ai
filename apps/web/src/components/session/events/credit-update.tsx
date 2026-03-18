"use client";

import type { SessionEvent } from "@/stores/session.store";

interface CreditUpdateProps {
  event: SessionEvent;
}

export function CreditUpdate({ event }: CreditUpdateProps) {
  const balance = (event.data.balance as number) ?? 0;
  const used = (event.data.used as number) ?? 0;
  const sessionCost = (event.data.sessionCost as number) ?? 0;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500/10">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-yellow-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
        </svg>
      </div>
      <div className="flex flex-1 items-center gap-4">
        <div>
          <div className="font-medium text-xs text-zinc-200">
            {balance.toLocaleString()} credits
          </div>
          <div className="text-[10px] text-zinc-500">remaining</div>
        </div>
        {used > 0 && (
          <div>
            <div className="font-medium text-red-400 text-xs">
              -{used.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">used</div>
          </div>
        )}
        {sessionCost > 0 && (
          <div>
            <div className="font-medium text-xs text-zinc-400">
              {sessionCost.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">session total</div>
          </div>
        )}
      </div>
      {event.timestamp && (
        <span className="shrink-0 text-[10px] text-zinc-600">
          {new Date(event.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
