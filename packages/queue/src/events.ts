export const QueueEvents = {
  AGENT_OUTPUT: "agent_output",
  AGENT_STATUS: "agent_status",
  FILE_CHANGE: "file_change",
  PLAN_UPDATE: "plan_update",
  TASK_STATUS: "task_status",
  QUEUE_POSITION: "queue_position",
  CREDIT_UPDATE: "credit_update",
  CHECKPOINT: "checkpoint",
  ERROR: "error",
  REASONING: "reasoning",
  TERMINAL_OUTPUT: "terminal_output",
  BROWSER_SCREENSHOT: "browser_screenshot",
  SESSION_RESUME: "session_resume",
} as const;

export type QueueEvent = (typeof QueueEvents)[keyof typeof QueueEvents];
