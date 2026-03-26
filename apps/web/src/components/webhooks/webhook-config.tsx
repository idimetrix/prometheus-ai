"use client";

import { Badge, Button, Card, CardContent, Input } from "@prometheus/ui";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookSubscription {
  /** Creation timestamp */
  createdAt: string;
  /** Optional description */
  description?: string;
  /** Whether the webhook is active */
  enabled: boolean;
  /** Events this webhook listens to */
  events: string[];
  /** Number of consecutive failures */
  failureCount: number;
  /** Unique ID */
  id: string;
  /** Last successful delivery */
  lastDeliveredAt?: string;
  /** Endpoint URL */
  url: string;
}

export interface WebhookDelivery {
  /** Attempt number */
  attempt: number;
  /** When the delivery was made */
  deliveredAt: string;
  /** Event type delivered */
  event: string;
  /** Delivery ID */
  id: string;
  /** HTTP status code of the delivery */
  statusCode: number | null;
  /** Whether delivery was successful */
  success: boolean;
}

interface WebhookConfigProps {
  /** Available event types */
  availableEvents: Array<{ name: string; category: string }>;
  /** Delivery history for the selected webhook */
  deliveries?: WebhookDelivery[];
  /** Callback to create a new webhook */
  onCreate?: (data: {
    url: string;
    events: string[];
    description?: string;
  }) => void;
  /** Callback to delete a webhook */
  onDelete?: (id: string) => void;
  /** Callback to redeliver a failed delivery */
  onRedeliver?: (deliveryId: string) => void;
  /** Callback to select a webhook to view deliveries */
  onSelect?: (id: string) => void;
  /** Callback to test a webhook */
  onTest?: (id: string) => void;
  /** Callback to toggle a webhook's enabled state */
  onToggle?: (id: string, enabled: boolean) => void;
  /** Callback to update a webhook */
  onUpdate?: (
    id: string,
    data: { url?: string; events?: string[]; description?: string }
  ) => void;
  /** Currently selected webhook ID */
  selectedId?: string;
  /** Configured webhook subscriptions */
  subscriptions: WebhookSubscription[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusColor(code: number | null): string {
  if (!code) {
    return "text-zinc-500";
  }
  if (code >= 200 && code < 300) {
    return "text-green-400";
  }
  if (code >= 400 && code < 500) {
    return "text-amber-400";
  }
  return "text-red-400";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AddWebhookForm({
  availableEvents,
  onCreate,
}: {
  availableEvents: Array<{ name: string; category: string }>;
  onCreate?: WebhookConfigProps["onCreate"];
}) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());

  const categories = useMemo(() => {
    const cats = new Map<string, string[]>();
    for (const evt of availableEvents) {
      const list = cats.get(evt.category) ?? [];
      list.push(evt.name);
      cats.set(evt.category, list);
    }
    return cats;
  }, [availableEvents]);

  const toggleEvent = useCallback((name: string) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (!url || selectedEvents.size === 0) {
      return;
    }
    onCreate?.({
      url,
      events: [...selectedEvents],
      description: description || undefined,
    });
    setUrl("");
    setDescription("");
    setSelectedEvents(new Set());
  }, [url, selectedEvents, description, onCreate]);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h4 className="font-medium text-xs text-zinc-300">Add Webhook</h4>

      <div>
        <label
          className="mb-1 block text-[10px] text-zinc-500"
          htmlFor="webhook-url"
        >
          Endpoint URL
        </label>
        <Input
          className="h-8 bg-zinc-950 text-xs"
          id="webhook-url"
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          value={url}
        />
      </div>

      <div>
        <label
          className="mb-1 block text-[10px] text-zinc-500"
          htmlFor="webhook-desc"
        >
          Description (optional)
        </label>
        <Input
          className="h-8 bg-zinc-950 text-xs"
          id="webhook-desc"
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Notify on deployments"
          value={description}
        />
      </div>

