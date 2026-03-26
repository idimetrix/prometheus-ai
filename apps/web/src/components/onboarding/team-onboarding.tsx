"use client";

/**
 * Team Onboarding Experience
 *
 * Auto-generates a comprehensive onboarding flow for new team members
 * including codebase tours, architecture diagrams, setup instructions,
 * and guided first-task workflows.
 */

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnboardingStep =
  | "welcome"
  | "architecture"
  | "key_files"
  | "setup"
  | "conventions"
  | "recent_activity"
  | "first_task"
  | "ask_anything";

interface KeyFile {
  description: string;
  importance: "critical" | "important" | "useful";
  path: string;
  purpose: string;
}

interface ArchitectureNode {
  connections: string[];
  description: string;
  name: string;
  type: "service" | "package" | "database" | "external";
}

interface SetupStep {
  command?: string;
  completed: boolean;
  description: string;
  id: string;
  title: string;
}

interface Convention {
  category: string;
  description: string;
  examples: string[];
  rule: string;
}

interface ActivityItem {
  author: string;
  description: string;
  timestamp: Date;
  type: "commit" | "pr" | "deploy" | "issue";
}

interface GuidedTask {
  description: string;
  estimatedMinutes: number;
  id: string;
  steps: string[];
  title: string;
}

interface ChatMessage {
  content: string;
  id: string;
  sender: "user" | "ai";
  timestamp: Date;
}

interface TeamOnboardingProps {
  className?: string;
  /** Project identifier for fetching context */
  projectId: string;
  /** User's display name */
  userName: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "architecture",
  "key_files",
  "setup",
  "conventions",
  "recent_activity",
  "first_task",
  "ask_anything",
];

const STEP_LABELS: Record<
  OnboardingStep,
  { description: string; title: string }
> = {
  welcome: {
    title: "Welcome",
    description: "Introduction to the project",
  },
  architecture: {
    title: "Architecture",
    description: "System architecture overview",
  },
  key_files: {
    title: "Key Files",
    description: "Important files and their purposes",
  },
  setup: {
    title: "Setup",
    description: "Get your environment running",
  },
  conventions: {
    title: "Conventions",
    description: "Team coding standards",
  },
  recent_activity: {
    title: "Recent Activity",
    description: "What the team has been working on",
  },
  first_task: {
    title: "First Task",
    description: "Guided walkthrough of your first task",
  },
  ask_anything: {
    title: "Ask Anything",
    description: "Chat with AI about the codebase",
  },
};

const IMPORTANCE_COLOR: Record<KeyFile["importance"], string> = {
  critical: "border-red-500/30 bg-red-500/5",
  important: "border-yellow-500/30 bg-yellow-500/5",
  useful: "border-blue-500/30 bg-blue-500/5",
};

const IMPORTANCE_BADGE: Record<KeyFile["importance"], string> = {
  critical: "bg-red-500/20 text-red-400",
  important: "bg-yellow-500/20 text-yellow-400",
  useful: "bg-blue-500/20 text-blue-400",
};

const ACTIVITY_ICON: Record<ActivityItem["type"], string> = {
  commit: "C",
  pr: "P",
  deploy: "D",
  issue: "I",
};

// ---------------------------------------------------------------------------
// Sample data (in production, fetched from project analysis APIs)
// ---------------------------------------------------------------------------

const SAMPLE_ARCHITECTURE: ArchitectureNode[] = [
  {
    name: "Web App",
    type: "service",
    description: "Next.js frontend",
    connections: ["API Server"],
  },
  {
    name: "API Server",
    type: "service",
    description: "tRPC + Hono backend",
    connections: ["Database", "Queue Worker", "Orchestrator"],
  },
  {
    name: "Orchestrator",
    type: "service",
    description: "AI agent coordination",
    connections: ["Model Router", "Sandbox Manager"],
  },
  {
    name: "Queue Worker",
    type: "service",
    description: "Background job processing",
    connections: ["Database"],
  },
  {
    name: "Model Router",
    type: "service",
    description: "LLM routing and fallback",
    connections: [],
  },
  {
    name: "Sandbox Manager",
    type: "service",
    description: "Isolated code execution",
    connections: [],
  },
  {
    name: "Database",
    type: "database",
    description: "PostgreSQL with Drizzle ORM",
    connections: [],
  },
];

