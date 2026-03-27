"use client";

function getConfidenceLabel(trials: number) {
  if (trials >= 400) {
    return "High (p < 0.01)";
  }
  if (trials >= 200) {
    return "Medium (p < 0.05)";
  }
  return "Low (insufficient data)";
}

function _getExperimentVariant(status: string) {
  if (status === "active") {
    return "default" as const;
  }
  if (status === "completed") {
    return "secondary" as const;
  }
  return "outline" as const;
}

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
} from "@prometheus/ui";
import {
  Beaker,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  Plus,
  Trophy,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ExperimentStatus = "active" | "paused" | "completed";

interface Experiment {
  createdAt: string;
  createdBy: string;
  description: string;
  id: string;
  name: string;
  status: ExperimentStatus;
  strategyA: {
    name: string;
    description: string;
    wins: number;
    trials: number;
  };
  strategyB: {
    name: string;
    description: string;
    wins: number;
    trials: number;
  };
  totalTrials: number;
}

const MOCK_EXPERIMENTS: Experiment[] = [
  {
    id: "exp-001",
    name: "Code Generation Model Comparison",
    description:
      "Compare Claude Sonnet 4 vs GPT-4o for code generation quality and speed",
    status: "active",
    strategyA: {
      name: "Claude Sonnet 4",
      description: "Anthropic Claude Sonnet 4 with default prompting",
      wins: 342,
      trials: 500,
    },
    strategyB: {
      name: "GPT-4o",
      description: "OpenAI GPT-4o with default prompting",
      wins: 158,
      trials: 500,
    },
    totalTrials: 500,
    createdAt: "2026-03-10T09:00:00Z",
    createdBy: "Sarah Chen",
  },
  {
    id: "exp-002",
    name: "Prompt Strategy: Chain of Thought vs Direct",
    description:
      "Test whether chain-of-thought prompting improves bug fix accuracy",
    status: "active",
    strategyA: {
      name: "Chain of Thought",
      description: "Step-by-step reasoning before generating fix",
      wins: 189,
      trials: 300,
    },
    strategyB: {
      name: "Direct Generation",
      description: "Generate fix directly without reasoning steps",
      wins: 111,
      trials: 300,
    },
    totalTrials: 300,
    createdAt: "2026-03-15T11:00:00Z",
    createdBy: "James Wilson",
  },
  {
    id: "exp-003",
    name: "Context Window: Full File vs Relevant Snippet",
    description:
      "Compare providing full file context vs only relevant code snippets",
    status: "completed",
    strategyA: {
      name: "Full File Context",
      description: "Send the entire source file as context",
      wins: 245,
      trials: 400,
    },
    strategyB: {
      name: "Relevant Snippets",
      description: "Extract and send only relevant code sections",
      wins: 155,
      trials: 400,
    },
    totalTrials: 400,
    createdAt: "2026-02-20T14:00:00Z",
    createdBy: "Maria Lopez",
  },
  {
    id: "exp-004",
    name: "Review Depth: Shallow vs Deep Analysis",
    description:
      "Test shallow code review (lint + style) vs deep semantic analysis",
    status: "paused",
    strategyA: {
      name: "Shallow Review",
      description: "Focus on linting, formatting, and style issues",
      wins: 78,
      trials: 200,
    },
    strategyB: {
      name: "Deep Analysis",
      description: "Full semantic analysis including logic errors and patterns",
      wins: 122,
      trials: 200,
    },
    totalTrials: 200,
    createdAt: "2026-03-01T10:00:00Z",
    createdBy: "Alex Kim",
  },
  {
    id: "exp-005",
    name: "Temperature Setting: 0.2 vs 0.7",
    description:
      "Compare conservative vs creative temperature settings for feature implementation",
    status: "completed",
    strategyA: {
      name: "Conservative (0.2)",
      description: "Low temperature for more deterministic output",
      wins: 310,
      trials: 600,
    },
    strategyB: {
      name: "Creative (0.7)",
      description: "Higher temperature for more varied solutions",
      wins: 290,
      trials: 600,
    },
    totalTrials: 600,
    createdAt: "2026-02-10T08:00:00Z",
    createdBy: "Jordan Patel",
  },
  {
    id: "exp-006",
    name: "Retrieval Strategy: Vector Search vs Keyword",
    description:
      "Compare vector embedding search vs traditional keyword search for context retrieval",
    status: "active",
    strategyA: {
      name: "Vector Embeddings",
      description: "Use embedding model for semantic similarity search",
      wins: 67,
      trials: 100,
    },
    strategyB: {
      name: "Keyword Search",
      description: "Traditional TF-IDF based keyword matching",
      wins: 33,
      trials: 100,
    },
    totalTrials: 100,
    createdAt: "2026-03-22T13:00:00Z",
    createdBy: "Sarah Chen",
  },
];

const STATUS_CONFIG: Record<
  ExperimentStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  active: { label: "Active", variant: "default" },
  paused: { label: "Paused", variant: "secondary" },
  completed: { label: "Completed", variant: "outline" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function winRate(wins: number, trials: number): string {
  if (trials === 0) {
    return "0.0%";
  }
  return `${((wins / trials) * 100).toFixed(1)}%`;
}

function getWinner(exp: Experiment): "A" | "B" | "tie" {
  const rateA = exp.strategyA.wins / exp.strategyA.trials;
  const rateB = exp.strategyB.wins / exp.strategyB.trials;
  if (Math.abs(rateA - rateB) < 0.02) {
    return "tie";
  }
  return rateA > rateB ? "A" : "B";
}

export default function ExperimentsPage() {
  const [experiments, setExperiments] =
    useState<Experiment[]>(MOCK_EXPERIMENTS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newStrategyAName, setNewStrategyAName] = useState("");
  const [newStrategyADesc, setNewStrategyADesc] = useState("");
  const [newStrategyBName, setNewStrategyBName] = useState("");
  const [newStrategyBDesc, setNewStrategyBDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const activeCount = experiments.filter((e) => e.status === "active").length;
  const completedCount = experiments.filter(
    (e) => e.status === "completed"
  ).length;

  function handleToggleStatus(expId: string) {
    setExperiments((prev) =>
      prev.map((e) => {
        if (e.id !== expId) {
          return e;
        }
        const next: ExperimentStatus =
          e.status === "active" ? "paused" : "active";
        toast.success(`${e.name} ${next === "active" ? "resumed" : "paused"}`);
        return { ...e, status: next };
      })
    );
  }

  function handleCreate() {
    if (
      !(newName.trim() && newStrategyAName.trim() && newStrategyBName.trim())
    ) {
      return;
    }
    setIsCreating(true);
    setTimeout(() => {
      const exp: Experiment = {
        id: `exp-${String(Date.now())}`,
        name: newName.trim(),
        description: newDescription.trim(),
        status: "active",
        strategyA: {
          name: newStrategyAName.trim(),
          description: newStrategyADesc.trim(),
          wins: 0,
          trials: 0,
        },
        strategyB: {
          name: newStrategyBName.trim(),
          description: newStrategyBDesc.trim(),
          wins: 0,
          trials: 0,
        },
        totalTrials: 0,
        createdAt: new Date().toISOString(),
        createdBy: "You",
      };
      setExperiments((prev) => [exp, ...prev]);
      setCreateDialogOpen(false);
      setNewName("");
      setNewDescription("");
      setNewStrategyAName("");
      setNewStrategyADesc("");
      setNewStrategyBName("");
      setNewStrategyBDesc("");
      setIsCreating(false);
      toast.success(`Experiment "${exp.name}" created`);
    }, 600);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Experiments</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Run A/B experiments to optimize AI agent performance.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Experiment
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Beaker className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {experiments.length}
              </p>
              <p className="text-muted-foreground text-sm">Total Experiments</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Play className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {activeCount}
              </p>
              <p className="text-muted-foreground text-sm">Active</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <Trophy className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="font-semibold text-2xl text-foreground">
                {completedCount}
              </p>
              <p className="text-muted-foreground text-sm">Completed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {experiments.map((exp) => {
          const statusCfg = STATUS_CONFIG[exp.status];
          const winner = getWinner(exp);
          const isExpanded = expandedId === exp.id;

          return (
            <Card key={exp.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base">{exp.name}</CardTitle>
                      <Badge variant={statusCfg.variant}>
                        {statusCfg.label}
                      </Badge>
                      {exp.status === "completed" && winner !== "tie" && (
                        <Badge className="text-green-500" variant="outline">
                          <Trophy className="mr-1 h-3 w-3" />
                          {winner === "A"
                            ? exp.strategyA.name
                            : exp.strategyB.name}{" "}
                          wins
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="mt-1">
                      {exp.description}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {exp.status !== "completed" && (
                      <Button
                        onClick={() => handleToggleStatus(exp.id)}
                        size="sm"
                        variant="outline"
                      >
                        {exp.status === "active" ? (
                          <>
                            <Pause className="mr-1 h-3 w-3" />
                            Pause
                          </>
                        ) : (
                          <>
                            <Play className="mr-1 h-3 w-3" />
                            Resume
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      onClick={() => setExpandedId(isExpanded ? null : exp.id)}
                      size="sm"
                      variant="ghost"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div
                    className={`rounded-lg border p-4 ${
                      winner === "A" ? "border-green-500/30 bg-green-500/5" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">
                        Strategy A: {exp.strategyA.name}
                      </p>
                      {winner === "A" && (
                        <Trophy className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                    <p className="mt-1 text-muted-foreground text-xs">
                      {exp.strategyA.description}
                    </p>
                    <Separator className="my-3" />
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="font-bold text-foreground text-xl">
                          {winRate(exp.strategyA.wins, exp.strategyA.trials)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Win Rate
                        </p>
                      </div>
                      <div>
                        <p className="font-bold text-foreground text-xl">
                          {exp.strategyA.wins}/{exp.strategyA.trials}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Wins / Trials
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`rounded-lg border p-4 ${
                      winner === "B" ? "border-green-500/30 bg-green-500/5" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">
                        Strategy B: {exp.strategyB.name}
                      </p>
                      {winner === "B" && (
                        <Trophy className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                    <p className="mt-1 text-muted-foreground text-xs">
                      {exp.strategyB.description}
                    </p>
                    <Separator className="my-3" />
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="font-bold text-foreground text-xl">
                          {winRate(exp.strategyB.wins, exp.strategyB.trials)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Win Rate
                        </p>
                      </div>
                      <div>
                        <p className="font-bold text-foreground text-xl">
                          {exp.strategyB.wins}/{exp.strategyB.trials}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Wins / Trials
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-4">
                    <Separator />
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="rounded-lg bg-muted p-3">
                        <p className="text-muted-foreground text-xs">
                          Total Trials
                        </p>
                        <p className="font-semibold text-foreground text-lg">
                          {exp.totalTrials}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted p-3">
                        <p className="text-muted-foreground text-xs">
                          Created By
                        </p>
                        <p className="font-medium text-foreground text-sm">
                          {exp.createdBy}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted p-3">
                        <p className="text-muted-foreground text-xs">Started</p>
                        <p className="font-medium text-foreground text-sm">
                          {formatDate(exp.createdAt)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted p-3">
                        <p className="text-muted-foreground text-xs">
                          Confidence
                        </p>
                        <p className="font-medium text-foreground text-sm">
                          {getConfidenceLabel(exp.totalTrials)}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 font-medium text-sm">
                        Head-to-Head Comparison
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="w-32 text-right text-sm">
                          {exp.strategyA.name}
                        </span>
                        <div className="h-6 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="flex h-full">
                            <div
                              className="bg-blue-500 transition-all"
                              style={{
                                width: `${(exp.strategyA.wins / (exp.strategyA.wins + exp.strategyB.wins)) * 100}%`,
                              }}
                            />
                            <div
                              className="bg-purple-500 transition-all"
                              style={{
                                width: `${(exp.strategyB.wins / (exp.strategyA.wins + exp.strategyB.wins)) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                        <span className="w-32 text-sm">
                          {exp.strategyB.name}
                        </span>
                      </div>
                      <div className="mt-1 flex justify-between px-32">
                        <span className="font-mono text-blue-500 text-xs">
                          {winRate(exp.strategyA.wins, exp.strategyA.trials)}
                        </span>
                        <span className="font-mono text-purple-500 text-xs">
                          {winRate(exp.strategyB.wins, exp.strategyB.trials)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-muted-foreground text-xs">
                    {exp.totalTrials} trials completed | Started{" "}
                    {formatDate(exp.createdAt)} by {exp.createdBy}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog onOpenChange={setCreateDialogOpen} open={createDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Experiment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="exp-name">Experiment Name</Label>
              <Input
                className="mt-1.5"
                id="exp-name"
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Model Comparison: Claude vs GPT"
                value={newName}
              />
            </div>
            <div>
              <Label htmlFor="exp-desc">Description</Label>
              <Input
                className="mt-1.5"
                id="exp-desc"
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What are you testing?"
                value={newDescription}
              />
            </div>
            <Separator />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <p className="font-medium text-sm">Strategy A</p>
                <div>
                  <Label htmlFor="exp-a-name">Name</Label>
                  <Input
                    className="mt-1"
                    id="exp-a-name"
                    onChange={(e) => setNewStrategyAName(e.target.value)}
                    placeholder="e.g., Claude Sonnet"
                    value={newStrategyAName}
                  />
                </div>
                <div>
                  <Label htmlFor="exp-a-desc">Description</Label>
                  <Input
                    className="mt-1"
                    id="exp-a-desc"
                    onChange={(e) => setNewStrategyADesc(e.target.value)}
                    placeholder="Describe the strategy"
                    value={newStrategyADesc}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <p className="font-medium text-sm">Strategy B</p>
                <div>
                  <Label htmlFor="exp-b-name">Name</Label>
                  <Input
                    className="mt-1"
                    id="exp-b-name"
                    onChange={(e) => setNewStrategyBName(e.target.value)}
                    placeholder="e.g., GPT-4o"
                    value={newStrategyBName}
                  />
                </div>
                <div>
                  <Label htmlFor="exp-b-desc">Description</Label>
                  <Input
                    className="mt-1"
                    id="exp-b-desc"
                    onChange={(e) => setNewStrategyBDesc(e.target.value)}
                    placeholder="Describe the strategy"
                    value={newStrategyBDesc}
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setCreateDialogOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  isCreating ||
                  !newName.trim() ||
                  !newStrategyAName.trim() ||
                  !newStrategyBName.trim()
                }
                onClick={handleCreate}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Experiment"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
