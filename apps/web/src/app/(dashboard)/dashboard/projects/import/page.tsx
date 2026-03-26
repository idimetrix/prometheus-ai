"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@prometheus/ui";
import { CheckCircle, Globe, Loader2 } from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProviderConnect } from "@/components/project/provider-connect";
import { RepoBrowser } from "@/components/project/repo-browser";
import { logger } from "@/lib/logger";
import { trpc } from "@/lib/trpc";

type Provider = "github" | "gitlab" | "bitbucket";
type ImportMode = "oauth" | "manual-url";

const PRESETS = [
  {
    id: "modern-saas",
    name: "Modern SaaS",
    desc: "Next.js + tRPC + Drizzle + PostgreSQL",
  },
  {
    id: "fullstack-minimal",
    name: "Full-Stack Minimal",
    desc: "Next.js + Prisma + SQLite",
  },
  {
    id: "django-react",
    name: "Django + React",
    desc: "Django REST + React SPA",
  },
  { id: "rails", name: "Rails + Hotwire", desc: "Ruby on Rails full-stack" },
  {
    id: "go-microservices",
    name: "Go Microservices",
    desc: "Go + gRPC + PostgreSQL",
  },
  { id: "auto-detect", name: "Auto-Detect", desc: "Detect from repository" },
  { id: "custom", name: "Custom", desc: "Define your own tech stack" },
];

const STEPS = [
  "Select Provider",
  "Browse Repos",
  "Configure",
  "Confirm",
] as const;

const MANUAL_STEPS = [
  "Select Provider",
  "Enter URL",
  "Configure",
  "Confirm",
] as const;

const GIT_URL_PATTERN =
  /^(https?:\/\/[^\s]+\.git|https?:\/\/[^\s]+|git@[^\s]+:[^\s]+\.git)$/;

interface SelectedRepo {
  cloneUrl: string;
  defaultBranch: string;
  description: string | null;
  fullName: string;
  isPrivate: boolean;
  language: string | null;
  name: string;
}

const GIT_SUFFIX_RE = /\.git$/;

