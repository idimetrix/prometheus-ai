export const QueueEvents = {
  AGENT_OUTPUT: "agent:output",
  AGENT_STATUS: "agent:status",
  FILE_CHANGE: "file:change",
  PLAN_UPDATE: "plan:update",
  TASK_STATUS: "task:status",
  QUEUE_POSITION: "queue:position",
  CREDIT_UPDATE: "credit:update",
  CHECKPOINT: "checkpoint",
  ERROR: "error",
  REASONING: "reasoning",
  TERMINAL_OUTPUT: "terminal:output",
  BROWSER_SCREENSHOT: "browser:screenshot",
  SESSION_RESUME: "session:resume",
} as const;

export type QueueEvent = (typeof QueueEvents)[keyof typeof QueueEvents];
