export const AgentRole = {
  ORCHESTRATOR: "orchestrator",
  DISCOVERY: "discovery",
  ARCHITECT: "architect",
  PLANNER: "planner",
  PROJECT_BRAIN: "project_brain",
  FRONTEND_CODER: "frontend_coder",
  BACKEND_CODER: "backend_coder",
  INTEGRATION_CODER: "integration_coder",
  TEST_ENGINEER: "test_engineer",
  CI_LOOP: "ci_loop",
  SECURITY_AUDITOR: "security_auditor",
  DEPLOY_ENGINEER: "deploy_engineer",
  DOCUMENTATION_SPECIALIST: "documentation_specialist",
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const TaskStatus = {
  PENDING: "pending",
  QUEUED: "queued",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const SessionStatus = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const PlanTier = {
  HOBBY: "hobby",
  STARTER: "starter",
  PRO: "pro",
  TEAM: "team",
  STUDIO: "studio",
  ENTERPRISE: "enterprise",
} as const;
export type PlanTier = (typeof PlanTier)[keyof typeof PlanTier];

export const AgentMode = {
  TASK: "task",
  ASK: "ask",
  PLAN: "plan",
  WATCH: "watch",
  FLEET: "fleet",
} as const;
export type AgentMode = (typeof AgentMode)[keyof typeof AgentMode];

export const CreditTransactionType = {
  PURCHASE: "purchase",
  CONSUMPTION: "consumption",
  REFUND: "refund",
  BONUS: "bonus",
  SUBSCRIPTION_GRANT: "subscription_grant",
} as const;
export type CreditTransactionType =
  (typeof CreditTransactionType)[keyof typeof CreditTransactionType];

export const BlueprintEnforcement = {
  STRICT: "strict",
  FLEXIBLE: "flexible",
  ADVISORY: "advisory",
} as const;
export type BlueprintEnforcement =
  (typeof BlueprintEnforcement)[keyof typeof BlueprintEnforcement];

export const AgentAggressiveness = {
  BALANCED: "balanced",
  FULL_AUTO: "full_auto",
  SUPERVISED: "supervised",
} as const;
export type AgentAggressiveness =
  (typeof AgentAggressiveness)[keyof typeof AgentAggressiveness];

export const SessionEventType = {
  AGENT_OUTPUT: "agent_output",
  FILE_CHANGE: "file_change",
  PLAN_UPDATE: "plan_update",
  TASK_STATUS: "task_status",
  TASK_PROGRESS: "task_progress",
  QUEUE_POSITION: "queue_position",
  CREDIT_UPDATE: "credit_update",
  CHECKPOINT: "checkpoint",
  ERROR: "error",
  REASONING: "reasoning",
  TERMINAL_OUTPUT: "terminal_output",
  BROWSER_SCREENSHOT: "browser_screenshot",
  PR_CREATED: "pr_created",
} as const;
export type SessionEventType =
  (typeof SessionEventType)[keyof typeof SessionEventType];
