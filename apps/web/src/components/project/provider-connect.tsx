"use client";

import { Button } from "@prometheus/ui";
import { CheckCircle, ExternalLink, Loader2, Unplug } from "lucide-react";
import { trpc } from "@/lib/trpc";

const PROVIDERS = [
  {
    id: "github" as const,
    name: "GitHub",
    scopes: "repo, read:org",
  },
  {
    id: "gitlab" as const,
    name: "GitLab",
    scopes: "api, read_repository",
  },
  {
    id: "bitbucket" as const,
    name: "BitBucket",
    scopes: "repository, pullrequest",
  },
] as const;

type Provider = (typeof PROVIDERS)[number]["id"];

interface ProviderConnectProps {
  onProviderConnected?: (provider: Provider) => void;
  onSelectProvider?: (provider: Provider) => void;
  selectedProvider?: Provider | null;
}

export function ProviderConnect({
  onProviderConnected,
  selectedProvider,
  onSelectProvider,
}: ProviderConnectProps) {
  const statusQuery = trpc.integrations.oauthStatus.useQuery(undefined, {
    retry: 2,
  });
  const disconnectMutation = trpc.integrations.oauthDisconnect.useMutation({
    onSuccess: () => {
      statusQuery.refetch();
    },
  });

  const providers = statusQuery.data?.providers ?? [];

  function handleConnect(provider: Provider) {
    const apiUrl =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1")
        ? `${window.location.protocol}//${window.location.hostname}:4000`
        : "";

    // Redirect to OAuth authorize endpoint
    // userId and orgId will be derived from the session on the API side
    // For now, we pass them as query params from the client context
    window.location.href = `${apiUrl}/oauth/${provider}/authorize?userId=current&orgId=current`;
  }

  function handleDisconnect(provider: Provider) {
    disconnectMutation.mutate({ provider });
  }

  if (statusQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground text-sm">
          Loading providers...
        </span>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {PROVIDERS.map((p) => {
        const status = providers.find((s) => s.provider === p.id);
        const isConnected = status?.connected ?? false;
        const isSelected = selectedProvider === p.id;

        return (
          <div
            className={`rounded-xl border p-4 transition-all ${(() => {
              if (isSelected) {
                return "border-primary bg-primary/10 ring-1 ring-primary/30";
              }
              if (isConnected) {
                return "border-green-500/30 bg-green-500/5";
              }
              return "border-border bg-card";
            })()}`}
            key={p.id}
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-foreground text-sm">
                {p.name}
              </div>
              {isConnected && (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
            </div>
            <div className="mt-1 text-muted-foreground text-xs">
              {isConnected
                ? `Connected as ${status?.providerUsername ?? "user"}`
                : `Scopes: ${p.scopes}`}
            </div>
            <div className="mt-3 flex gap-2">
              {isConnected ? (
                <>
                  <Button
                    className="flex-1"
                    onClick={() => {
                      onSelectProvider?.(p.id);
                      onProviderConnected?.(p.id);
                    }}
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                  >
                    {isSelected ? "Selected" : "Select"}
                  </Button>
                  <Button
                    onClick={() => handleDisconnect(p.id)}
                    size="sm"
                    variant="ghost"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => handleConnect(p.id)}
                  size="sm"
                  variant="outline"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Connect
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
