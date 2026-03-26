export {
  type CompressionOptions,
  type CompressionResult,
  ContextCompressor,
  type ContextMessage,
} from "./context-compressor";
export {
  classifyError,
  ErrorCategory,
  type ErrorClassificationContext,
  isOOMError,
  isRateLimitError,
  isSandboxCrashError,
} from "./error-taxonomy";
export {
  createExecutionContext,
  type ExecutionContext,
  type ExecutionOptions,
} from "./execution-context";
export { ExecutionEngine } from "./execution-engine";
export type {
  BaseExecutionEvent,
  CheckpointEvent,
  CompleteEvent,
  ConfidenceEvent,
  CreditUpdateEvent,
  ErrorEvent,
  ExecutionEvent,
  FileChangeEvent,
  SelfReviewEvent,
  TerminalOutputEvent,
  TokenEvent,
  ToolCallEvent,
  ToolResultEvent,
} from "./execution-events";
export type {
  ProgressEvent,
  RecoveryAction,
  WatchdogEvent,
  WatchdogEventListener,
  WatchdogEventType,
} from "./health-watchdog";
export { HealthWatchdog } from "./health-watchdog";
export { HeartbeatMonitor, type StaleCallback } from "./heartbeat";
export {
  type Increment,
  IncrementalGenerator,
  type IncrementalResult,
  type IncrementPlan,
  type IncrementValidation,
} from "./incremental-generator";
export {
  type MultiPassContext,
  MultiPassPipeline,
  type MultiPassResult,
  type MultiPassTask,
  type PassResult,
} from "./multi-pass-pipeline";
export type {
  ErrorRecoveryContext,
  RecoveryAction as RecoveryActionResult,
  RecoveryActionType,
  RecoveryContext,
  RecoveryResult,
  RecoveryStrategyType,
} from "./recovery-strategy";
export { RecoveryStrategy } from "./recovery-strategy";
export type {
  AgentFileChangePayload,
  AgentProgressPayload,
  AgentStreamingEventType,
  AgentTerminalPayload,
  AgentThinkingPayload,
  SessionCheckpointPayload,
  SessionErrorPayload,
  TaskCompletePayload,
  TaskCreatedPayload,
} from "./session-event-emitter";
export {
  mapExecutionEventToStreamingEvent,
  SessionEventEmitter,
} from "./session-event-emitter";
export type { ApprovalResult, ApprovalTier } from "./tool-approval";
export { ToolApprovalGate } from "./tool-approval";
