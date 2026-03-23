/**
 * Fleet Coordination Workflow — Type Definitions
 *
 * Durable workflow for coordinating multiple agents in parallel
 * with wave-based topological execution, conflict detection, and resolution.
 * Implemented via Inngest durable functions in fleet-coordination.inngest.ts.
 */

export interface FleetTask {
  agentRole: string;
  dependencies: string[];
  estimatedTokens: number;
  id: string;
  priority: number;
  title: string;
}

export interface FleetAgentAssignment {
  agentId: string;
  completedAt?: string;
  result?: FleetTaskResult;
  startedAt?: string;
  status: "pending" | "running" | "completed" | "failed";
  taskId: string;
}

export interface FleetTaskResult {
  error?: string;
  filesChanged: string[];
  output: string;
  success: boolean;
  tokensUsed: { input: number; output: number };
}

export interface ConflictResolution {
  fileConflicts: Array<{
    filePath: string;
    agents: string[];
    resolution: "auto_merge" | "manual" | "priority_wins";
  }>;
  resolved: boolean;
}

export interface FleetCoordinationWorkflowInput {
  blueprint: string;
  maxParallelAgents: number;
  orgId: string;
  projectId: string;
  sessionId: string;
  tasks: FleetTask[];
  userId: string;
}

export interface FleetCoordinationWorkflowOutput {
  assignments: FleetAgentAssignment[];
  conflicts: ConflictResolution | null;
  success: boolean;
  totalCreditsConsumed: number;
  totalTokensUsed: { input: number; output: number };
  wavesExecuted: number;
}

/** Type signature for the fleet coordination workflow. See fleet-coordination.inngest.ts for implementation. */
export type FleetCoordinationWorkflow = (
  input: FleetCoordinationWorkflowInput
) => Promise<FleetCoordinationWorkflowOutput>;
