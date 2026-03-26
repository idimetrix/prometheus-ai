"use client";

import { Badge, Button, Input } from "@prometheus/ui";
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";

interface WebhookManagerProps {
  projectId?: string;
}

/* -------------------------------------------------------------------------- */
/*  Delivery list (extracted to reduce cognitive complexity)                    */
/* -------------------------------------------------------------------------- */

interface DeliveryListProps {
  deliveries: Array<{
    attempt: number;
    deliveredAt: Date | string;
    event: string;
    id: string;
    statusCode: number | string | null;
    success: boolean;
  }>;
  isLoading: boolean;
  onRedeliver: (deliveryId: string) => void;
}

function DeliveryList({
  deliveries,
  isLoading,
  onRedeliver,
}: DeliveryListProps) {
  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  if (deliveries.length === 0) {
    return <p className="text-muted-foreground text-xs">No deliveries yet.</p>;
  }
  return (
    <div className="space-y-1">
      {deliveries.map((d) => (
        <div
          className="flex items-center justify-between py-1 text-xs"
          key={d.id}
        >
          <div className="flex items-center gap-2">
            {d.success ? (
              <CheckCircle className="h-3 w-3 text-green-500" />
            ) : (
              <AlertCircle className="h-3 w-3 text-destructive" />
            )}
            <span className="font-mono">{d.event}</span>
            <span className="text-muted-foreground">
              {d.statusCode ?? "N/A"}
            </span>
            <span className="text-muted-foreground">Attempt {d.attempt}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {new Date(d.deliveredAt).toLocaleString()}
            </span>
            {!d.success && (
              <button
                className="text-primary hover:underline"
                onClick={() => onRedeliver(d.id)}
                type="button"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Subscriptions list (extracted to reduce cognitive complexity)               */
/* -------------------------------------------------------------------------- */

function SubscriptionsList({
  isLoading,
  children,
  isEmpty,
}: {
  children: ReactNode;
  isEmpty: boolean;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No webhook subscriptions configured.
      </div>
    );
  }
  return <>{children}</>;
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function WebhookManager({ projectId: _projectId }: WebhookManagerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [expandedSub, setExpandedSub] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const subsQuery = trpc.webhooks.list.useQuery();
  const eventsQuery = trpc.webhooks.availableEvents.useQuery();
  const deliveriesQuery = trpc.webhooks.getDeliveries.useQuery(
    { subscriptionId: expandedSub ?? "", limit: 20 },
    { enabled: !!expandedSub }
  );

  const createMutation = trpc.webhooks.create.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      setShowCreate(false);
      setNewUrl("");
      setNewDescription("");
      setSelectedEvents([]);
    },
  });

  const deleteMutation = trpc.webhooks.delete.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
    },
  });

  const testMutation = trpc.webhooks.test.useMutation({
    onSuccess: () => {
      if (expandedSub) {
        utils.webhooks.getDeliveries.invalidate({
          subscriptionId: expandedSub,
        });
      }
    },
  });

  const redeliverMutation = trpc.webhooks.redeliver.useMutation({
    onSuccess: () => {
      if (expandedSub) {
        utils.webhooks.getDeliveries.invalidate({
          subscriptionId: expandedSub,
        });
      }
    },
  });

  const updateMutation = trpc.webhooks.update.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
    },
  });

  const toggleEvent = useCallback((event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }, []);

  const handleCreate = useCallback(() => {
    if (!newUrl || selectedEvents.length === 0) {
      return;
    }
    createMutation.mutate({
      url: newUrl,
      // biome-ignore lint/suspicious/noExplicitAny: event names come from the server
      events: selectedEvents as any,
      description: newDescription || undefined,
    });
  }, [newUrl, selectedEvents, newDescription, createMutation]);

  const copySecret = useCallback((secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(secret);
    setTimeout(() => setCopiedSecret(null), 2000);
  }, []);

  const handleRedeliver = useCallback(
    (deliveryId: string) => {
      redeliverMutation.mutate({ deliveryId });
    },
    [redeliverMutation]
  );

  const subscriptions = subsQuery.data?.subscriptions ?? [];
  const availableEvents = eventsQuery.data?.events ?? [];
  const deliveries = deliveriesQuery.data?.deliveries ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Webhook Subscriptions</h3>
          <p className="text-muted-foreground text-sm">
            Receive HTTP callbacks when events occur in your workspace.
          </p>
        </div>
        <Button
          disabled={createMutation.isPending}
          onClick={() => setShowCreate(!showCreate)}
          size="sm"
        >
          <Plus className="mr-1 h-4 w-4" />
          Add Webhook
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <label className="font-medium text-sm" htmlFor="webhook-url">
              Endpoint URL
            </label>
            <Input
              id="webhook-url"
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/webhooks/prometheus"
              value={newUrl}
            />
          </div>
          <div>
            <label className="font-medium text-sm" htmlFor="webhook-desc">
              Description (optional)
            </label>
            <Input
              id="webhook-desc"
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="CI pipeline notifications"
              value={newDescription}
            />
          </div>
          <div>
            <span className="font-medium text-sm">Events</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {availableEvents.map((event) => (
                <button
                  className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                    selectedEvents.includes(event.name)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary"
                  }`}
                  key={event.name}
                  onClick={() => toggleEvent(event.name)}
                  type="button"
                >
                  {event.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={
                !newUrl ||
                selectedEvents.length === 0 ||
                createMutation.isPending
              }
              onClick={handleCreate}
              size="sm"
            >
              {createMutation.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Create Webhook
            </Button>
            <Button
              onClick={() => setShowCreate(false)}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>

          {/* Show secret after creation */}
          {createMutation.data?.secret && (
            <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3">
              <p className="font-medium text-sm text-yellow-600">
                Signing Secret (save this now -- it will not be shown again):
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="break-all text-xs">
                  {createMutation.data.secret}
                </code>
                <button
                  aria-label="Copy secret"
                  onClick={() => copySecret(createMutation.data.secret)}
                  type="button"
                >
                  <Copy className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
                {copiedSecret === createMutation.data.secret && (
                  <span className="text-green-600 text-xs">Copied</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subscriptions list */}
      <SubscriptionsList
        isEmpty={subscriptions.length === 0}
        isLoading={subsQuery.isLoading}
      >
        <div className="space-y-3">
          {subscriptions.map((sub) => (
            <div className="rounded-lg border" key={sub.id}>
              <div className="flex items-center justify-between p-4">
                <div className="flex min-w-0 items-center gap-3">
                  {sub.failureCount >= 10 ? (
                    <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                  ) : (
                    <CheckCircle
                      className={`h-5 w-5 shrink-0 ${sub.enabled ? "text-green-500" : "text-muted-foreground"}`}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{sub.url}</p>
                    {sub.description && (
                      <p className="text-muted-foreground text-xs">
                        {sub.description}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(sub.events as string[]).map((event) => (
                        <Badge
                          className="text-[10px]"
                          key={event}
                          variant="secondary"
                        >
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="ml-2 flex shrink-0 items-center gap-1">
                  <Badge
                    className="text-[10px]"
                    variant={sub.enabled ? "default" : "secondary"}
                  >
                    {sub.enabled ? "Active" : "Disabled"}
                  </Badge>
                  {sub.failureCount > 0 && (
                    <Badge className="text-[10px]" variant="destructive">
                      {sub.failureCount} failures
                    </Badge>
                  )}
                  <Button
                    disabled={testMutation.isPending}
                    onClick={() => testMutation.mutate({ id: sub.id })}
                    size="sm"
                    title="Send test webhook"
                    variant="ghost"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    disabled={updateMutation.isPending}
                    onClick={() =>
                      updateMutation.mutate({
                        id: sub.id,
                        enabled: !sub.enabled,
                      })
                    }
                    size="sm"
                    title={sub.enabled ? "Disable" : "Enable"}
                    variant="ghost"
                  >
                    {sub.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    onClick={() =>
                      setExpandedSub(expandedSub === sub.id ? null : sub.id)
                    }
                    size="sm"
                    title="View deliveries"
                    variant="ghost"
                  >
                    Deliveries
                  </Button>
                  <Button
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate({ id: sub.id })}
                    size="sm"
                    title="Delete webhook"
                    variant="ghost"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              {/* Delivery history */}
              {expandedSub === sub.id && (
                <div className="border-t px-4 py-3">
                  <h4 className="mb-2 font-medium text-sm">
                    Recent Deliveries
                  </h4>
                  <DeliveryList
                    deliveries={deliveries}
                    isLoading={deliveriesQuery.isLoading}
                    onRedeliver={handleRedeliver}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </SubscriptionsList>
    </div>
  );
}