      <div>
        <span className="mb-1 block text-[10px] text-zinc-500">Events</span>
        <div className="space-y-2">
          {[...categories.entries()].map(([category, events]) => (
            <div key={category}>
              <span className="font-semibold text-[9px] text-zinc-600 uppercase">
                {category}
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {events.map((evt) => (
                  <button
                    className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                      selectedEvents.has(evt)
                        ? "border-violet-500 bg-violet-500/20 text-violet-300"
                        : "border-zinc-700 text-zinc-500 hover:border-zinc-600"
                    }`}
                    key={evt}
                    onClick={() => toggleEvent(evt)}
                    type="button"
                  >
                    {evt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Button
        className="w-full text-xs"
        disabled={!url || selectedEvents.size === 0}
        onClick={handleSubmit}
        size="sm"
      >
        Create Webhook
      </Button>
    </div>
  );
}

function DeliveryLog({
  deliveries,
  onRedeliver,
}: {
  deliveries: WebhookDelivery[];
  onRedeliver?: (deliveryId: string) => void;
}) {
  if (deliveries.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-zinc-600">
        No deliveries yet
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {deliveries.map((d) => (
        <div
          className="flex items-center gap-2 rounded bg-zinc-900/50 px-3 py-2"
          key={d.id}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              d.success ? "bg-green-400" : "bg-red-400"
            }`}
          />
          <span className="font-mono text-[10px] text-zinc-400">{d.event}</span>
          <span
            className={`font-mono text-[10px] ${statusColor(d.statusCode)}`}
          >
            {d.statusCode ?? "---"}
          </span>
          <span className="text-[10px] text-zinc-600">#{d.attempt}</span>
          <span className="ml-auto text-[10px] text-zinc-600">
            {formatDate(d.deliveredAt)}
          </span>
          {!d.success && onRedeliver && (
            <button
              className="rounded px-1.5 py-0.5 text-[9px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              onClick={() => onRedeliver(d.id)}
              type="button"
            >
              Retry
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WebhookConfig({
  subscriptions,
  availableEvents,
  deliveries = [],
  selectedId,
  onCreate,
  onUpdate: _onUpdate,
  onDelete,
  onTest,
  onToggle,
  onSelect,
  onRedeliver,
}: WebhookConfigProps) {
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <Card className="flex h-full flex-col border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm text-zinc-200">Webhooks</h3>
          <Badge className="bg-zinc-800 text-zinc-500" variant="secondary">
            {subscriptions.length}
          </Badge>
        </div>
        <Button
          className="text-xs"
          onClick={() => setShowAddForm((p) => !p)}
          size="sm"
          variant="ghost"
        >
          {showAddForm ? "Cancel" : "Add Webhook"}
        </Button>
      </div>

      <CardContent className="flex-1 overflow-auto p-4">
        <div className="space-y-4">
          {/* Add form */}
          {showAddForm && (
            <AddWebhookForm
              availableEvents={availableEvents}
              onCreate={(data) => {
                onCreate?.(data);
                setShowAddForm(false);
              }}
            />
          )}

          {/* Webhook list */}
          {subscriptions.length === 0 && !showAddForm ? (
            <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
              No webhooks configured
            </div>
          ) : (
            subscriptions.map((sub) => (
              <div
                className={`rounded-lg border p-3 transition-colors ${
                  selectedId === sub.id
                    ? "border-violet-500/30 bg-violet-500/5"
                    : "border-zinc-800 hover:border-zinc-700"
                }`}
                key={sub.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <button
                      className="truncate font-mono text-xs text-zinc-300 hover:text-zinc-100"
                      onClick={() => onSelect?.(sub.id)}
                      type="button"
                    >
                      {sub.url}
                    </button>
                    {sub.description && (
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        {sub.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {sub.events.map((evt) => (
                        <Badge
                          className="bg-zinc-800 text-[9px] text-zinc-500"
                          key={evt}
                          variant="secondary"
                        >
                          {evt}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {/* Toggle */}
                    <button
                      className={`rounded px-2 py-0.5 text-[9px] transition-colors ${
                        sub.enabled
                          ? "bg-green-500/20 text-green-400"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                      onClick={() => onToggle?.(sub.id, !sub.enabled)}
                      type="button"
                    >
                      {sub.enabled ? "Active" : "Inactive"}
                    </button>
                    <button
                      className="rounded px-2 py-0.5 text-[9px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                      onClick={() => onTest?.(sub.id)}
                      type="button"
                    >
                      Test
                    </button>
                    <button
                      className="rounded px-2 py-0.5 text-[9px] text-red-500/70 hover:bg-red-500/10 hover:text-red-400"
                      onClick={() => onDelete?.(sub.id)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {sub.failureCount > 0 && (
                  <div className="mt-1 text-[10px] text-amber-500">
                    {sub.failureCount} consecutive failure
                    {sub.failureCount > 1 ? "s" : ""}
                  </div>
                )}

                {/* Delivery log for selected webhook */}
                {selectedId === sub.id && (
                  <div className="mt-3 border-zinc-800 border-t pt-3">
                    <h5 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                      Recent Deliveries
                    </h5>
                    <DeliveryLog
                      deliveries={deliveries}
                      onRedeliver={onRedeliver}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
