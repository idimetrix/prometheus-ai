"use client";

import { useDashboardStore } from "@/stores/dashboard.store";
import { useSessionStore } from "@/stores/session.store";

/**
 * Real-time credit balance display.
 * Reads from session events and dashboard store.
 */
export function CreditBalance() {
  const { events } = useSessionStore();
  const { creditBalance } = useDashboardStore();

  // Get the latest credit_update event if available
  const latestCreditEvent = [...events]
    .reverse()
    .find((e) => e.type === "credit_update");

  const balance = latestCreditEvent
    ? (latestCreditEvent.data.balance as number)
    : creditBalance;

  const sessionCost = latestCreditEvent
    ? ((latestCreditEvent.data.sessionCost as number) ?? 0)
    : 0;

  return (
    <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5">
      <svg
        className="h-3.5 w-3.5 text-yellow-500"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      </svg>
      <div className="flex items-baseline gap-1.5">
        <span className="font-medium text-xs text-zinc-200">
          {balance.toLocaleString()}
        </span>
        <span className="text-[10px] text-zinc-500">credits</span>
      </div>
      {sessionCost > 0 && (
        <span className="text-[10px] text-zinc-600">
          (-{sessionCost.toLocaleString()} this session)
        </span>
      )}
    </div>
  );
}
