/**
 * Fleet Coordination Workflow
 *
 * Defines the durable workflow for coordinating multiple agents
 * working in parallel on related tasks.
 *
 * TODO: Implement as a Temporal workflow when @temporalio/workflow is available.
 * For now, this module exports the type definitions and interfaces.
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

/**
 * The FleetCoordinationWorkflow type defines the workflow signature.
 *
 * When implemented with Temporal, this would be:
 * ```ts
 * export async function fleetCoordinationWorkflow(
 *   input: FleetCoordinationWorkflowInput
 * ): Promise<FleetCoordinationWorkflowOutput> {
 *   const { tasks, maxParallelAgents, blueprint } = input;
 *
 *   // 1. Compute execution waves based on dependency graph
 *   const waves = topologicalSort(tasks);
 *
 *   // 2. Execute each wave
 *   for (const wave of waves) {
 *     // Run tasks in parallel, up to maxParallelAgents
 *     const results = await Promise.all(
 *       wave.map(task => executeActivity('runFleetAgent', { task, blueprint }))
 *     );
 *
 *     // 3. Check for file conflicts between agents
 *     const conflicts = await executeActivity('detectConflicts', results);
 *     if (conflicts.hasConflicts) {
 *       await executeActivity('resolveConflicts', conflicts);
 *     }
 *   }
 *
 *   // 4. Merge all results and create summary
 *   return aggregateResults(assignments);
 * }
 * ```
 */
export type FleetCoordinationWorkflow = (
  input: FleetCoordinationWorkflowInput
) => Promise<FleetCoordinationWorkflowOutput>;
