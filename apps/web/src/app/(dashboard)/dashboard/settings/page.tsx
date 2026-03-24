"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@prometheus/ui";
import { Copy, Key, Link2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { trpc } from "@/lib/trpc";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  notifyOnComplete: z.boolean(),
  notifyOnFail: z.boolean(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

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
  {
    provider: "groq",
    name: "Groq",
    models: ["llama-3.3-70b", "mixtral-8x7b"],
  },
  { provider: "cerebras", name: "Cerebras", models: ["llama-3.3-70b"] },
  {
    provider: "ollama",
    name: "Ollama (Local)",
    models: ["llama3.2", "codestral"],
  },
];

export default function SettingsPage() {
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [modelKeyDialogOpen, setModelKeyDialogOpen] = useState(false);
  const [modelKeyProvider, setModelKeyProvider] = useState<{
    provider: string;
    name: string;
    modelId: string;
  } | null>(null);
  const [modelApiKey, setModelApiKey] = useState("");

  const apiKeysQuery = trpc.settings.getApiKeys.useQuery(undefined, {
    retry: 2,
  });
  const integrationsQuery = trpc.integrations.list.useQuery(undefined, {
    retry: 2,
  });
  const modelPrefsQuery = trpc.settings.getModelPreferences.useQuery(
    undefined,
    { retry: 2 }
  );
  const balanceQuery = trpc.billing.getBalance.useQuery(undefined, {
    retry: 2,
  });
  const planQuery = trpc.billing.getPlan.useQuery(undefined, { retry: 2 });
  const transactionsQuery = trpc.billing.getTransactions.useQuery(
    { limit: 20 },
    { retry: 2 }
  );
  const profileQuery = trpc.user.profile.useQuery(undefined, { retry: 2 });
  const updateProfileMutation = trpc.user.updateProfile.useMutation();

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: "",
      notifyOnComplete: true,
      notifyOnFail: true,
    },
  });

  // Populate form when profile data loads
  useEffect(() => {
    if (profileQuery.data) {
      profileForm.reset({
        name: profileQuery.data.name ?? profileQuery.data.email ?? "",
        notifyOnComplete: true,
        notifyOnFail: true,
      });
    }
  }, [profileQuery.data, profileForm]);

  async function handleProfileSubmit(values: ProfileFormValues) {
    try {
      await updateProfileMutation.mutateAsync(values);
      toast.success("Profile updated");
      profileQuery.refetch();
    } catch {
      toast.error("Failed to update profile");
    }
  }

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
    try {
      const result = await createKeyMutation.mutateAsync({
        name: newKeyName.trim(),
      });
      setCreatedKey(result.key);
      setNewKeyName("");
      apiKeysQuery.refetch();
      toast.success("API key created");
    } catch {
      toast.error("Failed to create API key. Please try again.");
    }
  }

  async function handleRevokeKey(keyId: string) {
    try {
      await revokeKeyMutation.mutateAsync({ keyId });
      apiKeysQuery.refetch();
      toast.success("API key revoked");
    } catch {
      toast.error("Failed to revoke API key. Please try again.");
    }
  }

  async function handleConnectIntegration(provider: string) {
    try {
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
        credentials: {},
      });
      integrationsQuery.refetch();
      toast.success(`${provider} connected`);
      toast.info(
        "Configure credentials in Settings > Integrations for your provider."
      );
    } catch {
      toast.error(`Failed to connect ${provider}. Please try again.`);
    }
  }

  async function handleDisconnectIntegration(provider: string) {
    try {
      await disconnectIntMutation.mutateAsync({ provider });
      integrationsQuery.refetch();
      toast.info(`${provider} disconnected`);
    } catch {
      toast.error(`Failed to disconnect ${provider}. Please try again.`);
    }
  }

  async function handleUpgrade(tier: "starter" | "pro" | "team" | "studio") {
    try {
      const result = await createCheckoutMutation.mutateAsync({
        planTier: tier,
      });
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    } catch {
      toast.error("Failed to start checkout. Please try again.");
    }
  }

  async function handleModelKeySubmit() {
    if (modelKeyProvider && modelApiKey) {
      try {
        await setModelPrefMutation.mutateAsync({
          provider: modelKeyProvider.provider,
          apiKey: modelApiKey,
          modelId: modelKeyProvider.modelId,
        });
        toast.success(`${modelKeyProvider.name} API key saved`);
      } catch {
        toast.error(`Failed to save ${modelKeyProvider.name} API key`);
      }
    }
    setModelKeyDialogOpen(false);
    setModelApiKey("");
    setModelKeyProvider(null);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">Settings</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Manage your account, integrations, and billing.
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="w-full">
          <TabsTrigger className="flex-1" value="general">
            General
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="integrations">
            Integrations
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="apikeys">
            API Keys
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="billing">
            Billing
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="models">
            Models
          </TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent className="space-y-6" value="general">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={profileForm.handleSubmit(handleProfileSubmit)}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="profile-name">Name</Label>
                    <Input
                      id="profile-name"
                      {...profileForm.register("name")}
                      placeholder="Your name"
                    />
                    {profileForm.formState.errors.name && (
                      <p className="text-destructive text-xs">
                        {profileForm.formState.errors.name.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-email">Email</Label>
                    <Input
                      disabled
                      id="profile-email"
                      readOnly
                      value={profileQuery.data?.email ?? "Loading..."}
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label className="text-muted-foreground text-xs">
                    Notification Preferences
                  </Label>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-foreground text-sm">
                        Task completed
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Notify when a task finishes successfully
                      </div>
                    </div>
                    <Switch
                      checked={profileForm.watch("notifyOnComplete")}
                      onCheckedChange={(checked) =>
                        profileForm.setValue("notifyOnComplete", checked)
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-foreground text-sm">Task failed</div>
                      <div className="text-muted-foreground text-xs">
                        Notify when a task encounters an error
                      </div>
                    </div>
                    <Switch
                      checked={profileForm.watch("notifyOnFail")}
                      onCheckedChange={(checked) =>
                        profileForm.setValue("notifyOnFail", checked)
                      }
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    disabled={
                      !profileForm.formState.isDirty ||
                      updateProfileMutation.isPending
                    }
                    type="submit"
                  >
                    {updateProfileMutation.isPending
                      ? "Saving..."
                      : "Save Changes"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Organization</CardTitle>
              <CardDescription>
                Organization settings are managed through Clerk. Click the
                avatar in the sidebar to manage your organization.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent className="space-y-3" value="integrations">
          {INTEGRATION_PROVIDERS.map((provider) => {
            const connected = integrations.find(
              (i) => i.provider === provider.id && i.status === "connected"
            );
            return (
              <Card key={provider.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted font-bold text-muted-foreground text-sm">
                      {provider.name[0]}
                    </div>
                    <div>
                      <div className="font-medium text-foreground text-sm">
                        {provider.name}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {provider.desc}
                      </div>
                    </div>
                  </div>
                  {connected ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="success">
                        <Link2 className="mr-1 h-3 w-3" />
                        Connected
                      </Badge>
                      <Button
                        onClick={() => handleDisconnectIntegration(provider.id)}
                        size="sm"
                        variant="outline"
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={() => handleConnectIntegration(provider.id)}
                      size="sm"
                    >
                      Connect
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* API Keys */}
        <TabsContent className="space-y-4" value="apikeys">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Create API Key</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g., CI/CD Pipeline)"
                  value={newKeyName}
                />
                <Button
                  disabled={!newKeyName.trim() || createKeyMutation.isPending}
                  onClick={handleCreateKey}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Create
                </Button>
              </div>

              {createdKey && (
                <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <div className="mb-1 font-medium text-warning text-xs">
                    Copy your API key now. It will not be shown again.
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-muted px-3 py-1.5 font-mono text-foreground text-xs">
                      {createdKey}
                    </code>
                    <Button
                      onClick={() => {
                        navigator.clipboard.writeText(createdKey);
                        toast.success("Copied to clipboard");
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {apiKeys.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No API keys created yet.
                </div>
              ) : (
                <div className="divide-y">
                  {apiKeys.map((key) => (
                    <div
                      className="flex items-center justify-between px-4 py-3"
                      key={key.id}
                    >
                      <div>
                        <div className="flex items-center gap-2 font-medium text-foreground text-sm">
                          <Key className="h-3.5 w-3.5 text-muted-foreground" />
                          {key.name}
                        </div>
                        <div className="mt-0.5 text-muted-foreground text-xs">
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
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive">
                            <Trash2 className="mr-1 h-3 w-3" />
                            Revoke
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to revoke &quot;{key.name}
                              &quot;? This cannot be undone. Any applications
                              using this key will lose access.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRevokeKey(key.id)}
                            >
                              Revoke
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing */}
        <TabsContent className="space-y-6" value="billing">
          <Card>
            <CardContent className="flex items-center justify-between p-6">
              <div>
                <CardTitle className="text-sm">Current Plan</CardTitle>
                <div className="mt-2 font-bold text-2xl text-foreground">
                  {plan?.name ?? "Hobby"}{" "}
                  <span className="font-normal text-muted-foreground text-sm">
                    (Free)
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground text-sm">
                  {plan?.creditsIncluded?.toLocaleString() ?? 50} credits/month
                  &middot; {plan?.maxParallelAgents ?? 1} parallel agents
                  &middot; {plan?.maxTasksPerDay ?? 5} tasks/day
                </div>
              </div>
              <Button onClick={() => handleUpgrade("pro")}>Upgrade</Button>
            </CardContent>
            {plan?.features && plan.features.length > 0 && (
              <>
                <Separator />
                <CardContent className="flex flex-wrap gap-2 pt-4">
                  {plan.features.map((feature) => (
                    <Badge key={feature} variant="outline">
                      {feature}
                    </Badge>
                  ))}
                </CardContent>
              </>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Credit Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <div className="text-muted-foreground text-xs">Available</div>
                  <div className="mt-1 font-bold text-2xl text-foreground">
                    {balance?.available?.toLocaleString() ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Reserved</div>
                  <div className="mt-1 font-bold text-2xl text-warning">
                    {balance?.reserved?.toLocaleString() ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">
                    Total Balance
                  </div>
                  <div className="mt-1 font-bold text-2xl text-foreground">
                    {balance?.balance?.toLocaleString() ?? 0}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Transaction History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No transactions yet.
                </div>
              ) : (
                <div className="divide-y">
                  {transactions.map((tx) => (
                    <div
                      className="flex items-center justify-between px-4 py-3"
                      key={tx.id}
                    >
                      <div>
                        <div className="text-foreground text-sm">
                          {tx.description ?? tx.type}
                        </div>
                        <div className="mt-0.5 text-muted-foreground text-xs">
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* Models */}
        <TabsContent className="space-y-3" value="models">
          <p className="text-muted-foreground text-sm">
            Configure model providers and API keys. PROMETHEUS routes to the
            best model for each task by default. Bring your own API keys to
            customize.
          </p>
          {MODEL_PROVIDERS.map((mp) => {
            const configured = modelPrefsQuery.data?.customKeys?.find(
              (k) => k.provider === mp.provider
            );
            return (
              <Card key={mp.provider}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-medium text-foreground text-sm">
                      {mp.name}
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      {mp.models.map((model) => (
                        <Badge key={model} variant="secondary">
                          {model}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {configured?.configured ? (
                      <Badge variant="success">Configured</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Using default routing
                      </span>
                    )}
                    <Button
                      onClick={() => {
                        setModelKeyProvider({
                          provider: mp.provider,
                          name: mp.name,
                          modelId: mp.models[0] ?? mp.provider,
                        });
                        setModelKeyDialogOpen(true);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {configured?.configured ? "Update Key" : "Add Key"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* Model API Key Dialog */}
      <Dialog onOpenChange={setModelKeyDialogOpen} open={modelKeyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{modelKeyProvider?.name} API Key</DialogTitle>
            <DialogDescription>
              Enter your API key for {modelKeyProvider?.name}. This key is
              encrypted and stored securely.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              className="mt-2"
              id="api-key"
              onChange={(e) => setModelApiKey(e.target.value)}
              placeholder={`Enter ${modelKeyProvider?.name} API key`}
              type="password"
              value={modelApiKey}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => setModelKeyDialogOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={!modelApiKey} onClick={handleModelKeySubmit}>
              Save Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
