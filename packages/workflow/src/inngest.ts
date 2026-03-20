import { createLogger } from "@prometheus/logger";
import { Inngest } from "inngest";

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

export interface AgentExecutionCancelledEvent {
  data: {
    reason: string;
    sessionId: string;
    taskId: string;
  };
  name: "prometheus/agent.execution.cancelled";
}

export interface FleetCoordinationCancelledEvent {
  data: {
    reason: string;
    sessionId: string;
  };
  name: "prometheus/fleet.coordination.cancelled";
}

export interface AgentApprovalEvent {
  data: {
    approved: boolean;
    approvedBy: string;
    modifications?: string[];
    taskId: string;
    timestamp: string;
  };
  name: "prometheus/agent.execution.approved";
}

export type PrometheusEvent =
  | AgentExecutionEvent
  | FleetCoordinationEvent
  | StepCompletedEvent
  | FleetAgentCompletedEvent
  | AgentExecutionCancelledEvent
  | FleetCoordinationCancelledEvent
  | AgentApprovalEvent;

/**
 * Real Inngest client for the Prometheus platform.
 *
 * Inngest v4 uses simple event typing via generics.
 * Durable workflow execution with automatic retries, checkpointing,
 * and fan-out capabilities.
 */
export const inngest = new Inngest({
  id: "prometheus",
});

logger.info("Inngest client initialized");

/**
 * Re-export the createFunction helper for convenience.
 * Inngest v4 uses 2-arg form: createFunction(config, handler)
 * where config includes the trigger.
 */
export const createFunction = inngest.createFunction.bind(inngest);

/**
 * Legacy WorkflowStep interface for backwards compatibility.
 */
export interface WorkflowStep {
  run: <T>(id: string, fn: () => T | Promise<T>) => Promise<T>;
  sendEvent: (
    id: string,
    event: { name: string; data: unknown }
  ) => Promise<void>;
  sleep: (id: string, duration: string) => Promise<void>;
  waitForEvent: (
    id: string,
    opts: { event: string; match: string; timeout: string }
  ) => Promise<unknown>;
}

export interface WorkflowContext<E extends PrometheusEvent> {
  event: E;
  step: WorkflowStep;
}

/** Concurrency limits by organization tier */
export const TIER_CONCURRENCY_LIMITS: Record<string, number> = {
  hobby: 1,
  starter: 2,
  pro: 4,
  team: 8,
  studio: 16,
};