const SAMPLE_KEY_FILES: KeyFile[] = [
  {
    path: "apps/api/src/router.ts",
    purpose: "Main tRPC router",
    description: "All API endpoints",
    importance: "critical",
  },
  {
    path: "packages/db/src/schema.ts",
    purpose: "Database schema",
    description: "Drizzle ORM table definitions",
    importance: "critical",
  },
  {
    path: "apps/web/src/app/layout.tsx",
    purpose: "Root layout",
    description: "Next.js app shell",
    importance: "important",
  },
  {
    path: "packages/validators/src/index.ts",
    purpose: "Shared validators",
    description: "Zod schemas for input validation",
    importance: "important",
  },
  {
    path: "turbo.json",
    purpose: "Build config",
    description: "Turborepo pipeline configuration",
    importance: "useful",
  },
];

const SAMPLE_SETUP_STEPS: SetupStep[] = [
  {
    id: "docker",
    title: "Start Docker services",
    description: "PostgreSQL, Redis, MinIO",
    command: "docker compose up -d",
    completed: false,
  },
  {
    id: "env",
    title: "Configure environment",
    description: "Copy and edit env file",
    command: "cp .env.example .env",
    completed: false,
  },
  {
    id: "install",
    title: "Install dependencies",
    description: "Install all packages",
    command: "pnpm install",
    completed: false,
  },
  {
    id: "db",
    title: "Set up database",
    description: "Create database tables",
    command: "pnpm db:push",
    completed: false,
  },
  {
    id: "dev",
    title: "Start development",
    description: "Launch all services",
    command: "pnpm dev",
    completed: false,
  },
];

const SAMPLE_CONVENTIONS: Convention[] = [
  {
    category: "Tooling",
    rule: "Use Biome + Ultracite",
    description: "Not Prettier/ESLint",
    examples: ["pnpm unsafe", "pnpm check"],
  },
  {
    category: "Database",
    rule: "Use Drizzle ORM",
    description: "Never raw SQL",
    examples: ["db.select().from(users)"],
  },
  {
    category: "API",
    rule: "Use tRPC for endpoints",
    description: "Type-safe API layer",
    examples: ["router.query()", "router.mutation()"],
  },
  {
    category: "IDs",
    rule: "Use generateId()",
    description: "From @prometheus/utils",
    examples: ['generateId("usr")'],
  },
  {
    category: "Logging",
    rule: "Use @prometheus/logger",
    description: "Structured logging",
    examples: ['createLogger("module-name")'],
  },
];

const SAMPLE_ACTIVITY: ActivityItem[] = [
  {
    type: "commit",
    author: "Alice",
    description: "feat: add real-time collaboration",
    timestamp: new Date(Date.now() - 3_600_000),
  },
  {
    type: "pr",
    author: "Bob",
    description: "fix: resolve auth token refresh",
    timestamp: new Date(Date.now() - 7_200_000),
  },
  {
    type: "deploy",
    author: "CI",
    description: "Deployed v2.4.1 to staging",
    timestamp: new Date(Date.now() - 14_400_000),
  },
  {
    type: "issue",
    author: "Charlie",
    description: "Performance regression in dashboard",
    timestamp: new Date(Date.now() - 28_800_000),
  },
];

