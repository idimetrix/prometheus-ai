"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  action: string;
  details?: string;
  id: string;
  ipAddress?: string;
  resource: string;
  timestamp: string;
  userId: string;
  userName: string;
}

export interface AuditTrailProps {
  entries?: AuditEntry[];
  onExport?: (format: "csv" | "json") => void;
}

// ---------------------------------------------------------------------------
// AuditTrail
// ---------------------------------------------------------------------------

export function AuditTrail({ entries = [], onExport }: AuditTrailProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const actionTypes = useMemo(() => {
    const types = new Set(entries.map((e) => e.action));
    return ["all", ...Array.from(types).sort()];
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          entry.userName.toLowerCase().includes(q) ||
          entry.action.toLowerCase().includes(q) ||
          entry.resource.toLowerCase().includes(q) ||
          (entry.details?.toLowerCase().includes(q) ?? false);
        if (!matchesSearch) {
          return false;
        }
      }

      // Action filter
      if (actionFilter !== "all" && entry.action !== actionFilter) {
        return false;
      }

      // Date range filter
      if (dateFrom && entry.timestamp < dateFrom) {
        return false;
      }
      if (dateTo && entry.timestamp > dateTo) {
        return false;
      }

      return true;
    });
  }, [entries, searchQuery, actionFilter, dateFrom, dateTo]);

  const handleExport = useCallback(
    (format: "csv" | "json") => {
      onExport?.(format);
    },
    [onExport]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg text-zinc-100">Audit Trail</h2>
        <div className="flex gap-2">
          <button
            className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={() => handleExport("csv")}
            type="button"
          >
            Export CSV
          </button>
          <button
            className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={() => handleExport("json")}
            type="button"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          aria-label="Search audit entries"
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by user, action, resource..."
          type="text"
          value={searchQuery}
        />
        <select
          aria-label="Filter by action type"
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
          onChange={(e) => setActionFilter(e.target.value)}
          value={actionFilter}
        >
          {actionTypes.map((type) => (
            <option key={type} value={type}>
              {type === "all" ? "All Actions" : type}
            </option>
          ))}
        </select>
        <input
          aria-label="Filter from date"
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
          onChange={(e) => setDateFrom(e.target.value)}
          type="date"
          value={dateFrom}
        />
        <input
          aria-label="Filter to date"
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
          onChange={(e) => setDateTo(e.target.value)}
          type="date"
          value={dateTo}
        />
      </div>

      {/* Results count */}
      <p className="text-xs text-zinc-500">
        Showing {filteredEntries.length} of {entries.length} entries
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-zinc-800 border-b bg-zinc-900/50">
            <tr>
              <th className="px-4 py-2 font-medium text-zinc-400">Time</th>
              <th className="px-4 py-2 font-medium text-zinc-400">User</th>
              <th className="px-4 py-2 font-medium text-zinc-400">Action</th>
              <th className="px-4 py-2 font-medium text-zinc-400">Resource</th>
              <th className="px-4 py-2 font-medium text-zinc-400">Details</th>
              <th className="px-4 py-2 font-medium text-zinc-400">IP</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-zinc-500" colSpan={6}>
                  No matching audit entries
                </td>
              </tr>
            )}
            {filteredEntries.map((entry) => (
              <tr
                className="border-zinc-800/50 border-b last:border-b-0 hover:bg-zinc-900/30"
                key={entry.id}
              >
                <td className="whitespace-nowrap px-4 py-2 text-zinc-400">
                  {entry.timestamp}
                </td>
                <td className="px-4 py-2 text-zinc-200">{entry.userName}</td>
                <td className="px-4 py-2">
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                    {entry.action}
                  </span>
                </td>
                <td className="px-4 py-2 text-zinc-300">{entry.resource}</td>
                <td className="max-w-xs truncate px-4 py-2 text-zinc-500">
                  {entry.details ?? "-"}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                  {entry.ipAddress ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
