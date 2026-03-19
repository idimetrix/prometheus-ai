import { createLogger } from "@prometheus/logger";

const logger = createLogger("workflow:inngest");

/**
 * Event type definitions for the Prometheus Inngest integration.
 */
export interface AgentExecutionEvent {
  data: {
    agentRole?: string;
    mode: string;
    orgId: string;
    projectId: string;
    sessionId: string;
    taskDescription: string;
    taskId: string;
    userId: string;
  };
  name: "prometheus/agent.execution.requested";
}

export interface FleetCoordinationEvent {
  data: {
    blueprint: string;
    maxParallelAgents: number;
    orgId: string;
    projectId: string;
    sessionId: string;
    tasks: Array<{
      agentRole: string;
      dependencies: string[];
      estimatedTokens: number;
      id: string;
      priority: number;
      title: string;
    }>;
    userId: string;
  };
  name: "prometheus/fleet.coordination.requested";
}

export interface StepCompletedEvent {
  data: {
    filesChanged: string[];
    output: string;
    phase: string;
    sessionId: string;
    stepId: string;
    success: boolean;
    taskId: string;
    tokensUsed: { input: number; output: number };
  };
  name: "prometheus/agent.step.completed";
}

export interface FleetAgentCompletedEvent {
  data: {
    agentId: string;
    filesChanged: string[];
    output: string;
    sessionId: string;
    success: boolean;
    taskId: string;
    tokensUsed: { input: number; output: number };
  };
  name: "prometheus/fleet.agent.completed";
}

export type PrometheusEvent =
  | AgentExecutionEvent
  | FleetCoordinationEvent
  | StepCompletedEvent
  | FleetAgentCompletedEvent;

/**
 * Step interface for durable workflow execution.
 * When Inngest is installed, replace with the real Inngest step API.
 */
export interface WorkflowStep {
  run: <T>(id: string, fn: () => T | Promise<T>) => Promise<T>;
  sendEvent: (
    id: string,
    event: { name: string; data: unknown }
  ) => Promise<void>;
  waitForEvent: (
    id: string,
    opts: { event: string; match: string; timeout: string }
  ) => Promise<unknown>;
}

export interface WorkflowContext<E extends PrometheusEvent> {
  event: E;
  step: WorkflowStep;
}

/**
 * Inngest client stub for the Prometheus platform.
 *
 * When the inngest package is installed, this can be replaced with
 * the actual Inngest client. For now, provides type-safe function
 * definition that can be wired to any durable execution engine.
 */
export const inngest = {
  createFunction<E extends PrometheusEvent>(
    config: {
      id: string;
      name: string;
      retries?: number;
      concurrency?: Array<{ limit: number; key: string }>;
      cancelOn?: Array<{ event: string; match: string }>;
    },
    trigger: { event: E["name"] },
    handler: (ctx: WorkflowContext<E>) => Promise<unknown>
  ) {
    logger.info(
      { functionId: config.id, trigger: trigger.event },
      "Registered Inngest function"
    );
    return { config, trigger, handler };
  },
};
