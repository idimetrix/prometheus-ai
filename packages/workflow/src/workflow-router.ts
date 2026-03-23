import { createLogger } from "@prometheus/logger";

const logger = createLogger("workflow:router");

/** Task modes that determine which workflow phases to execute */
export type TaskMode =
  | "ask"
  | "full"
  | "simple_fix"
  | "refactor"
  | "test"
  | "review";

/** Phases in the agent execution pipeline */
export type WorkflowPhase =
  | "discovery"
  | "architecture"
  | "planning"
  | "approval"
  | "coding"
  | "testing"
  | "ci"
  | "security"
  | "review"
  | "deploy";

/** Route configuration for a workflow execution */
export interface WorkflowRoute {
  /** Description of why this route was chosen */
  description: string;
  /** Estimated complexity */
  estimatedComplexity: "low" | "medium" | "high";
  /** The task mode that determined this route */
  mode: TaskMode;
  /** Ordered list of phases to execute */
  phases: WorkflowPhase[];
  /** Whether human approval is required */
  requiresApproval: boolean;
}

/** Full pipeline for standard tasks */
const FULL_PHASES: WorkflowPhase[] = [
  "discovery",
  "architecture",
  "planning",
  "approval",
  "coding",
  "testing",
  "ci",
  "security",
  "review",
  "deploy",
];

/** Phase configurations per mode */
const MODE_ROUTES: Record<TaskMode, Omit<WorkflowRoute, "description">> = {
  full: {
    mode: "full",
    phases: FULL_PHASES,
    requiresApproval: true,
    estimatedComplexity: "high",
  },
  ask: {
    mode: "ask",
    phases: ["discovery", "architecture", "planning"],
    requiresApproval: false,
    estimatedComplexity: "low",
  },
  simple_fix: {
    mode: "simple_fix",
    phases: ["planning", "coding", "testing", "ci", "deploy"],
    requiresApproval: false,
    estimatedComplexity: "low",
  },
  refactor: {
    mode: "refactor",
    phases: [
      "discovery",
      "architecture",
      "planning",
      "coding",
      "testing",
      "ci",
      "review",
      "deploy",
    ],
    requiresApproval: true,
    estimatedComplexity: "medium",
  },
  test: {
    mode: "test",
    phases: ["discovery", "planning", "coding", "testing", "ci", "deploy"],
    requiresApproval: false,
    estimatedComplexity: "medium",
  },
  review: {
    mode: "review",
    phases: ["discovery", "architecture", "review"],
    requiresApproval: false,
    estimatedComplexity: "low",
  },
};

/**
 * Route a workflow based on the task mode and description.
 *
 * Determines which phases to execute based on the task mode:
 * - "ask" mode skips coding phase (question/analysis only)
 * - "simple_fix" skips discovery phase (quick bug fixes)
 * - "full" runs all phases
 * - "refactor" runs all but skips security
 * - "test" focuses on test generation
 * - "review" focuses on code review
 */
export function routeWorkflow(
  mode: string,
  taskDescription: string
): WorkflowRoute {
  const taskMode = (mode in MODE_ROUTES ? mode : "full") as TaskMode;

  const route = MODE_ROUTES[taskMode];

  const description = buildRouteDescription(taskMode, taskDescription);

  logger.info(
    {
      mode: taskMode,
      phases: route.phases,
      requiresApproval: route.requiresApproval,
    },
    "Workflow routed"
  );

  return {
    ...route,
    description,
  };
}

function buildRouteDescription(
  mode: TaskMode,
  taskDescription: string
): string {
  const truncated =
    taskDescription.length > 100
      ? `${taskDescription.slice(0, 100)}...`
      : taskDescription;

  switch (mode) {
    case "ask":
      return `Analysis-only workflow for: ${truncated}`;
    case "simple_fix":
      return `Quick fix workflow (skipping discovery): ${truncated}`;
    case "refactor":
      return `Refactoring workflow with approval: ${truncated}`;
    case "test":
      return `Test generation workflow: ${truncated}`;
    case "review":
      return `Code review workflow: ${truncated}`;
    case "full":
      return `Full pipeline workflow: ${truncated}`;
    default:
      return `Workflow for: ${truncated}`;
  }
}
