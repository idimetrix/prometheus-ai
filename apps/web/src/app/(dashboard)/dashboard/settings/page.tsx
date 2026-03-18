"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const TABS = [
  { id: "general", label: "General" },
  { id: "integrations", label: "Integrations" },
  { id: "apikeys", label: "API Keys" },
  { id: "billing", label: "Billing" },
  { id: "models", label: "Models" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const INTEGRATION_PROVIDERS = [
  { id: "github", name: "GitHub", desc: "Repository hosting and CI/CD" },
  { id: "gitlab", name: "GitLab", desc: "Repository hosting and CI/CD" },
  { id: "linear", name: "Linear", desc: "Issue tracking" },
  { id: "jira", name: "Jira", desc: "Project management" },
  { id: "slack", name: "Slack", desc: "Team notifications" },
  { id: "vercel", name: "Vercel", desc: "Frontend deployment" },
  { id: "figma", name: "Figma", desc: "Design files" },
  { id: "notion", name: "Notion", desc: "Documentation" },
] as const;

const MODEL_PROVIDERS = [
  {
    provider: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-4-20250514", "claude-3.5-haiku"],
  },
  { provider: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini"] },
  {
    provider: "google",
    name: "Google",
    models: ["gemini-2.0-flash", "gemini-2.0-pro"],
  },
  { provider: "groq", name: "Groq", models: ["llama-3.3-70b", "mixtral-8x7b"] },
  { provider: "cerebras", name: "Cerebras", models: ["llama-3.3-70b"] },
  {
    provider: "ollama",
    name: "Ollama (Local)",
    models: ["llama3.2", "codestral"],
  },
];

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: inherent domain complexity
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [_showKeyDialog, _setShowKeyDialog] = useState(false);

  // Queries
  const apiKeysQuery = trpc.settings.getApiKeys.useQuery(undefined, {
    retry: false,
  });
  const integrationsQuery = trpc.integrations.list.useQuery(undefined, {
    retry: false,
  });
  const modelPrefsQuery = trpc.settings.getModelPreferences.useQuery(
    undefined,
    { retry: false }
  );
  const balanceQuery = trpc.billing.getBalance.useQuery(undefined, {
    retry: false,
  });
  const planQuery = trpc.billing.getPlan.useQuery(undefined, { retry: false });
  const transactionsQuery = trpc.billing.getTransactions.useQuery(
    { limit: 20 },
    { retry: false }
  );
  const profileQuery = trpc.user.profile.useQuery(undefined, { retry: false });

  // Mutations
  const createKeyMutation = trpc.settings.createApiKey.useMutation();
  const revokeKeyMutation = trpc.settings.revokeApiKey.useMutation();
  const connectIntMutation = trpc.integrations.connect.useMutation();
  const disconnectIntMutation = trpc.integrations.disconnect.useMutation();
  const setModelPrefMutation = trpc.settings.setModelPreference.useMutation();
  const createCheckoutMutation = trpc.billing.createCheckout.useMutation();

  const apiKeys = apiKeysQuery.data?.keys ?? [];
  const integrations = integrationsQuery.data?.integrations ?? [];
  const balance = balanceQuery.data;
  const plan = planQuery.data;
  const transactions = transactionsQuery.data?.transactions ?? [];

  async function handleCreateKey() {
    if (!newKeyName.trim()) {
      return;
    }
    const result = await createKeyMutation.mutateAsync({
      name: newKeyName.trim(),
    });
    setCreatedKey(result.key);
    setNewKeyName("");
    apiKeysQuery.refetch();
  }

  async function handleRevokeKey(keyId: string) {
    // biome-ignore lint/suspicious/noAlert: confirm dialog is the appropriate UX for destructive action
    if (!window.confirm("Are you sure? This cannot be undone.")) {
      return;
    }
    await revokeKeyMutation.mutateAsync({ keyId });
    apiKeysQuery.refetch();
  }

  async function handleConnectIntegration(provider: string) {
    // In production this would open an OAuth flow
    await connectIntMutation.mutateAsync({
      provider: provider as
        | "github"
        | "gitlab"
        | "linear"
        | "jira"
        | "slack"
        | "vercel"
        | "figma"
        | "notion",
      credentials: { token: "placeholder" },
    });
    integrationsQuery.refetch();
  }

  async function handleDisconnectIntegration(provider: string) {
    await disconnectIntMutation.mutateAsync({ provider });
    integrationsQuery.refetch();
  }

  async function handleUpgrade(tier: "starter" | "pro" | "team" | "studio") {
    const result = await createCheckoutMutation.mutateAsync({ planTier: tier });
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage your account, integrations, and billing.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
        {TABS.map((tab) => (
          <button
            className={`flex-1 rounded-md px-3 py-1.5 font-medium text-sm transition-colors ${
              activeTab === tab.id
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── General ────────────────────────────────────────── */}
      {activeTab === "general" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="font-semibold text-sm text-zinc-200">Profile</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <span className="font-medium text-xs text-zinc-500">Name</span>
                <div className="mt-1 text-sm text-zinc-300">
                  {profileQuery.data?.name ??
                    profileQuery.data?.email ??
                    "Loading..."}
                </div>
              </div>
              <div>
                <span className="font-medium text-xs text-zinc-500">Email</span>
                <div className="mt-1 text-sm text-zinc-300">
                  {profileQuery.data?.email ?? "Loading..."}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="font-semibold text-sm text-zinc-200">
              Organization
            </h3>
            <p className="mt-2 text-sm text-zinc-500">
              Organization settings are managed through Clerk. Click the avatar
              in the sidebar to manage your organization.
            </p>
          </div>
        </div>
      )}

      {/* ── Integrations ───────────────────────────────────── */}
      {activeTab === "integrations" && (
        <div className="space-y-3">
          {INTEGRATION_PROVIDERS.map((provider) => {
            const connected = integrations.find(
              (i) => i.provider === provider.id && i.status === "connected"
            );
            return (
              <div
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                key={provider.id}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 font-bold text-sm text-zinc-400">
                    {provider.name[0]}
                  </div>
                  <div>
                    <div className="font-medium text-sm text-zinc-200">
                      {provider.name}
                    </div>
                    <div className="text-xs text-zinc-500">{provider.desc}</div>
                  </div>
                </div>
                {connected ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-green-400 text-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Connected
                    </span>
                    <button
                      className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                      onClick={() => handleDisconnectIntegration(provider.id)}
                      type="button"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white text-xs hover:bg-violet-700"
                    onClick={() => handleConnectIntegration(provider.id)}
                    type="button"
                  >
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── API Keys ───────────────────────────────────────── */}
      {activeTab === "apikeys" && (
        <div className="space-y-4">
          {/* Create new key */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h3 className="mb-3 font-semibold text-sm text-zinc-200">
              Create API Key
            </h3>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500"
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g., CI/CD Pipeline)"
                type="text"
                value={newKeyName}
              />
              <button
                className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                disabled={!newKeyName.trim() || createKeyMutation.isPending}
                onClick={handleCreateKey}
                type="button"
              >
                Create
              </button>
            </div>

            {/* Show newly created key */}
            {createdKey && (
              <div className="mt-3 rounded-lg border border-yellow-800/30 bg-yellow-950/20 p-3">
                <div className="mb-1 font-medium text-xs text-yellow-400">
                  Copy your API key now. It will not be shown again.
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-300">
                    {createdKey}
                  </code>
                  <button
                    className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                    onClick={() => {
                      navigator.clipboard.writeText(createdKey);
                    }}
                    type="button"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Key list */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
            {apiKeys.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                No API keys created yet.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {apiKeys.map((key) => (
                  <div
                    className="flex items-center justify-between px-4 py-3"
                    key={key.id}
                  >
                    <div>
                      <div className="font-medium text-sm text-zinc-200">
                        {key.name}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        Created {new Date(key.createdAt).toLocaleDateString()}
                        {key.lastUsed && (
                          <>
                            {" "}
                            &middot; Last used{" "}
                            {new Date(key.lastUsed).toLocaleDateString()}
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      className="rounded-lg border border-red-800/50 px-3 py-1 text-red-400 text-xs hover:bg-red-950/30"
                      onClick={() => handleRevokeKey(key.id)}
                      type="button"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Billing ────────────────────────────────────────── */}
      {activeTab === "billing" && (
        <div className="space-y-6">
          {/* Current plan */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-zinc-200">
                  Current Plan
                </h3>
                <div className="mt-2 font-bold text-2xl text-zinc-100">
                  {plan?.name ?? "Hobby"}{" "}
                  <span className="font-normal text-sm text-zinc-500">
                    (Free)
                  </span>
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                  {plan?.creditsIncluded?.toLocaleString() ?? 50} credits/month
                  &middot; {plan?.maxParallelAgents ?? 1} parallel agents
                  &middot; {plan?.maxTasksPerDay ?? 5} tasks/day
                </div>
              </div>
              <button
                className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-700"
                onClick={() => handleUpgrade("pro")}
                type="button"
              >
                Upgrade
              </button>
            </div>
            {plan?.features && plan.features.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {plan.features.map((feature, i) => (
                  <span
                    className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs text-zinc-400"
                    key={i}
                  >
                    {feature}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Credit balance */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="font-semibold text-sm text-zinc-200">
              Credit Balance
            </h3>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs text-zinc-500">Available</div>
                <div className="mt-1 font-bold text-2xl text-zinc-100">
                  {balance?.available?.toLocaleString() ?? 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Reserved</div>
                <div className="mt-1 font-bold text-2xl text-yellow-400">
                  {balance?.reserved?.toLocaleString() ?? 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Total Balance</div>
                <div className="mt-1 font-bold text-2xl text-zinc-100">
                  {balance?.balance?.toLocaleString() ?? 0}
                </div>
              </div>
            </div>
          </div>

          {/* Transaction history */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
            <div className="border-zinc-800 border-b px-4 py-3">
              <h3 className="font-semibold text-sm text-zinc-200">
                Transaction History
              </h3>
            </div>
            {transactions.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                No transactions yet.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {transactions.map((tx) => (
                  <div
                    className="flex items-center justify-between px-4 py-3"
                    key={tx.id}
                  >
                    <div>
                      <div className="text-sm text-zinc-300">
                        {tx.description ?? tx.type}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-600">
                        {new Date(tx.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`font-mono text-sm ${
                        tx.amount > 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {tx.amount > 0 ? "+" : ""}
                      {tx.amount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Models ─────────────────────────────────────────── */}
      {activeTab === "models" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">
            Configure model providers and API keys. PROMETHEUS routes to the
            best model for each task by default. Bring your own API keys to
            customize.
          </p>
          {MODEL_PROVIDERS.map((mp) => {
            const configured = modelPrefsQuery.data?.customKeys?.find(
              (k) => k.provider === mp.provider
            );
            return (
              <div
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                key={mp.provider}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm text-zinc-200">
                      {mp.name}
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      {mp.models.map((model) => (
                        <span
                          className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400"
                          key={model}
                        >
                          {model}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {configured?.configured ? (
                      <span className="flex items-center gap-1 text-green-400 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Configured
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">
                        Using default routing
                      </span>
                    )}
                    <button
                      className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                      onClick={() => {
                        // biome-ignore lint/suspicious/noAlert: prompt dialog for API key input
                        const key = window.prompt(`Enter ${mp.name} API key:`);
                        if (key) {
                          setModelPrefMutation.mutate({
                            provider: mp.provider,
                            apiKey: key,
                            modelId: mp.models[0],
                          });
                        }
                      }}
                      type="button"
                    >
                      {configured?.configured ? "Update Key" : "Add Key"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
