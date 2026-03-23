"use client";

import { Badge, Button, Input } from "@prometheus/ui";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Filter,
  RefreshCw,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type WebhookProvider = "github" | "jira" | "slack" | "custom";
export type WebhookDirection = "inbound" | "outbound";
export type WebhookStatus = "success" | "failed" | "pending";

export interface WebhookEvent {
  direction: WebhookDirection;
  eventType: string;
  id: string;
  payload: Record<string, unknown>;
  provider: WebhookProvider;
  requestHeaders?: Record<string, string>;
  responseBody?: string;
  responseCode?: number;
  responseTimeMs: number;
  status: WebhookStatus;
  timestamp: string;
}

interface EventLogProps {
  events: WebhookEvent[];
  onExportCsv?: () => void;
  onRetry?: (eventId: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PROVIDER_COLORS: Record<WebhookProvider, string> = {
  github: "bg-zinc-700 text-zinc-200",
  jira: "bg-blue-500/20 text-blue-300",
  slack: "bg-purple-500/20 text-purple-300",
  custom: "bg-zinc-600 text-zinc-300",
};

const STATUS_CONFIG: Record<
  WebhookStatus,
  { color: string; icon: typeof CheckCircle2; label: string }
> = {
  success: {
    label: "Success",
    color: "text-emerald-400",
    icon: CheckCircle2,
  },
  failed: { label: "Failed", color: "text-red-400", icon: AlertCircle },
  pending: { label: "Pending", color: "text-amber-400", icon: Clock },
};

const ALL_PROVIDERS: WebhookProvider[] = ["github", "jira", "slack", "custom"];
const ALL_STATUSES: WebhookStatus[] = ["success", "failed", "pending"];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatResponseTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncatePayload(payload: Record<string, unknown>): string {
  const str = JSON.stringify(payload);
  if (str.length <= 120) {
    return str;
  }
  return `${str.slice(0, 120)}...`;
}

function matchesEventSearch(event: WebhookEvent, query: string): boolean {
  if (!query.trim()) {
    return true;
  }
  const q = query.toLowerCase();
  return (
    event.eventType.toLowerCase().includes(q) ||
    event.provider.toLowerCase().includes(q) ||
    JSON.stringify(event.payload).toLowerCase().includes(q)
  );
}

function matchesEventDateRange(
  event: WebhookEvent,
  dateFrom: string,
  dateTo: string
): boolean {
  if (dateFrom) {
    const fromDate = new Date(dateFrom);
    if (new Date(event.timestamp) < fromDate) {
      return false;
    }
  }
  if (dateTo) {
    const toDate = new Date(dateTo);
    toDate.setDate(toDate.getDate() + 1);
    if (new Date(event.timestamp) >= toDate) {
      return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function EventLog({ events, onRetry, onExportCsv }: EventLogProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [providerFilter, setProviderFilter] = useState<Set<WebhookProvider>>(
    () => new Set(ALL_PROVIDERS)
  );
  const [statusFilter, setStatusFilter] = useState<Set<WebhookStatus>>(
    () => new Set(ALL_STATUSES)
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Filter events
  const filteredEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          providerFilter.has(event.provider) &&
          statusFilter.has(event.status) &&
          matchesEventSearch(event, searchQuery) &&
          matchesEventDateRange(event, dateFrom, dateTo)
      ),
    [events, providerFilter, statusFilter, searchQuery, dateFrom, dateTo]
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleProvider = useCallback((provider: WebhookProvider) => {
    setProviderFilter((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  }, []);

  const toggleStatus = useCallback((status: WebhookStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  // Stats
  const stats = useMemo(() => {
    const total = events.length;
    const successCount = events.filter((e) => e.status === "success").length;
    const failedCount = events.filter((e) => e.status === "failed").length;
    const avgResponseTime =
      events.length > 0
        ? Math.round(
            events.reduce((sum, e) => sum + e.responseTimeMs, 0) / events.length
          )
        : 0;
    return { total, successCount, failedCount, avgResponseTime };
  }, [events]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header */}
      <div className="border-zinc-800 border-b px-6 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg text-zinc-100">
              Webhook Event Log
            </h2>
            <p className="text-sm text-zinc-500">
              Real-time log of inbound and outbound webhook events
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowFilters(!showFilters)}
              size="sm"
              variant="outline"
            >
              <Filter className="mr-1 h-3 w-3" />
              Filters
            </Button>
            {onExportCsv && (
              <Button onClick={onExportCsv} size="sm" variant="outline">
                <Download className="mr-1 h-3 w-3" />
                Export CSV
              </Button>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex gap-4 text-xs">
          <span className="text-zinc-500">
            Total: <span className="text-zinc-300">{stats.total}</span>
          </span>
          <span className="text-zinc-500">
            Success:{" "}
            <span className="text-emerald-400">{stats.successCount}</span>
          </span>
          <span className="text-zinc-500">
            Failed: <span className="text-red-400">{stats.failedCount}</span>
          </span>
          <span className="text-zinc-500">
            Avg Response:{" "}
            <span className="text-zinc-300">
              {formatResponseTime(stats.avgResponseTime)}
            </span>
          </span>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="border-zinc-800 border-b bg-zinc-900/30 px-6 py-3">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="w-64">
              <Input
                className="h-8 bg-zinc-900 text-sm"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearchQuery(e.target.value)
                }
                placeholder="Search events..."
                value={searchQuery}
              />
            </div>

            {/* Provider filter */}
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[10px] text-zinc-500 uppercase">
                Provider:
              </span>
              {ALL_PROVIDERS.map((provider) => (
                <button
                  className={[
                    "rounded px-2 py-0.5 text-[10px] capitalize transition-colors",
                    providerFilter.has(provider)
                      ? PROVIDER_COLORS[provider]
                      : "bg-zinc-800 text-zinc-600",
                  ].join(" ")}
                  key={provider}
                  onClick={() => toggleProvider(provider)}
                  type="button"
                >
                  {provider}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[10px] text-zinc-500 uppercase">
                Status:
              </span>
              {ALL_STATUSES.map((status) => (
                <button
                  className={[
                    "rounded px-2 py-0.5 text-[10px] capitalize transition-colors",
                    statusFilter.has(status)
                      ? "bg-zinc-700 text-zinc-200"
                      : "bg-zinc-800 text-zinc-600",
                  ].join(" ")}
                  key={status}
                  onClick={() => toggleStatus(status)}
                  type="button"
                >
                  {status}
                </button>
              ))}
            </div>

            {/* Date range */}
            <div className="flex items-center gap-1">
              <span className="mr-1 text-[10px] text-zinc-500 uppercase">
                Date:
              </span>
              <input
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300"
                onChange={(e) => setDateFrom(e.target.value)}
                type="date"
                value={dateFrom}
              />
              <span className="text-zinc-600">-</span>
              <input
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300"
                onChange={(e) => setDateTo(e.target.value)}
                type="date"
                value={dateTo}
              />
            </div>
          </div>
        </div>
      )}

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {filteredEvents.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            No events match the current filters.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {filteredEvents.map((event) => {
              const isExpanded = expandedIds.has(event.id);
              const statusConfig = STATUS_CONFIG[event.status];
              const StatusIcon = statusConfig.icon;

              return (
                <div key={event.id}>
                  {/* Row summary */}
                  <button
                    className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-zinc-900/50"
                    onClick={() => toggleExpanded(event.id)}
                    type="button"
                  >
                    {/* Expand chevron */}
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                    )}

                    {/* Status icon */}
                    <StatusIcon
                      className={`h-4 w-4 shrink-0 ${statusConfig.color}`}
                    />

                    {/* Timestamp */}
                    <span className="w-44 shrink-0 font-mono text-[11px] text-zinc-500">
                      {new Date(event.timestamp).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>

                    {/* Direction */}
                    <Badge
                      className={
                        event.direction === "inbound"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-blue-500/10 text-blue-400"
                      }
                    >
                      {event.direction}
                    </Badge>

                    {/* Provider */}
                    <Badge className={PROVIDER_COLORS[event.provider]}>
                      {event.provider}
                    </Badge>

                    {/* Event type */}
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                      {event.eventType}
                    </span>

                    {/* Payload preview */}
                    <span className="hidden max-w-xs truncate font-mono text-[10px] text-zinc-600 xl:block">
                      {truncatePayload(event.payload)}
                    </span>

                    {/* Response time */}
                    <span className="w-16 shrink-0 text-right font-mono text-[11px] text-zinc-500">
                      {formatResponseTime(event.responseTimeMs)}
                    </span>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-zinc-800/50 border-t bg-zinc-900/20 px-6 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        {/* Request payload */}
                        <div>
                          <p className="mb-1 font-medium text-xs text-zinc-400">
                            Request Payload
                          </p>
                          <pre className="max-h-60 overflow-auto rounded-lg bg-zinc-900 p-3 font-mono text-[11px] text-zinc-400">
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        </div>

                        {/* Response */}
                        <div>
                          <p className="mb-1 font-medium text-xs text-zinc-400">
                            Response
                          </p>
                          <div className="rounded-lg bg-zinc-900 p-3">
                            {event.responseCode !== undefined && (
                              <div className="mb-2 flex items-center gap-2">
                                <span className="text-xs text-zinc-500">
                                  Status:
                                </span>
                                <Badge
                                  className={
                                    event.responseCode < 400
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : "bg-red-500/20 text-red-300"
                                  }
                                >
                                  {event.responseCode}
                                </Badge>
                              </div>
                            )}
                            {event.responseBody && (
                              <pre className="max-h-40 overflow-auto font-mono text-[11px] text-zinc-400">
                                {event.responseBody}
                              </pre>
                            )}
                            {!event.responseBody && (
                              <span className="text-xs text-zinc-600">
                                No response body
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Request headers */}
                      {event.requestHeaders && (
                        <div className="mt-3">
                          <p className="mb-1 font-medium text-xs text-zinc-400">
                            Headers
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(event.requestHeaders).map(
                              ([key, value]) => (
                                <Badge
                                  className="bg-zinc-800 font-mono text-[10px] text-zinc-400"
                                  key={key}
                                >
                                  {key}: {value}
                                </Badge>
                              )
                            )}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      {event.status === "failed" && onRetry && (
                        <div className="mt-3 border-zinc-800 border-t pt-3">
                          <Button
                            onClick={() => onRetry(event.id)}
                            size="sm"
                            variant="outline"
                          >
                            <RefreshCw className="mr-1 h-3 w-3" />
                            Retry Webhook
                          </Button>
                        </div>
                      )}
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
