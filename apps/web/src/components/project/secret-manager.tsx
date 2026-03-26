"use client";

import { Badge, Button, Input } from "@prometheus/ui";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SecretEnvironment = "development" | "staging" | "production" | "all";

const ENVIRONMENTS: SecretEnvironment[] = [
  "all",
  "development",
  "staging",
  "production",
];

const ENV_LABELS: Record<SecretEnvironment, string> = {
  all: "All",
  development: "Development",
  staging: "Staging",
  production: "Production",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SecretRowProps {
  createdAt: string;
  description: string | null;
  environment: string;
  id: string;
  isSecret: boolean;
  onDelete: (id: string) => void;
  secretKey: string;
  value: string;
}

function SecretRow({
  id,
  secretKey,
  value,
  environment,
  description,
  isSecret,
  createdAt,
  onDelete,
}: SecretRowProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex items-center justify-between border-b px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium font-mono text-sm">{secretKey}</span>
            <Badge className="text-[10px]" variant="secondary">
              {ENV_LABELS[environment as SecretEnvironment] ?? environment}
            </Badge>
            {isSecret && (
              <Badge className="text-[10px]" variant="outline">
                Secret
              </Badge>
            )}
          </div>
          {description && (
            <p className="mt-0.5 truncate text-muted-foreground text-xs">
              {description}
            </p>
          )}
          <p className="mt-0.5 text-muted-foreground text-xs">
            Added {new Date(createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSecret ? (
            <>
              <code className="text-muted-foreground text-xs">
                {revealed ? value : "********"}
              </code>
              <button
                aria-label={revealed ? "Hide value" : "Reveal value"}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setRevealed(!revealed)}
                type="button"
              >
                {revealed ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          ) : (
            <code className="text-xs">{value}</code>
          )}
        </div>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-1">
        <Button
          onClick={() => onDelete(id)}
          size="sm"
          title="Delete secret"
          variant="ghost"
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

interface CreateSecretFormProps {
  isPending: boolean;
  onCancel: () => void;
  onCreate: (data: {
    description: string;
    environment: SecretEnvironment;
    isSecret: boolean;
    key: string;
    value: string;
  }) => void;
}

function CreateSecretForm({
  onCancel,
  onCreate,
  isPending,
}: CreateSecretFormProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [environment, setEnvironment] = useState<SecretEnvironment>("all");
  const [description, setDescription] = useState("");
  const [isSecret, setIsSecret] = useState(true);

  const handleSubmit = useCallback(() => {
    if (!(key && value)) {
      return;
    }
    onCreate({ key, value, environment, description, isSecret });
    setKey("");
    setValue("");
    setDescription("");
    setEnvironment("all");
    setIsSecret(true);
  }, [key, value, environment, description, isSecret, onCreate]);

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="font-medium text-sm" htmlFor="secret-key">
            Key
          </label>
          <Input
            id="secret-key"
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="DATABASE_URL"
            value={key}
          />
        </div>
        <div>
          <label className="font-medium text-sm" htmlFor="secret-env">
            Environment
          </label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="secret-env"
            onChange={(e) =>
              setEnvironment(e.target.value as SecretEnvironment)
            }
            value={environment}
          >
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {ENV_LABELS[env]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="font-medium text-sm" htmlFor="secret-value">
          Value
        </label>
        <textarea
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id="secret-value"
          onChange={(e) => setValue(e.target.value)}
          placeholder="postgres://user:pass@host:5432/db"
          value={value}
        />
      </div>
      <div>
        <label className="font-medium text-sm" htmlFor="secret-desc">
          Description (optional)
        </label>
        <Input
          id="secret-desc"
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Primary database connection string"
          value={description}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          checked={isSecret}
          className="h-4 w-4 rounded border-input"
          id="secret-masked"
          onChange={(e) => setIsSecret(e.target.checked)}
          type="checkbox"
        />
        <label className="text-sm" htmlFor="secret-masked">
          Mask value in UI (recommended for sensitive data)
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={!(key && value) || isPending}
          onClick={handleSubmit}
          size="sm"
        >
          {isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Add Secret
        </Button>
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface BulkImportFormProps {
  isPending: boolean;
  onCancel: () => void;
  onImport: (data: {
    envContent: string;
    environment: SecretEnvironment;
    overwrite: boolean;
  }) => void;
}

function BulkImportForm({
  onCancel,
  onImport,
  isPending,
}: BulkImportFormProps) {
  const [envContent, setEnvContent] = useState("");
  const [environment, setEnvironment] = useState<SecretEnvironment>("all");
  const [overwrite, setOverwrite] = useState(false);

  const handleSubmit = useCallback(() => {
    if (!envContent.trim()) {
      return;
    }
    onImport({ envContent, environment, overwrite });
  }, [envContent, environment, overwrite, onImport]);

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <label className="font-medium text-sm" htmlFor="bulk-env">
          Environment
        </label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id="bulk-env"
          onChange={(e) => setEnvironment(e.target.value as SecretEnvironment)}
          value={environment}
        >
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {ENV_LABELS[env]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="font-medium text-sm" htmlFor="bulk-content">
          Paste .env file content
        </label>
        <textarea
          className="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id="bulk-content"
          onChange={(e) => setEnvContent(e.target.value)}
          placeholder={
            "DATABASE_URL=postgres://...\nAPI_KEY=sk-...\nREDIS_URL=redis://..."
          }
          value={envContent}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          checked={overwrite}
          className="h-4 w-4 rounded border-input"
          id="bulk-overwrite"
          onChange={(e) => setOverwrite(e.target.checked)}
          type="checkbox"
        />
        <label className="text-sm" htmlFor="bulk-overwrite">
          Overwrite existing keys
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={!envContent.trim() || isPending}
          onClick={handleSubmit}
          size="sm"
        >
          {isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Import
        </Button>
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="py-12 text-center text-muted-foreground">
      <AlertCircle className="mx-auto mb-2 h-8 w-8" />
      <p className="text-sm">No secrets configured for this project.</p>
      <p className="text-xs">
        Add environment variables and API keys that agents need to work with
        your project.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SecretManagerProps {
  projectId: string;
}

export function SecretManager({ projectId }: SecretManagerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [envFilter, setEnvFilter] = useState<SecretEnvironment | undefined>(
    undefined
  );
  const [importResult, setImportResult] = useState<{
    created: number;
    skipped: number;
    updated: number;
  } | null>(null);

  const utils = trpc.useUtils();

  const secretsQuery = trpc.secrets.list.useQuery({
    projectId,
    environment: envFilter,
  });

  const createMutation = trpc.secrets.create.useMutation({
    onSuccess: () => {
      utils.secrets.list.invalidate({ projectId });
      setShowCreate(false);
    },
  });

  const deleteMutation = trpc.secrets.delete.useMutation({
    onSuccess: () => {
      utils.secrets.list.invalidate({ projectId });
    },
  });

  const bulkImportMutation = trpc.secrets.bulkImport.useMutation({
    onSuccess: (data) => {
      utils.secrets.list.invalidate({ projectId });
      setShowBulkImport(false);
      setImportResult({
        created: data.created,
        updated: data.updated,
        skipped: data.skipped,
      });
      setTimeout(() => setImportResult(null), 5000);
    },
  });

  const handleCreate = useCallback(
    (data: {
      description: string;
      environment: SecretEnvironment;
      isSecret: boolean;
      key: string;
      value: string;
    }) => {
      createMutation.mutate({
        projectId,
        key: data.key,
        value: data.value,
        environment: data.environment,
        description: data.description || undefined,
        isSecret: data.isSecret,
      });
    },
    [createMutation, projectId]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate({ id, projectId });
    },
    [deleteMutation, projectId]
  );

  const handleBulkImport = useCallback(
    (data: {
      envContent: string;
      environment: SecretEnvironment;
      overwrite: boolean;
    }) => {
      bulkImportMutation.mutate({
        projectId,
        envContent: data.envContent,
        environment: data.environment,
        overwrite: data.overwrite,
      });
    },
    [bulkImportMutation, projectId]
  );

  const secrets = secretsQuery.data?.secrets ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Environment Variables</h3>
          <p className="text-muted-foreground text-sm">
            Manage secrets and environment variables for agent sandboxes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={bulkImportMutation.isPending}
            onClick={() => {
              setShowBulkImport(!showBulkImport);
              setShowCreate(false);
            }}
            size="sm"
            variant="outline"
          >
            <Upload className="mr-1 h-4 w-4" />
            Import .env
          </Button>
          <Button
            disabled={createMutation.isPending}
            onClick={() => {
              setShowCreate(!showCreate);
              setShowBulkImport(false);
            }}
            size="sm"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Secret
          </Button>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm">
          Imported: {importResult.created} created, {importResult.updated}{" "}
          updated, {importResult.skipped} skipped
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <CreateSecretForm
          isPending={createMutation.isPending}
          onCancel={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Bulk import form */}
      {showBulkImport && (
        <BulkImportForm
          isPending={bulkImportMutation.isPending}
          onCancel={() => setShowBulkImport(false)}
          onImport={handleBulkImport}
        />
      )}

      {/* Environment filter tabs */}
      <div className="flex gap-1 border-b">
        <button
          className={`px-3 py-2 text-sm transition-colors ${
            envFilter === undefined
              ? "border-primary border-b-2 font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setEnvFilter(undefined)}
          type="button"
        >
          All Environments
        </button>
        {ENVIRONMENTS.filter((e) => e !== "all").map((env) => (
          <button
            className={`px-3 py-2 text-sm transition-colors ${
              envFilter === env
                ? "border-primary border-b-2 font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            key={env}
            onClick={() => setEnvFilter(env)}
            type="button"
          >
            {ENV_LABELS[env]}
          </button>
        ))}
      </div>

      {/* Secrets list */}
      {secretsQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {!secretsQuery.isLoading && secrets.length === 0 && <EmptyState />}
      {!secretsQuery.isLoading && secrets.length > 0 && (
        <div className="rounded-lg border">
          {secrets.map((secret) => (
            <SecretRow
              createdAt={secret.createdAt}
              description={secret.description}
              environment={secret.environment}
              id={secret.id}
              isSecret={secret.isSecret}
              key={secret.id}
              onDelete={handleDelete}
              secretKey={secret.key}
              value={secret.value}
            />
          ))}
        </div>
      )}
    </div>
  );
}
