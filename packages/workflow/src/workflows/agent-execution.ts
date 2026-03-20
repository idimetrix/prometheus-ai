/**
 * Agent Execution Workflow — Type Definitions
 *
 * Durable workflow for: Discover -> Architect -> Plan -> Approve -> Code -> Test -> CI -> Security -> Review -> Deploy
 * Implemented via Inngest durable functions in agent-execution.inngest.ts.
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

/** Type signature for the agent execution workflow. See agent-execution.inngest.ts for implementation. */
export type AgentExecutionWorkflow = (
  input: AgentExecutionWorkflowInput
) => Promise<AgentExecutionWorkflowOutput>;
