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
  // Canonical agent streaming events (GAP-P0-08)
  AGENT_THINKING: "agent:thinking",
  AGENT_TERMINAL: "agent:terminal",
  AGENT_FILE_CHANGE: "agent:file-change",
  AGENT_PROGRESS: "agent:progress",
  TASK_COMPLETE: "task:complete",
  TASK_CREATED: "task:created",
  SESSION_CHECKPOINT: "session:checkpoint",
  SESSION_ERROR: "session:error",
  TASK_PROGRESS: "task_progress",
  VISUAL_REGRESSION: "visual_regression",
} as const;

export type QueueEvent = (typeof QueueEvents)[keyof typeof QueueEvents];
