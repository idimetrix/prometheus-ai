/**
 * Immutable execution context passed into the ExecutionEngine.
 * Contains everything needed to run an agent task without external state.
 */
import type { AgentRole } from "@prometheus/types";

export interface ExecutionOptions {
  /** Maximum iterations before stopping (default: 50) */
  maxIterations?: number;
  /** Max tokens per LLM call */
  maxTokens?: number;
  /** Model slot override */
  slot?: string;
  /** Enable speculative tool execution (default: false) */
  speculate?: boolean;
  /** Temperature override */
  temperature?: number;
  /** Working directory override (for worktree isolation) */
  workDir?: string;
}

export interface ExecutionContext {
  readonly agentRole: AgentRole;
  readonly blueprintContent: string | null;
  readonly options: Readonly<Required<ExecutionOptions>>;
  readonly orgId: string;
  readonly priorSessionContext: string | null;
  readonly projectContext: string | null;
  readonly projectId: string;
  readonly recentCIResults: string | null;
  /** ID of the sandbox container assigned to this execution */
  readonly sandboxId: string;
  /** URL of the sandbox-manager service */
  readonly sandboxManagerUrl: string;
  readonly sessionId: string;
  readonly sprintState: string | null;
  readonly taskDescription: string;
  readonly userId: string;
  readonly workDir: string;
}

const DEFAULT_OPTIONS: Required<ExecutionOptions> = {
  maxIterations: 50,
  speculate: false,
  workDir: "/workspace",
  slot: "default",
  temperature: 0.1,
  maxTokens: 4096,
};

const DEFAULT_SANDBOX_MANAGER_URL = "http://localhost:4006";

export function createExecutionContext(params: {
  sessionId: string;
  projectId: string;
  orgId: string;
  userId: string;
  agentRole: AgentRole;
  taskDescription: string;
  sandboxId: string;
  sandboxManagerUrl?: string;
  options?: ExecutionOptions;
  blueprintContent?: string | null;
  projectContext?: string | null;
  sprintState?: string | null;
  recentCIResults?: string | null;
  priorSessionContext?: string | null;
}): ExecutionContext {
  const mergedOptions: Required<ExecutionOptions> = {
    ...DEFAULT_OPTIONS,
    ...params.options,
  };

  return {
    sessionId: params.sessionId,
    projectId: params.projectId,
    orgId: params.orgId,
    userId: params.userId,
    agentRole: params.agentRole,
    taskDescription: params.taskDescription,
    sandboxId: params.sandboxId,
    sandboxManagerUrl:
      params.sandboxManagerUrl ||
      process.env.SANDBOX_MANAGER_URL ||
      DEFAULT_SANDBOX_MANAGER_URL,
    options: Object.freeze(mergedOptions),
    blueprintContent: params.blueprintContent ?? null,
    projectContext: params.projectContext ?? null,
    sprintState: params.sprintState ?? null,
    recentCIResults: params.recentCIResults ?? null,
    priorSessionContext: params.priorSessionContext ?? null,
    workDir: mergedOptions.workDir,
  };
}