function formatProviderName(provider: Provider | null): string {
  if (!provider) {
    return "";
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Extract a project name from a git clone URL */
function nameFromUrl(url: string): string {
  const segments = url.replace(GIT_SUFFIX_RE, "").split("/").filter(Boolean);
  return segments.at(-1) ?? "untitled";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Multi-step form wizard with conditional rendering per step
export default function ImportProjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(1);
  const [importMode, setImportMode] = useState<ImportMode>("oauth");
  const [provider, setProvider] = useState<Provider | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<SelectedRepo | null>(null);
  const [nameOverride, setNameOverride] = useState("");
  const [branch, setBranch] = useState("");
  const [preset, setPreset] = useState("auto-detect");
  const [isImporting, setIsImporting] = useState(false);

  // Manual URL fields
  const [manualUrl, setManualUrl] = useState("");
  const [manualPat, setManualPat] = useState("");
  const [manualBranch, setManualBranch] = useState("main");
  const [manualName, setManualName] = useState("");

  const importMutation = trpc.integrations.importRepo.useMutation();
  const importFromGitUrlMutation =
    trpc.integrations.importFromGitUrl.useMutation();

  // Handle OAuth callback redirect
  useEffect(() => {
    const connectedProvider = searchParams.get("provider") as Provider | null;
    const connected = searchParams.get("connected");
    if (connectedProvider && connected === "true") {
      setProvider(connectedProvider);
      setImportMode("oauth");
      setStep(2);
      toast.success(`Connected to ${connectedProvider}`);
    }
  }, [searchParams]);

  // Auto-detect project name from URL
  useEffect(() => {
    if (importMode === "manual-url" && manualUrl && !manualName) {
      // Don't auto-fill if user has already typed a name
    }
  }, [importMode, manualUrl, manualName]);

  const isManualUrlValid = GIT_URL_PATTERN.test(manualUrl.trim());

  async function handleImport() {
    if (importMode === "manual-url") {
      await handleManualImport();
      return;
    }

    if (!(provider && selectedRepo)) {
      return;
    }
    setIsImporting(true);
    try {
      const result = await importMutation.mutateAsync({
        provider,
        repoFullName: selectedRepo.fullName,
        branch: branch.trim() || undefined,
        nameOverride: nameOverride.trim() || undefined,
        techStackPreset: preset,
      });
      toast.success(`Project "${result.name}" imported!`);
      router.push(`/dashboard/projects/${result.projectId}/brain` as Route);
    } catch (err) {
      logger.error("Failed to import project:", err);
      toast.error("Failed to import project");
      setIsImporting(false);
    }
  }

  async function handleManualImport() {
    if (!isManualUrlValid) {
      return;
    }
    setIsImporting(true);
    try {
      const result = await importFromGitUrlMutation.mutateAsync({
        repoUrl: manualUrl.trim(),
        branch: manualBranch.trim() || "main",
        name: manualName.trim() || undefined,
        personalAccessToken: manualPat.trim() || undefined,
        techStackPreset: preset,
      });
      toast.success(`Project "${result.name}" imported!`);
      router.push(`/dashboard/projects/${result.projectId}/brain` as Route);
    } catch (err) {
      logger.error("Failed to import project from URL:", err);
      toast.error("Failed to import project");
      setIsImporting(false);
    }
  }

  const activeSteps = importMode === "manual-url" ? MANUAL_STEPS : STEPS;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">
          Import from Repository
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Connect your Git provider and import an existing repository as a
          project.
        </p>
        <div className="mt-4 flex items-center gap-3">
          {activeSteps.map((label, i) => {
            const s = i + 1;
            return (
              <div className="flex items-center gap-2" key={label}>
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full font-medium text-xs ${
                    step >= s
                      ? "bg-primary text-primary-foreground"
                      : "border text-muted-foreground"
                  }`}
                >
                  {step > s ? <CheckCircle className="h-4 w-4" /> : s}
                </div>
                <span
                  className={`text-xs ${
                    step >= s
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
                {s < activeSteps.length && (
                  <div className="mx-1 h-px w-8 bg-border" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step 1: Select Provider / Import Mode */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Choose how to import your repository
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mode selector tabs */}
            <div className="flex gap-2 rounded-lg border p-1">
              <button
                className={`flex-1 rounded-md px-3 py-2 text-sm transition-all ${
                  importMode === "oauth"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setImportMode("oauth")}
                type="button"
              >
                OAuth Provider
              </button>
              <button
                className={`flex-1 rounded-md px-3 py-2 text-sm transition-all ${
                  importMode === "manual-url"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setImportMode("manual-url")}
                type="button"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  Manual URL
                </span>
              </button>
            </div>

            {importMode === "oauth" && (
              <>
                <ProviderConnect
                  onProviderConnected={(p) => {
                    setProvider(p);
                  }}
                  onSelectProvider={(p) => {
                    setProvider(p);
                  }}
                  selectedProvider={provider}
                />
                <div className="flex justify-end">
                  <Button disabled={!provider} onClick={() => setStep(2)}>
                    Next
                  </Button>
                </div>
              </>
            )}

            {importMode === "manual-url" && (
              <div className="space-y-4">
                <p className="text-muted-foreground text-xs">
                  Paste any git clone URL. No OAuth connection required. For
                  private repos, provide a Personal Access Token.
                </p>
                <div className="flex justify-end">
                  <Button onClick={() => setStep(2)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2 (OAuth): Browse Repos */}
      {step === 2 && importMode === "oauth" && provider && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Select a Repository from {formatProviderName(provider)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <RepoBrowser
              onSelectRepo={(repo) => {
                setSelectedRepo(repo);
                setBranch(repo.defaultBranch);
                setNameOverride("");
              }}
              provider={provider}
              selectedRepo={selectedRepo?.fullName ?? null}
            />
            <div className="flex justify-between">
              <Button onClick={() => setStep(1)} variant="outline">
                Back
              </Button>
              <Button disabled={!selectedRepo} onClick={() => setStep(3)}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 (Manual URL): Enter URL */}
      {step === 2 && importMode === "manual-url" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Repository Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="manual-url">
                Git Clone URL{" "}
                <span className="font-normal text-destructive">*</span>
              </Label>
              <Input
                className="mt-1.5 font-mono text-sm"
                id="manual-url"
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git or git@github.com:org/repo.git"
                value={manualUrl}
              />
              {manualUrl && !isManualUrlValid && (
                <p className="mt-1 text-destructive text-xs">
                  Enter a valid HTTPS or SSH git URL
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="manual-pat">
                Personal Access Token{" "}
                <span className="font-normal text-muted-foreground">
                  (optional, for private repos)
                </span>
              </Label>
              <Input
                className="mt-1.5"
                id="manual-pat"
                onChange={(e) => setManualPat(e.target.value)}
                placeholder="ghp_xxxx or glpat-xxxx"
                type="password"
                value={manualPat}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="manual-branch">Branch</Label>
                <Input
                  className="mt-1.5"
                  id="manual-branch"
                  onChange={(e) => setManualBranch(e.target.value)}
                  placeholder="main"
                  value={manualBranch}
                />
              </div>
              <div>
                <Label htmlFor="manual-name">
                  Project Name{" "}
                  <span className="font-normal text-muted-foreground">
                    (auto-detected from URL)
                  </span>
                </Label>
                <Input
                  className="mt-1.5"
                  id="manual-name"
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder={
                    manualUrl ? nameFromUrl(manualUrl) : "my-project"
                  }
                  value={manualName}
                />
              </div>
            </div>
            <div className="flex justify-between">
              <Button onClick={() => setStep(1)} variant="outline">
                Back
              </Button>
              <Button
                disabled={!isManualUrlValid}
                onClick={() => {
                  // Build a synthetic selectedRepo so steps 3-4 work uniformly
                  const derivedName =
                    manualName.trim() || nameFromUrl(manualUrl);
                  setSelectedRepo({
                    cloneUrl: manualUrl.trim(),
                    defaultBranch: manualBranch.trim() || "main",
                    description: null,
                    fullName: derivedName,
                    isPrivate: !!manualPat,
                    language: null,
                    name: derivedName,
                  });
                  setBranch(manualBranch.trim() || "main");
                  setNameOverride(manualName.trim());
                  setStep(3);
                }}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Configure Import */}
      {step === 3 && selectedRepo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Configure Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="import-name">
                Project Name{" "}
                <span className="font-normal text-muted-foreground">
                  (defaults to repo name)
                </span>
              </Label>
              <Input
                className="mt-1.5"
                id="import-name"
                onChange={(e) => setNameOverride(e.target.value)}
                placeholder={selectedRepo.name}
                value={nameOverride}
              />
            </div>
            <div>
              <Label htmlFor="import-branch">Branch</Label>
              <Input
                className="mt-1.5"
                id="import-branch"
                onChange={(e) => setBranch(e.target.value)}
                placeholder={selectedRepo.defaultBranch}
                value={branch}
              />
            </div>
            <div>
              <Label>Tech Stack Preset</Label>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {PRESETS.map((p) => (
                  <button
                    className={`rounded-lg border p-3 text-left transition-all ${
                      preset === p.id
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : "border-border bg-card hover:border-muted-foreground/30"
                    }`}
                    key={p.id}
                    onClick={() => setPreset(p.id)}
                    type="button"
                  >
                    <div className="font-medium text-foreground text-xs">
                      {p.name}
                    </div>
                    <div className="mt-0.5 text-muted-foreground text-xs">
                      {p.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-between">
              <Button onClick={() => setStep(2)} variant="outline">
                Back
              </Button>
              <Button onClick={() => setStep(4)}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirm */}
      {step === 4 && selectedRepo && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Import Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-muted-foreground text-xs">
                    Import Method
                  </div>
                  <div className="mt-0.5 font-medium text-foreground text-sm">
                    {importMode === "manual-url"
                      ? "Manual URL"
                      : formatProviderName(provider)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">
                    Repository
                  </div>
                  <div className="mt-0.5 font-mono text-foreground text-sm">
                    {importMode === "manual-url"
                      ? manualUrl
                      : selectedRepo.fullName}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">
                    Project Name
                  </div>
                  <div className="mt-0.5 font-medium text-foreground text-sm">
                    {nameOverride.trim() || selectedRepo.name}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Branch</div>
                  <div className="mt-0.5 font-mono text-foreground text-sm">
                    {branch || selectedRepo.defaultBranch}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">
                    Tech Stack
                  </div>
                  <div className="mt-0.5 font-medium text-foreground text-sm">
                    {PRESETS.find((p) => p.id === preset)?.name ?? preset}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">
                    Visibility
                  </div>
                  <div className="mt-0.5 text-foreground text-sm">
                    {selectedRepo.isPrivate ? "Private" : "Public"}
                  </div>
                </div>
                {selectedRepo.description && (
                  <div className="md:col-span-2">
                    <div className="text-muted-foreground text-xs">
                      Description
                    </div>
                    <div className="mt-0.5 text-foreground text-sm">
                      {selectedRepo.description}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-between">
            <Button onClick={() => setStep(3)} variant="outline">
              Back
            </Button>
            <Button disabled={isImporting} onClick={handleImport}>
              {isImporting ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import Project"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
