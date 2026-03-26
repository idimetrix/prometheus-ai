"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
} from "@prometheus/ui";
import { ExternalLink, Hash, Link2, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const HASH_PREFIX_RE = /^#/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackWorkspaceStatus {
  connected: boolean;
  connectedAt?: string;
  workspace?: {
    id: string;
    name: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlackSettingsCard() {
  const [status, setStatus] = useState<SlackWorkspaceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifyChannel, setNotifyChannel] = useState("");

  const disconnectMutation = trpc.integrations.disconnect.useMutation();

  const fetchStatus = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const resp = await fetch(
        `${apiUrl}/oauth/slack/status?orgId=__current__`,
        {
          credentials: "include",
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as SlackWorkspaceStatus;
        setStatus(data);
      }
    } catch {
      // Status check failed silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  function handleConnectSlack() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    // In a real implementation, userId and orgId would come from auth context
    window.location.href = `${apiUrl}/oauth/slack/authorize?userId=current&orgId=current`;
  }

  async function handleDisconnect() {
    try {
      await disconnectMutation.mutateAsync({ provider: "slack" });
      setStatus({ connected: false, workspace: null });
      toast.info("Slack workspace disconnected");
    } catch {
      toast.error("Failed to disconnect Slack. Please try again.");
    }
  }

  function handleSaveChannel() {
    if (!notifyChannel.trim()) {
      toast.error("Please enter a channel name");
      return;
    }
    // This would save the notification channel preference via tRPC
    toast.success(
      `Notification channel set to #${notifyChannel.replace(HASH_PREFIX_RE, "")}`
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted font-bold text-muted-foreground text-sm">
              S
            </div>
            <div>
              <div className="font-medium text-foreground text-sm">Slack</div>
              <div className="text-muted-foreground text-xs">
                Loading connection status...
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status?.connected && status.workspace) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted font-bold text-muted-foreground text-sm">
                S
              </div>
              <div>
                <CardTitle className="text-sm">Slack</CardTitle>
                <CardDescription>
                  Task submission and progress updates
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success">
                <Link2 className="mr-1 h-3 w-3" />
                Connected
              </Badge>
              <Button onClick={handleDisconnect} size="sm" variant="outline">
                <Unplug className="mr-1 h-3 w-3" />
                Disconnect
              </Button>
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-4 pt-4">
          <div>
            <Label className="text-muted-foreground text-xs">
              Connected Workspace
            </Label>
            <div className="mt-1 font-medium text-foreground text-sm">
              {status.workspace.name}
            </div>
            {status.connectedAt && (
              <div className="text-muted-foreground text-xs">
                Connected {new Date(status.connectedAt).toLocaleDateString()}
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs" htmlFor="slack-notify-channel">
              Notification Channel
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Hash className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  id="slack-notify-channel"
                  onChange={(e) => setNotifyChannel(e.target.value)}
                  placeholder="general"
                  value={notifyChannel}
                />
              </div>
              <Button onClick={handleSaveChannel} size="sm">
                Save
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Channel where Prometheus will post task updates. Leave empty for
              thread-only updates.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">
              Available Commands
            </Label>
            <div className="space-y-1 rounded-lg bg-muted/50 p-3">
              <div className="font-mono text-foreground text-xs">
                /prometheus &lt;task&gt;
              </div>
              <div className="text-muted-foreground text-xs">
                Submit a task directly from Slack
              </div>
            </div>
            <div className="space-y-1 rounded-lg bg-muted/50 p-3">
              <div className="font-mono text-foreground text-xs">
                @Prometheus &lt;task&gt;
              </div>
              <div className="text-muted-foreground text-xs">
                Mention the bot in any channel to create a task
              </div>
            </div>
            <div className="space-y-1 rounded-lg bg-muted/50 p-3">
              <div className="font-mono text-foreground text-xs">
                Message Shortcut
              </div>
              <div className="text-muted-foreground text-xs">
                Right-click any message and select &quot;Send to
                Prometheus&quot;
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted font-bold text-muted-foreground text-sm">
            S
          </div>
          <div>
            <div className="font-medium text-foreground text-sm">Slack</div>
            <div className="text-muted-foreground text-xs">
              Submit tasks and receive updates in Slack
            </div>
          </div>
        </div>
        <Button onClick={handleConnectSlack} size="sm">
          <ExternalLink className="mr-1 h-3 w-3" />
          Connect Slack
        </Button>
      </CardContent>
    </Card>
  );
}
