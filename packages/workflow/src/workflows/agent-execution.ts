/**
 * Agent Execution Workflow
 *
 * Defines the durable workflow for: Plan -> Approve -> Execute -> Review -> PR
 *
 * TODO: Implement as a Temporal workflow when @temporalio/workflow is available.
 * For now, this module exports the type definitions and interfaces.
 */

export interface PlanStep {
  agentRole: string;
  description: string;
  estimatedTokens: number;
  id: string;
  title: string;
}

export interface ApprovalResult {
  approved: boolean;
  approvedBy: string;
  modifications?: string[];
  timestamp: string;
}

export interface ExecutionResult {
  error?: string;
  filesChanged: string[];
  output: string;
  stepId: string;
  success: boolean;
  tokensUsed: { input: number; output: number };
}

export interface ReviewResult {
  comments: string[];
  passed: boolean;
  reviewer: string;
  suggestedFixes?: string[];
}

export interface PRResult {
  branch: string;
  number: number;
  title: string;
  url: string;
}

export interface AgentExecutionWorkflowInput {
  agentRole?: string;
  mode: string;
  orgId: string;
  projectId: string;
  sessionId: string;
  taskDescription: string;
  userId: string;
}

export interface AgentExecutionWorkflowOutput {
  approval: ApprovalResult | null;
  executions: ExecutionResult[];
  plan: PlanStep[];
  pr: PRResult | null;
  review: ReviewResult | null;
  success: boolean;
  totalCreditsConsumed: number;
  totalTokensUsed: { input: number; output: number };
}

/**
 * The AgentExecutionWorkflow type defines the workflow signature.
 *
 * When implemented with Temporal, this would be:
 * ```ts
 * export async function agentExecutionWorkflow(
 *   input: AgentExecutionWorkflowInput
 * ): Promise<AgentExecutionWorkflowOutput> {
 *   // 1. Plan: Generate execution plan
 *   const plan = await executeActivity('generatePlan', input);
 *
 *   // 2. Approve: Wait for human approval (with timeout)
 *   const approval = await condition(() => approvalReceived, '24h');
 *
 *   // 3. Execute: Run each plan step with an agent
 *   const executions = [];
 *   for (const step of plan) {
 *     const result = await executeActivity('executeStep', step);
 *     executions.push(result);
 *   }
 *
 *   // 4. Review: Run automated code review
 *   const review = await executeActivity('reviewChanges', executions);
 *
 *   // 5. PR: Create pull request if review passes
 *   const pr = review.passed
 *     ? await executeActivity('createPR', executions)
 *     : null;
 *
 *   return { success: true, plan, approval, executions, review, pr };
 * }
 * ```
 */
export type AgentExecutionWorkflow = (
  input: AgentExecutionWorkflowInput
) => Promise<AgentExecutionWorkflowOutput>;
