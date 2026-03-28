"use client";

import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Separator,
} from "@prometheus/ui";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Code2,
  GitBranch,
  Rocket,
  User,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const STEPS = [
  { label: "Welcome", icon: User },
  { label: "Connect", icon: GitBranch },
  { label: "Import", icon: Code2 },
  { label: "Try it", icon: Rocket },
  { label: "Done", icon: CheckCircle2 },
] as const;

function stepStyle(isCompleted: boolean): string {
  if (isCompleted) {
    return "bg-green-500 text-white";
  }
  return "bg-muted text-muted-foreground";
}

function ProgressBar({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isActive = i === currentStep;
        const isCompleted = i < currentStep;
        return (
          <div className="flex items-center gap-2" key={step.label}>
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : stepStyle(isCompleted)
              }`}
            >
              {isCompleted ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </div>
            <span
              className={`hidden text-sm sm:block ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-8 ${isCompleted ? "bg-green-500" : "bg-muted"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepWelcome({
  name,
  role,
  setName,
  setRole,
}: {
  name: string;
  role: string;
  setName: (v: string) => void;
  setRole: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-bold text-2xl text-foreground">
          Welcome to Prometheus
        </h2>
        <p className="mt-2 text-muted-foreground">
          Let us set up your workspace in just a few steps.
        </p>
      </div>
      <div className="mx-auto max-w-md space-y-4">
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            value={name}
          />
        </div>
        <div>
          <Label htmlFor="role">Your role</Label>
          <Input
            id="role"
            onChange={(e) => setRole(e.target.value)}
            placeholder="Full-stack developer, Tech Lead, etc."
            value={role}
          />
        </div>
      </div>
    </div>
  );
}

function StepConnect() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-bold text-2xl text-foreground">
          Connect your code
        </h2>
        <p className="mt-2 text-muted-foreground">
          Connect a source control provider to get started.
        </p>
      </div>
      <div className="mx-auto grid max-w-lg gap-4">
        <Button className="justify-start gap-3" size="lg" variant="outline">
          <GitBranch className="h-5 w-5" />
          Connect GitHub
        </Button>
        <Button className="justify-start gap-3" size="lg" variant="outline">
          <GitBranch className="h-5 w-5" />
          Connect GitLab
        </Button>
        <Button className="justify-start gap-3" size="lg" variant="outline">
          <GitBranch className="h-5 w-5" />
          Connect Bitbucket
        </Button>
      </div>
      <p className="text-center text-muted-foreground text-xs">
        You can also paste a repository URL in the next step.
      </p>
    </div>
  );
}

function StepImport({
  repoUrl,
  setRepoUrl,
}: {
  repoUrl: string;
  setRepoUrl: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-bold text-2xl text-foreground">Import a project</h2>
        <p className="mt-2 text-muted-foreground">
          Paste a repository URL or select from your connected repos.
        </p>
      </div>
      <div className="mx-auto max-w-lg space-y-4">
        <div>
          <Label htmlFor="repo-url">Repository URL</Label>
          <Input
            id="repo-url"
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/your-org/your-repo"
            value={repoUrl}
          />
        </div>
        <Separator />
        <p className="text-center text-muted-foreground text-sm">
          Or select from your connected repositories:
        </p>
        <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
          No repositories connected yet. Connect a provider in the previous step
          to see your repos here.
        </div>
      </div>
    </div>
  );
}

function StepTryIt() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-bold text-2xl text-foreground">
          Try your first task
        </h2>
        <p className="mt-2 text-muted-foreground">
          Give Prometheus a task and see what it can do.
        </p>
      </div>
      <div className="mx-auto max-w-lg">
        <Card>
          <CardContent className="pt-6">
            <textarea
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              defaultValue="Add input validation to the user registration form and write unit tests for it."
              rows={4}
            />
            <Button className="mt-4 w-full">
              <Rocket className="mr-2 h-4 w-4" />
              Run Task
            </Button>
          </CardContent>
        </Card>
        <p className="mt-3 text-center text-muted-foreground text-xs">
          You can skip this and try later from the dashboard.
        </p>
      </div>
    </div>
  );
}

function StepDone() {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
        <CheckCircle2 className="h-8 w-8 text-green-500" />
      </div>
      <div>
        <h2 className="font-bold text-2xl text-foreground">You are all set!</h2>
        <p className="mt-2 text-muted-foreground">
          Your workspace is ready. Start building with AI-powered engineering.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button asChild size="lg">
          <Link href="/dashboard">Go to Dashboard</Link>
        </Button>
        <div className="flex gap-4">
          <Button asChild size="sm" variant="ghost">
            <Link href="/dashboard/settings">Settings</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a
              href="https://docs.prometheus.dev"
              rel="noopener noreferrer"
              target="_blank"
            >
              Documentation
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  const canNext = () => {
    if (step === 0) {
      return name.trim().length > 0;
    }
    return true;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <ProgressBar currentStep={step} />
        <Button asChild size="sm" variant="ghost">
          <Link href="/dashboard">Skip</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="py-12">
          {step === 0 && (
            <StepWelcome
              name={name}
              role={role}
              setName={setName}
              setRole={setRole}
            />
          )}
          {step === 1 && <StepConnect />}
          {step === 2 && (
            <StepImport repoUrl={repoUrl} setRepoUrl={setRepoUrl} />
          )}
          {step === 3 && <StepTryIt />}
          {step === 4 && <StepDone />}
        </CardContent>
      </Card>

      {step < 4 && (
        <div className="flex justify-between">
          <Button
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            variant="outline"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button
            disabled={!canNext()}
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            {step === 3 ? "Finish" : "Next"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