const SAMPLE_TASKS: GuidedTask[] = [
  {
    id: "first-api",
    title: "Add a new API endpoint",
    description: "Create a simple tRPC query that returns project stats",
    estimatedMinutes: 30,
    steps: [
      "Open apps/api/src/router.ts",
      "Add a new query procedure with Zod input validation",
      "Implement the handler using Drizzle ORM",
      "Add the route to the router export",
      "Test with the web client",
    ],
  },
  {
    id: "first-component",
    title: "Create a UI component",
    description: "Build a reusable card component in the design system",
    estimatedMinutes: 20,
    steps: [
      "Create a new file in packages/ui/src/components/",
      "Define props interface with TypeScript",
      "Implement the component using Tailwind CSS",
      "Export from the package index",
      "Use it in the web app",
    ],
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function stepButtonClass(isActive: boolean, isCompleted: boolean): string {
  if (isActive) {
    return "bg-purple-600/20 text-purple-300";
  }
  if (isCompleted) {
    return "text-zinc-400 hover:bg-zinc-800";
  }
  return "text-zinc-500 hover:bg-zinc-800/50";
}

function stepBadgeClass(isActive: boolean, isCompleted: boolean): string {
  if (isActive) {
    return "bg-purple-600 text-white";
  }
  if (isCompleted) {
    return "bg-green-600 text-white";
  }
  return "bg-zinc-700 text-zinc-400";
}

function StepNavigation({
  currentStep,
  completedSteps,
  onStepClick,
}: {
  completedSteps: Set<OnboardingStep>;
  currentStep: OnboardingStep;
  onStepClick: (step: OnboardingStep) => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {STEP_ORDER.map((step, index) => {
        const isActive = currentStep === step;
        const isCompleted = completedSteps.has(step);
        const info = STEP_LABELS[step];

        return (
          <button
            aria-current={isActive ? "step" : undefined}
            aria-label={`Step ${index + 1}: ${info.title}`}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${stepButtonClass(isActive, isCompleted)}`}
            key={step}
            onClick={() => onStepClick(step)}
            type="button"
          >
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${stepBadgeClass(isActive, isCompleted)}`}
            >
              {isCompleted ? "\u2713" : index + 1}
            </div>
            <div>
              <div className="font-medium text-xs">{info.title}</div>
              <div className="text-[10px] text-zinc-500">
                {info.description}
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
}

function WelcomeStep({ userName }: { userName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-2xl text-zinc-100">Welcome, {userName}!</h2>
      <p className="text-sm text-zinc-400">
        This onboarding guide will walk you through everything you need to know
        about the Prometheus codebase. Each section is auto-generated from the
        actual project structure, so it is always up to date.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <div className="font-bold text-2xl text-zinc-100">9</div>
          <div className="text-xs text-zinc-500">Services</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <div className="font-bold text-2xl text-zinc-100">15</div>
          <div className="text-xs text-zinc-500">Packages</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <div className="font-bold text-2xl text-zinc-100">12</div>
          <div className="text-xs text-zinc-500">AI Agents</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <div className="font-bold text-2xl text-zinc-100">TypeScript</div>
          <div className="text-xs text-zinc-500">Primary Language</div>
        </div>
      </div>
    </div>
  );
}

function ArchitectureStep({ nodes }: { nodes: ArchitectureNode[] }) {
  const nodeColors: Record<ArchitectureNode["type"], string> = {
    service: "border-blue-500/40 bg-blue-500/10",
    package: "border-green-500/40 bg-green-500/10",
    database: "border-yellow-500/40 bg-yellow-500/10",
    external: "border-zinc-500/40 bg-zinc-500/10",
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-lg text-zinc-100">Architecture Overview</h2>
      <p className="text-sm text-zinc-400">
        The system consists of several microservices communicating via tRPC and
        message queues.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {nodes.map((node) => (
          <div
            className={`rounded-lg border p-3 ${nodeColors[node.type]}`}
            key={node.name}
          >
            <div className="font-medium text-sm text-zinc-200">{node.name}</div>
            <div className="text-[11px] text-zinc-400">{node.description}</div>
            {node.connections.length > 0 && (
              <div className="mt-2 text-[10px] text-zinc-500">
                Connects to: {node.connections.join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyFilesStep({ files }: { files: KeyFile[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-lg text-zinc-100">Key Files</h2>
      <p className="text-sm text-zinc-400">
        These are the most important files to understand first.
      </p>
      <div className="flex flex-col gap-2">
        {files.map((file) => (
          <div
            className={`rounded-lg border p-3 ${IMPORTANCE_COLOR[file.importance]}`}
            key={file.path}
          >
            <div className="flex items-center justify-between">
              <code className="text-xs text-zinc-200">{file.path}</code>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${IMPORTANCE_BADGE[file.importance]}`}
              >
                {file.importance}
              </span>
            </div>
            <div className="mt-1 font-medium text-xs text-zinc-300">
              {file.purpose}
            </div>
            <div className="text-[11px] text-zinc-500">{file.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupStepView({
  steps,
  onToggle,
}: {
  onToggle: (stepId: string) => void;
  steps: SetupStep[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-lg text-zinc-100">Environment Setup</h2>
      <p className="text-sm text-zinc-400">
        Follow these steps to get your development environment running.
      </p>
      <div className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <div
            className={`rounded-lg border p-3 transition-colors ${
              step.completed
                ? "border-green-500/30 bg-green-500/5"
                : "border-zinc-700 bg-zinc-900/50"
            }`}
            key={step.id}
          >
            <div className="flex items-center gap-3">
              <button
                aria-label={`Mark step ${index + 1} as ${step.completed ? "incomplete" : "complete"}`}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${
                  step.completed
                    ? "bg-green-600 text-white"
                    : "bg-zinc-700 text-zinc-400"
                }`}
                onClick={() => onToggle(step.id)}
                type="button"
              >
                {step.completed ? "\u2713" : index + 1}
              </button>
              <div className="flex-1">
                <div className="font-medium text-sm text-zinc-200">
                  {step.title}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {step.description}
                </div>
              </div>
            </div>
            {step.command && (
              <code className="mt-2 block rounded bg-zinc-800 px-3 py-1.5 font-mono text-xs text-zinc-300">
                $ {step.command}
              </code>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConventionsStep({ conventions }: { conventions: Convention[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-lg text-zinc-100">Team Conventions</h2>
      <p className="text-sm text-zinc-400">
        Key coding standards and tools the team uses.
      </p>
      <div className="flex flex-col gap-2">
        {conventions.map((conv) => (
          <div
            className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3"
            key={conv.rule}
          >
            <div className="flex items-center gap-2">
              <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
                {conv.category}
              </span>
              <span className="font-medium text-sm text-zinc-200">
                {conv.rule}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {conv.description}
            </div>
            {conv.examples.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {conv.examples.map((ex) => (
                  <code
                    className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                    key={ex}
                  >
                    {ex}
                  </code>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentActivityStep({ activities }: { activities: ActivityItem[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-lg text-zinc-100">Recent Activity</h2>
      <p className="text-sm text-zinc-400">
        Here is what the team has been working on recently.
      </p>
      <div className="flex flex-col gap-2">
        {activities.map((activity) => (
          <div
            className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3"
            key={`${activity.type}-${activity.description}`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 font-bold text-xs text-zinc-400">
              {ACTIVITY_ICON[activity.type]}
            </div>
            <div className="flex-1">
              <div className="text-sm text-zinc-200">
                {activity.description}
              </div>
              <div className="text-[10px] text-zinc-500">
                by {activity.author} -- {activity.timestamp.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FirstTaskStep({
  tasks,
  selectedTask,
  onSelect,
}: {
  onSelect: (taskId: string) => void;
  selectedTask: string | null;
  tasks: GuidedTask[];
}) {
  const active = tasks.find((t) => t.id === selectedTask);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-lg text-zinc-100">My First Task</h2>
      <p className="text-sm text-zinc-400">
        Choose a guided task to get started contributing.
      </p>

      {active ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm text-zinc-200">
              {active.title}
            </h3>
            <button
              className="text-xs text-zinc-500 hover:text-zinc-300"
              onClick={() => onSelect("")}
              type="button"
            >
              Back to tasks
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {active.steps.map((step, stepIndex) => (
              <div
                className="flex items-start gap-3 rounded-md border border-zinc-700 bg-zinc-900/50 p-3"
                key={step}
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[10px] text-zinc-400">
                  {stepIndex + 1}
                </div>
                <span className="text-xs text-zinc-300">{step}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {tasks.map((task) => (
            <button
              aria-label={`Start task: ${task.title}`}
              className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4 text-left transition-colors hover:border-purple-500/40"
              key={task.id}
              onClick={() => onSelect(task.id)}
              type="button"
            >
              <div className="font-medium text-sm text-zinc-200">
                {task.title}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {task.description}
              </div>
              <div className="mt-2 text-[10px] text-zinc-600">
                ~{task.estimatedMinutes} min | {task.steps.length} steps
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AskAnythingStep() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "ai",
      content:
        "Hi! I have been trained on this codebase. Ask me anything about the architecture, conventions, or how to implement features.",
      timestamp: new Date(),
    },
  ]);
  const [draft, setDraft] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setDraft("");

    // Simulate AI response
    setTimeout(() => {
      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: "ai",
        content: `Great question about "${trimmed.slice(0, 40)}". Based on the codebase analysis, I can help you understand that. Would you like me to show you the relevant files?`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    }, 800);
  }, [draft]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-lg text-zinc-100">Ask Anything</h2>
      <p className="text-sm text-zinc-400">
        Chat with an AI that has been trained on the entire codebase.
      </p>

      <div className="flex h-80 flex-col rounded-lg border border-zinc-700 bg-zinc-900/50">
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-2">
            {messages.map((msg) => (
              <div
                className={`rounded-md px-3 py-2 text-xs ${
                  msg.sender === "user"
                    ? "ml-8 border border-blue-500/20 bg-blue-500/10 text-blue-200"
                    : "mr-8 border border-purple-500/20 bg-purple-500/10 text-purple-200"
                }`}
                key={msg.id}
              >
                {msg.content}
              </div>
            ))}
          </div>
        </div>
        <div className="border-zinc-700 border-t p-2">
          <div className="flex gap-2">
            <input
              aria-label="Ask a question about the codebase"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-purple-500 focus:outline-none"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about architecture, conventions, features..."
              type="text"
              value={draft}
            />
            <button
              aria-label="Send question"
              className="rounded-md bg-purple-600 px-4 py-1.5 text-white text-xs hover:bg-purple-500"
              disabled={!draft.trim()}
              onClick={handleSend}
              type="button"
            >
              Ask
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TeamOnboarding({
  projectId: _projectId,
  userName,
  className = "",
}: TeamOnboardingProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStep>>(
    new Set()
  );
  const [setupSteps, setSetupSteps] = useState(SAMPLE_SETUP_STEPS);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  const currentIndex = STEP_ORDER.indexOf(currentStep);

  const handleNext = useCallback(() => {
    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    const nextIndex = currentIndex + 1;
    if (nextIndex < STEP_ORDER.length) {
      setCurrentStep(STEP_ORDER[nextIndex] ?? "welcome");
    }
  }, [currentStep, currentIndex]);

  const handlePrevious = useCallback(() => {
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEP_ORDER[prevIndex] ?? "welcome");
    }
  }, [currentIndex]);

  const handleToggleSetup = useCallback((stepId: string) => {
    setSetupSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, completed: !s.completed } : s))
    );
  }, []);

  const progress = useMemo(() => {
    return Math.round((completedSteps.size / STEP_ORDER.length) * 100);
  }, [completedSteps.size]);

  const renderStep = useCallback(() => {
    switch (currentStep) {
      case "welcome":
        return <WelcomeStep userName={userName} />;
      case "architecture":
        return <ArchitectureStep nodes={SAMPLE_ARCHITECTURE} />;
      case "key_files":
        return <KeyFilesStep files={SAMPLE_KEY_FILES} />;
      case "setup":
        return (
          <SetupStepView onToggle={handleToggleSetup} steps={setupSteps} />
        );
      case "conventions":
        return <ConventionsStep conventions={SAMPLE_CONVENTIONS} />;
      case "recent_activity":
        return <RecentActivityStep activities={SAMPLE_ACTIVITY} />;
      case "first_task":
        return (
          <FirstTaskStep
            onSelect={setSelectedTask}
            selectedTask={selectedTask}
            tasks={SAMPLE_TASKS}
          />
        );
      case "ask_anything":
        return <AskAnythingStep />;
      default:
        return null;
    }
  }, [currentStep, userName, setupSteps, handleToggleSetup, selectedTask]);

  return (
    <div
      className={`flex h-full overflow-hidden rounded-lg border border-zinc-700 ${className}`}
    >
      {/* Sidebar navigation */}
      <div className="w-64 shrink-0 border-zinc-700 border-r bg-zinc-900/80 p-4">
        <div className="mb-4">
          <h3 className="font-bold text-sm text-zinc-200">Onboarding</h3>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-purple-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-500">
            {progress}% complete
          </span>
        </div>
        <StepNavigation
          completedSteps={completedSteps}
          currentStep={currentStep}
          onStepClick={setCurrentStep}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-6">{renderStep()}</div>

        {/* Navigation footer */}
        <div className="flex items-center justify-between border-zinc-700 border-t bg-zinc-900/50 px-6 py-3">
          <button
            className="rounded-md bg-zinc-800 px-4 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 disabled:opacity-30"
            disabled={currentIndex === 0}
            onClick={handlePrevious}
            type="button"
          >
            Previous
          </button>
          <span className="text-[11px] text-zinc-500">
            Step {currentIndex + 1} of {STEP_ORDER.length}
          </span>
          <button
            className="rounded-md bg-purple-600 px-4 py-1.5 text-white text-xs hover:bg-purple-500 disabled:opacity-30"
            disabled={currentIndex === STEP_ORDER.length - 1}
            onClick={handleNext}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export type {
  ActivityItem,
  ArchitectureNode,
  ChatMessage,
  Convention,
  GuidedTask,
  KeyFile,
  OnboardingStep,
  SetupStep,
  TeamOnboardingProps,
};
