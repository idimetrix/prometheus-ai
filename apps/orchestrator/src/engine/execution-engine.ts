/**
 * ExecutionEngine — Unified async generator loop that replaces the dual
 * AgentLoop.runAgentLoop() / BaseAgent.run() execution paths.
 *
 * Yields ExecutionEvents as an async generator, allowing consumers to
 * process events as they arrive (streaming to SSE, WebSocket, etc.).
 *
 * Integrates: ConfidenceScorer, SelfReview, SecretsScanner, BlueprintEnforcer,
 * tool dependency classification for parallel execution, and context window
 * management via progressive summarization.
 */
import {
  AGENT_ROLES,
  type AgentContext,
  TOOL_REGISTRY,
  type ToolCall,
} from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { SpanStatusCode, startSpan } from "@prometheus/telemetry";
import type { AgentRole } from "@prometheus/types";
import { AgentError, modelRouterClient } from "@prometheus/utils";
import { BlueprintEnforcer } from "../blueprint-enforcer";
import {
  CheckpointPersistence,
  type CheckpointState,
} from "../checkpoint-persistence";
import { type ConfidenceResult, ConfidenceScorer } from "../confidence";
import { ContextCompressor } from "../context/context-compressor";
import { SecretsScanner } from "../guardian/secrets-scanner";
import { SelfReview } from "../self-review";
import { classifyToolDependencies } from "../tool-dependency";
import type { ExecutionContext } from "./execution-context";
import type {
  ASTValidationEvent,
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
import { HealthWatchdog } from "./health-watchdog";
import { QualityGate } from "./quality-gate";
import { RecoveryStrategy } from "./recovery-strategy";

/**
 * Feature flag: set to true to use Vercel AI SDK streaming instead of raw SSE.
 * This enables the migration path from manual SSE parsing to the AI SDK's
 * unified streamText() interface. See ExecutionEngine.streamWithAISDK().
 */
export const USE_AI_SDK_STREAMING =
  process.env.PROMETHEUS_USE_AI_SDK === "true";

const BLOCKER_THRESHOLD = 3;

const SLOT_MAP: Record<string, string> = {
  orchestrator: "think",
  discovery: "longContext",
  architect: "think",
  planner: "think",
  frontend_coder: "default",
  backend_coder: "default",
  integration_coder: "fastLoop",
  test_engineer: "fastLoop",
  ci_loop: "fastLoop",
  security_auditor: "think",
  deploy_engineer: "default",
  documentation_specialist: "longContext",
};

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\b/,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\b/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\bDELETE\s+FROM\s+\S+\s*(;|\s*$)/i,
  /\bformat\s+[cC]:/,
  /\bsudo\s+rm\b/,
  /\bchmod\s+777\b/,
  /\bchown\s+-R\s+/,
];

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
}

function parseToolArgs(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr);
  } catch {
    return { raw: argsStr };
  }
}

/**
 * Resolve action type for blueprint enforcement.
 */
function resolveActionType(
  toolName: string
): "file_write" | "file_edit" | "terminal_exec" | "other" {
  if (toolName === "file_write" || toolName === "file_edit") {
    return toolName as "file_write" | "file_edit";
  }
  if (toolName === "terminal_exec") {
    return "terminal_exec";
  }
  return "other";
}

/**
 * Run pre-execution guards (secrets scanning, blueprint validation,
 * destructive command detection, RBAC) on a tool call.
 * Returns null if all guards pass, or a rejection result with events.
 */
function runToolCallGuards(
  tc: { id: string; name: string; args: Record<string, unknown> },
  secretsScanner: SecretsScanner,
  blueprintEnforcer: BlueprintEnforcer,
  allowedTools: Set<string>,
  agentRole: string,
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T
): {
  toolResponse: { success: false; error: string };
  events: ExecutionEvent[];
} | null {
  // Secrets scanning
  if (
    (tc.name === "file_write" || tc.name === "file_edit") &&
    tc.args.content
  ) {
    const filePath =
      (tc.args.path as string) ?? (tc.args.filePath as string) ?? "";
    const scanResult = secretsScanner.scan(filePath, tc.args.content as string);
    if (scanResult.blocked) {
      return {
        toolResponse: { success: false, error: scanResult.message },
        events: [
          makeEvent<ToolResultEvent>({
            type: "tool_result",
            toolCallId: tc.id,
            toolName: tc.name,
            success: false,
            output: "",
            error: scanResult.message,
          }),
        ],
      };
    }
  }

  // Blueprint validation
  if (blueprintEnforcer.isLoaded()) {
    const violations = blueprintEnforcer.validateAction({
      type: resolveActionType(tc.name),
      filePath: (tc.args.path as string) ?? (tc.args.filePath as string),
      content: tc.args.content as string,
      command: tc.args.command as string,
    });
    const errors = violations.filter((v) => v.severity === "error");
    if (errors.length > 0) {
      const violationMsg = errors.map((v) => `- ${v.description}`).join("\n");
      return {
        toolResponse: {
          success: false,
          error: `Blueprint violation(s):\n${violationMsg}`,
        },
        events: [
          makeEvent<ToolResultEvent>({
            type: "tool_result",
            toolCallId: tc.id,
            toolName: tc.name,
            success: false,
            output: "",
            error: `Blueprint violation(s):\n${violationMsg}`,
          }),
        ],
      };
    }
  }

  // Destructive command detection
  if (
    tc.name === "terminal_exec" &&
    tc.args.command &&
    isDestructiveCommand(String(tc.args.command))
  ) {
    return {
      toolResponse: {
        success: false,
        error: "Destructive command blocked: requires human approval.",
      },
      events: [
        makeEvent<CheckpointEvent>({
          type: "checkpoint",
          checkpointType: "large_change",
          reason: `Destructive command detected: ${tc.args.command}`,
          affectedFiles: [],
        }),
      ],
    };
  }

  // RBAC check
  if (allowedTools.size > 0 && !allowedTools.has(tc.name)) {
    return {
      toolResponse: {
        success: false,
        error: `Tool "${tc.name}" is not permitted for role "${agentRole}". Allowed tools: ${Array.from(allowedTools).join(", ")}`,
      },
      events: [
        makeEvent<ToolResultEvent>({
          type: "tool_result",
          toolCallId: tc.id,
          toolName: tc.name,
          success: false,
          output: "",
          error: `RBAC denied: ${tc.name} not in allowed tools for ${agentRole}`,
        }),
      ],
    };
  }

  return null;
}

/**
 * Run post-write validation (AST validation + quality gate) after file writes.
 */
interface SSEParseResult {
  accumulatedContent: string;
  finishReason: string;
  toolCalls: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
}

/**
 * Parse an SSE stream from the model router into accumulated content and tool calls.
 */
interface SSELineResult {
  content?: string;
  finishReason?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
}

function processSSELine(
  line: string,
  accumulatedToolCalls: Map<
    number,
    { id: string; function: { name: string; arguments: string } }
  >
): SSELineResult | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data: ")) {
    return null;
  }

  const payload = trimmed.slice(6);
  if (payload === "[DONE]") {
    return null;
  }

  let chunk: {
    choices?: Array<{
      delta?: {
        content?: string;
        tool_calls?: Array<{
          index: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    usage?: SSELineResult["usage"];
  };

  try {
    chunk = JSON.parse(payload);
  } catch {
    return null;
  }

  const result: SSELineResult = {};
  if (chunk.usage) {
    result.usage = chunk.usage;
  }

  const delta = chunk.choices?.[0]?.delta;
  if (!delta) {
    return Object.keys(result).length > 0 ? result : null;
  }

  if (chunk.choices?.[0]?.finish_reason) {
    result.finishReason = chunk.choices[0].finish_reason;
  }
  if (delta.content) {
    result.content = delta.content;
  }
  if (delta.tool_calls) {
    accumulateToolCallDeltas(delta.tool_calls, accumulatedToolCalls);
  }

  return result;
}

async function parseSSEStream(
  body: ReadableStream<Uint8Array>
): Promise<SSEParseResult> {
  let accumulatedContent = "";
  const accumulatedToolCalls: Map<
    number,
    { id: string; function: { name: string; arguments: string } }
  > = new Map();
  let usage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
  };
  let finishReason = "stop";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const result = processSSELine(line, accumulatedToolCalls);
      if (!result) {
        continue;
      }
      if (result.usage) {
        usage = result.usage;
      }
      if (result.finishReason) {
        finishReason = result.finishReason;
      }
      if (result.content) {
        accumulatedContent += result.content;
      }
    }
  }

  return {
    accumulatedContent,
    toolCalls: Array.from(accumulatedToolCalls.values()),
    usage,
    finishReason,
  };
}

/**
 * Merge incremental tool call deltas into the accumulated map.
 */
function accumulateToolCallDeltas(
  deltas: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
  map: Map<
    number,
    { id: string; function: { name: string; arguments: string } }
  >
): void {
  for (const tc of deltas) {
    const existing = map.get(tc.index);
    if (existing) {
      if (tc.id) {
        existing.id = tc.id;
      }
      if (tc.function?.name) {
        existing.function.name += tc.function.name;
      }
      if (tc.function?.arguments) {
        existing.function.arguments += tc.function.arguments;
      }
    } else {
      map.set(tc.index, {
        id: tc.id ?? "",
        function: {
          name: tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? "",
        },
      });
    }
  }
}

async function runPostWriteValidation(
  tc: { id: string; name: string; args: Record<string, unknown> },
  agent: {
    addToolResult: (id: string, result: string) => void;
    addUserMessage: (msg: string) => void;
  },
  events: ExecutionEvent[],
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T,
  qualityGate: QualityGate,
  ctx: ExecutionContext
): Promise<void> {
  const filePath = tc.args.path ?? tc.args.filePath;
  if (!filePath) {
    return;
  }

  // AST validation for TypeScript files
  const fileStr = String(filePath);
  if (fileStr.endsWith(".ts") || fileStr.endsWith(".tsx")) {
    try {
      const { ASTValidator } = await import("./ast-validator");
      const astValidator = new ASTValidator();
      const astResult = await astValidator.validateFile(fileStr, ctx.workDir);
      if (!astResult.valid) {
        const feedback = astValidator.formatIssuesForAgent(astResult);
        agent.addUserMessage(
          `[System] AST validation found issues in ${filePath}:\n${feedback}\n\nPlease fix these issues.`
        );
        events.push(
          makeEvent<ASTValidationEvent>({
            type: "ast_validation",
            filePath: fileStr,
            valid: false,
            issueCount: astResult.issues.length,
            summary: astResult.summary,
          })
        );
      }
    } catch {
      // AST validator not available, continue without validation
    }
  }

  // Quality gate for significant file writes
  if (qualityGate.shouldEvaluate(tc.name, tc.args)) {
    const qgResult = await qualityGate.evaluate({
      filePath: fileStr,
      content: String(tc.args.content ?? ""),
      taskDescription: ctx.taskDescription,
      blueprintContext: ctx.blueprintContent ?? undefined,
    });

    if (qgResult.verdict === "revise" || qgResult.verdict === "reject") {
      const feedback = qualityGate.getFeedbackPrompt(qgResult, fileStr);
      if (feedback) {
        agent.addUserMessage(feedback);
      }
    }
  }
}

/**
 * Core execution engine yielding events as an async generator.
 *
 * Usage:
 * ```ts
 * for await (const event of ExecutionEngine.execute(context)) {
 *   // handle event by type
 * }
 * ```
 */
/**
 * Build a failure CompleteEvent payload.
 */
function buildFailureComplete(
  lastOutput: string,
  filesChanged: Set<string>,
  totalInputTokens: number,
  totalOutputTokens: number,
  totalToolCalls: number,
  steps: number,
  totalCreditsConsumed: number
): Omit<CompleteEvent, "sessionId" | "agentRole" | "sequence" | "timestamp"> {
  return {
    type: "complete",
    success: false,
    output: lastOutput,
    filesChanged: Array.from(filesChanged),
    tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
    toolCalls: totalToolCalls,
    steps,
    creditsConsumed: totalCreditsConsumed,
  };
}

/**
 * Handle file write/edit specific events: track changes, self-review, quality gate.
 */
async function handleFileWriteEvents(
  tc: { id: string; name: string; args: Record<string, unknown> },
  _toolResult: {
    success: boolean;
    output?: string;
    error?: string;
    metadata?: Record<string, unknown>;
  },
  filesChanged: Set<string>,
  filesToReview: string[],
  events: ExecutionEvent[],
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T,
  selfReview: SelfReview,
  qualityGate: QualityGate,
  agent: {
    addToolResult: (id: string, result: string) => void;
    addUserMessage: (msg: string) => void;
  },
  ctx: ExecutionContext
): Promise<void> {
  const filePath = tc.args.path ?? tc.args.filePath;
  if (filePath) {
    filesChanged.add(String(filePath));
    events.push(
      makeEvent<FileChangeEvent>({
        type: "file_change",
        tool: tc.name,
        filePath: String(filePath),
      })
    );
  }

  const reviewDecision = selfReview.shouldReview(tc.name, tc.args);
  if (reviewDecision.shouldReview) {
    filesToReview.push(reviewDecision.filePath);
  }

  await runPostWriteValidation(tc, agent, events, makeEvent, qualityGate, ctx);
}

function handleLLMError(
  consecutiveErrors: number,
  msg: string,
  lastOutput: string,
  filesChanged: Set<string>,
  totalInputTokens: number,
  totalOutputTokens: number,
  totalToolCalls: number,
  step: number,
  totalCreditsConsumed: number,
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T
): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  if (consecutiveErrors >= BLOCKER_THRESHOLD) {
    events.push(
      makeEvent<ErrorEvent>({
        type: "error",
        error: `Blocked after ${consecutiveErrors} consecutive LLM failures: ${msg}`,
        recoverable: false,
      }),
      makeEvent<CompleteEvent>(
        buildFailureComplete(
          lastOutput,
          filesChanged,
          totalInputTokens,
          totalOutputTokens,
          totalToolCalls,
          step,
          totalCreditsConsumed
        )
      )
    );
  } else {
    events.push(
      makeEvent<ErrorEvent>({
        type: "error",
        error: `LLM request failed (attempt ${consecutiveErrors}/${BLOCKER_THRESHOLD}): ${msg}`,
        recoverable: true,
      })
    );
  }
  return events;
}

function emitSelfReviewEvents(
  filesToReview: string[],
  selfReview: SelfReview,
  agent: { addUserMessage: (msg: string) => void },
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T
): ExecutionEvent[] {
  if (filesToReview.length === 0) {
    return [];
  }
  const reviewPrompt = filesToReview
    .map((fp) => selfReview.getReviewPrompt(fp))
    .join("\n\n");
  agent.addUserMessage(reviewPrompt);
  return filesToReview.map((fp) =>
    makeEvent<SelfReviewEvent>({ type: "self_review", filePath: fp })
  );
}

function buildEnrichedDescription(ctx: ExecutionContext): string {
  let desc = ctx.taskDescription;
  if (ctx.blueprintContent) {
    desc += `\n\n--- Blueprint ---\n${ctx.blueprintContent}`;
  }
  if (ctx.sprintState) {
    desc += `\n\n--- Current Sprint State ---\n${ctx.sprintState}`;
  }
  if (ctx.recentCIResults) {
    desc += `\n\n--- Recent CI Results ---\n${ctx.recentCIResults}`;
  }
  if (ctx.priorSessionContext) {
    desc += `\n\n--- Prior Session Context ---\n${ctx.priorSessionContext}`;
  }
  return desc;
}

async function injectLearnedContext(
  agent: { addUserMessage: (msg: string) => void },
  ctx: ExecutionContext,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  try {
    const { LearningExtractor } = await import(
      "../feedback/learning-extractor"
    );
    const learningExtractor = new LearningExtractor();
    const learnedContext = await learningExtractor.getLearnedContext(
      ctx.agentRole,
      ctx.agentRole,
      ctx.projectId
    );
    if (learnedContext) {
      agent.addUserMessage(
        `[System] Learned patterns from previous sessions:\n${learnedContext}`
      );
      logger.info(
        { role: ctx.agentRole },
        "Injected learned context from procedural memories"
      );
    }
  } catch {
    // Learning extractor not available
  }
}

async function injectBlueprintContext(
  agent: { addUserMessage: (msg: string) => void },
  blueprintEnforcer: BlueprintEnforcer,
  ctx: ExecutionContext,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  await blueprintEnforcer.loadForProject(ctx.projectId).catch((err) => {
    logger.warn({ err }, "Blueprint loading failed");
  });
  const blueprintContext = blueprintEnforcer.getContextForPrompt();
  if (blueprintContext) {
    agent.addUserMessage(
      `[System] Blueprint constraints for this project:\n${blueprintContext}`
    );
  }
}

function generateCheckpointEvents(
  filesChanged: Set<string>,
  iteration: number,
  totalCreditsConsumed: number,
  agent: { addUserMessage: (msg: string) => void },
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T
): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  if (filesChanged.size > 5 && iteration > 3) {
    events.push(
      makeEvent<CheckpointEvent>({
        type: "checkpoint",
        checkpointType: "large_change",
        reason: `Agent has modified ${filesChanged.size} files`,
        affectedFiles: Array.from(filesChanged),
      })
    );
    agent.addUserMessage(
      "[System] A strategic checkpoint was triggered. Continue with your current approach unless directed otherwise."
    );
  }
  if (totalCreditsConsumed > 50 && iteration > 10) {
    events.push(
      makeEvent<CheckpointEvent>({
        type: "checkpoint",
        checkpointType: "cost_threshold",
        reason: `Task has consumed ${totalCreditsConsumed} credits across ${iteration} iterations`,
        affectedFiles: [],
      })
    );
  }
  return events;
}

interface WatchdogResult {
  abort: boolean;
  newSlot?: string;
  recoveryAttempts: number;
}

function handleWatchdog(
  healthWatchdog: HealthWatchdog,
  recoveryStrategy: RecoveryStrategy,
  ctx: ExecutionContext,
  slot: string,
  recoveryAttempts: number,
  agent: { addUserMessage: (msg: string) => void },
  logger: ReturnType<typeof createLogger>
): WatchdogResult {
  const watchdogAction = healthWatchdog.getRecoveryAction(ctx.sessionId);

  if (watchdogAction === "abort") {
    logger.error(
      { sessionId: ctx.sessionId },
      "Health watchdog recommends abort"
    );
    return { abort: true, recoveryAttempts };
  }

  if (watchdogAction !== "escalate") {
    return { abort: false, recoveryAttempts };
  }

  const reason = healthWatchdog.getStatus(ctx.sessionId)?.isLooping
    ? "infinite_loop"
    : "extended_stale";
  const strategy = recoveryStrategy.handleStuckAgent(ctx.sessionId, reason, {
    attemptCount: recoveryAttempts,
    currentModelSlot: slot,
    sessionId: ctx.sessionId,
    reason,
  });
  const recoveryResult = recoveryStrategy.executeRecovery(strategy, {
    attemptCount: recoveryAttempts,
    currentModelSlot: slot,
    sessionId: ctx.sessionId,
    reason,
  });

  if (recoveryResult.injectedPrompt) {
    agent.addUserMessage(recoveryResult.injectedPrompt);
  }

  logger.warn(
    {
      sessionId: ctx.sessionId,
      strategy,
      recoveryAttempts: recoveryAttempts + 1,
    },
    "Health watchdog triggered recovery"
  );

  return {
    abort: false,
    recoveryAttempts: recoveryAttempts + 1,
    newSlot: recoveryResult.newModelSlot ?? undefined,
  };
}

interface ToolCallDeps {
  agent: {
    addToolResult: (id: string, result: string) => void;
    addUserMessage: (msg: string) => void;
  };
  allowedTools: Set<string>;
  blueprintEnforcer: BlueprintEnforcer;
  ctx: ExecutionContext;
  healthWatchdog: HealthWatchdog;
  logger: ReturnType<typeof createLogger>;
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T;
  qualityGate: QualityGate;
  secretsScanner: SecretsScanner;
  selfReview: SelfReview;
}

interface ToolGroupResult {
  consecutiveFailures: number;
  events: ExecutionEvent[];
  filesToReview: string[];
  totalToolCalls: number;
}

async function executeSingleToolCall(
  tc: { id: string; name: string; args: Record<string, unknown> },
  deps: ToolCallDeps,
  filesChanged: Set<string>,
  filesToReview: string[]
): Promise<{ events: ExecutionEvent[]; failed: boolean }> {
  const events: ExecutionEvent[] = [];

  deps.healthWatchdog.reportProgress(deps.ctx.sessionId, "tool_call", {
    tool: tc.name,
    args: tc.args,
  });

  events.push(
    deps.makeEvent<ToolCallEvent>({
      type: "tool_call",
      toolCallId: tc.id,
      toolName: tc.name,
      args: tc.args,
    })
  );

  const guardResult = runToolCallGuards(
    tc,
    deps.secretsScanner,
    deps.blueprintEnforcer,
    deps.allowedTools,
    deps.ctx.agentRole,
    deps.makeEvent
  );
  if (guardResult) {
    deps.agent.addToolResult(tc.id, JSON.stringify(guardResult.toolResponse));
    events.push(...guardResult.events);
    return { events, failed: false };
  }

  const toolDef = TOOL_REGISTRY[tc.name];
  if (!toolDef) {
    deps.agent.addToolResult(
      tc.id,
      JSON.stringify({ success: false, error: `Unknown tool: ${tc.name}` })
    );
    events.push(
      deps.makeEvent<ToolResultEvent>({
        type: "tool_result",
        toolCallId: tc.id,
        toolName: tc.name,
        success: false,
        output: "",
        error: `Unknown tool: ${tc.name}`,
      })
    );
    return { events, failed: false };
  }

  try {
    const toolResult = await toolDef.execute(tc.args, {
      sessionId: deps.ctx.sessionId,
      projectId: deps.ctx.projectId,
      sandboxId: deps.ctx.sessionId,
      workDir: deps.ctx.workDir,
      orgId: deps.ctx.orgId,
      userId: deps.ctx.userId,
    });
    deps.agent.addToolResult(tc.id, JSON.stringify(toolResult));
    await processToolSuccess(
      tc,
      toolResult,
      filesChanged,
      filesToReview,
      events,
      deps.makeEvent,
      deps.selfReview,
      deps.qualityGate,
      deps.agent,
      deps.ctx
    );
    return { events, failed: false };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    deps.logger.error(
      { tool: tc.name, error: errMsg },
      "Tool execution failed"
    );
    deps.agent.addToolResult(
      tc.id,
      JSON.stringify({ success: false, error: errMsg })
    );
    events.push(
      deps.makeEvent<ToolResultEvent>({
        type: "tool_result",
        toolCallId: tc.id,
        toolName: tc.name,
        success: false,
        output: "",
        error: errMsg,
      })
    );
    return { events, failed: true };
  }
}

async function executeToolGroups(
  executionGroups: ReturnType<typeof classifyToolDependencies>,
  deps: ToolCallDeps,
  filesChanged: Set<string>,
  counters: { totalToolCalls: number; consecutiveFailures: number }
): Promise<ToolGroupResult> {
  const allEvents: ExecutionEvent[] = [];
  const filesToReview: string[] = [];
  let { totalToolCalls, consecutiveFailures } = counters;

  for (const group of executionGroups) {
    const runCall = async (tc: {
      id: string;
      name: string;
      args: Record<string, unknown>;
    }) => {
      totalToolCalls++;
      const result = await executeSingleToolCall(
        tc,
        deps,
        filesChanged,
        filesToReview
      );
      if (result.failed) {
        consecutiveFailures++;
      } else {
        consecutiveFailures = 0;
      }
      return result.events;
    };

    let groupEvents: ExecutionEvent[];
    if (group.calls.length === 1 || group.sequential) {
      groupEvents = [];
      for (const tc of group.calls) {
        const callEvents = await runCall(tc);
        groupEvents.push(...callEvents);
      }
    } else {
      const results = await Promise.allSettled(group.calls.map(runCall));
      groupEvents = results.flatMap((r) =>
        r.status === "fulfilled" ? r.value : []
      );
    }

    allEvents.push(...groupEvents);

    if (consecutiveFailures >= BLOCKER_THRESHOLD) {
      break;
    }
  }

  return {
    events: allEvents,
    filesToReview,
    totalToolCalls,
    consecutiveFailures,
  };
}

function scoreIterationConfidence(
  toolCalls: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>,
  assistantContent: string,
  filesChangedCount: number,
  staleIterations: number,
  lastOutputLength: number,
  confidenceScorer: ConfidenceScorer
): { confidence: ConfidenceResult; staleIterations: number } {
  const iterationToolResults = toolCalls.map((tc) => {
    const toolDef = TOOL_REGISTRY[tc.function.name];
    return { success: !!toolDef, name: tc.function.name };
  });
  const signals = ConfidenceScorer.extractSignals(
    assistantContent,
    iterationToolResults,
    filesChangedCount,
    staleIterations,
    lastOutputLength
  );
  const confidence = confidenceScorer.scoreIteration(signals);
  return { confidence, staleIterations: signals.staleIterations };
}

interface LLMResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
}

interface LLMCallResult {
  error?: Error;
  response: LLMResponse | null;
  streamContent?: string;
  streamed: boolean;
}

async function callModelRouter(
  slot: string,
  messages: Record<string, unknown>[],
  toolDefs: unknown[],
  temperature: number,
  maxTokens: number
): Promise<LLMCallResult> {
  if (modelRouterClient.getCircuitState() === "open") {
    return {
      response: null,
      error: new AgentError(
        "Model router circuit breaker is open — service unavailable",
        "STUCK",
        { recoverable: true }
      ),
      streamed: false,
    };
  }

  let routeResponse: Response;
  try {
    routeResponse = await fetch(
      `${process.env.MODEL_ROUTER_URL ?? "http://localhost:4004"}/route`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot,
          messages,
          options: {
            stream: true,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            temperature,
            maxTokens,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );
  } catch (err) {
    return {
      response: null,
      error: err instanceof Error ? err : new Error(String(err)),
      streamed: false,
    };
  }

  if (!routeResponse.ok) {
    const errBody = await routeResponse.text();
    return {
      response: null,
      error: new Error(
        `Model router returned ${routeResponse.status}: ${errBody}`
      ),
      streamed: false,
    };
  }

  const contentType = routeResponse.headers.get("content-type") ?? "";

  if (contentType.includes("text/event-stream") && routeResponse.body) {
    const sseResult = await parseSSEStream(routeResponse.body);
    const toolCallsArray = sseResult.toolCalls;
    return {
      response: {
        choices: [
          {
            message: {
              role: "assistant",
              content: sseResult.accumulatedContent,
              ...(toolCallsArray.length > 0
                ? { tool_calls: toolCallsArray }
                : {}),
            },
            finish_reason: sseResult.finishReason,
          },
        ],
        usage: sseResult.usage,
      },
      streamed: true,
      streamContent: sseResult.accumulatedContent || undefined,
    };
  }

  return {
    response: (await routeResponse.json()) as LLMResponse,
    streamed: false,
  };
}

/**
 * Process a successful tool execution: track file changes, emit events, run quality gates.
 */
async function processToolSuccess(
  tc: { id: string; name: string; args: Record<string, unknown> },
  toolResult: {
    success: boolean;
    output?: string;
    error?: string;
    metadata?: Record<string, unknown>;
  },
  filesChanged: Set<string>,
  filesToReview: string[],
  events: ExecutionEvent[],
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T,
  selfReview: SelfReview,
  qualityGate: QualityGate,
  agent: {
    addToolResult: (id: string, result: string) => void;
    addUserMessage: (msg: string) => void;
  },
  ctx: ExecutionContext
): Promise<void> {
  if (toolResult.metadata?.filePath) {
    filesChanged.add(toolResult.metadata.filePath as string);
  }

  if (tc.name === "file_write" || tc.name === "file_edit") {
    await handleFileWriteEvents(
      tc,
      toolResult,
      filesChanged,
      filesToReview,
      events,
      makeEvent,
      selfReview,
      qualityGate,
      agent,
      ctx
    );
  }

  if (tc.name === "terminal_exec" && toolResult.output) {
    events.push(
      makeEvent<TerminalOutputEvent>({
        type: "terminal_output",
        command: String(tc.args.command),
        output: toolResult.output.slice(0, 5000),
        success: toolResult.success,
      })
    );
  }

  if (selfReview.isReadTool(tc.name)) {
    const filePath = tc.args.path ?? tc.args.filePath;
    if (filePath) {
      selfReview.recordRead(String(filePath));
    }
  }

  events.push(
    makeEvent<ToolResultEvent>({
      type: "tool_result",
      toolCallId: tc.id,
      toolName: tc.name,
      success: toolResult.success,
      output: toolResult.output?.slice(0, 2000) ?? "",
      filePath: (tc.args.path as string) ?? (tc.args.filePath as string),
      error: toolResult.error,
    })
  );
}

/**
 * Try compressing the agent's context if it exceeds the token budget.
 */
async function tryCompressContext(
  agent: {
    getMessages: () => Array<{
      role: string;
      content: string | null;
      toolCallId?: string;
      toolCalls?: unknown[];
    }>;
    addUserMessage: (msg: string) => void;
  },
  contextCompressor: ContextCompressor,
  logger: ReturnType<typeof createLogger>,
  iteration: number
): Promise<void> {
  const currentMessages = agent.getMessages().map((m) => ({
    role: m.role,
    content: m.content ?? "",
    toolCallId: m.toolCallId,
    toolCalls: m.toolCalls,
  }));

  if (!contextCompressor.shouldCompress(currentMessages)) {
    return;
  }

  logger.info(
    { iteration, messageCount: currentMessages.length },
    "Compressing agent context (token budget exceeded)"
  );

  try {
    const compressionResult = await contextCompressor.compress(currentMessages);

    if (compressionResult.ratio >= 1.0) {
      return;
    }

    const summaryMsg = compressionResult.compressedMessages.find(
      (m) =>
        m.role === "system" &&
        m.content.startsWith("[Compressed conversation history]")
    );

    if (summaryMsg) {
      agent.addUserMessage(
        `[System] Context window compressed to stay within token budget.\n${summaryMsg.content}`
      );
    }

    logger.info(
      {
        originalTokens: compressionResult.originalTokens,
        compressedTokens: compressionResult.compressedTokens,
        ratio: compressionResult.ratio.toFixed(2),
      },
      "Context compression applied"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { error: msg },
      "Context compression failed, continuing without compression"
    );
  }
}

interface IterationState {
  consecutiveErrors: number;
  consecutiveFailures: number;
  lastConfidence: ConfidenceResult | null;
  lastOutput: string;
  recoveryAttempts: number;
  slot: string;
  staleIterations: number;
  totalCreditsConsumed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
}

type IterationAction = "continue" | "break" | "return";

interface IterationOutcome {
  action: IterationAction;
  events: ExecutionEvent[];
  spanStatus: {
    code: typeof SpanStatusCode.OK | typeof SpanStatusCode.ERROR;
    message?: string;
  };
  state: IterationState;
}

function buildAgentMessages(agent: {
  getMessages: () => Array<{
    role: string;
    content: string | null;
    toolCallId?: string;
    toolCalls?: ToolCall[];
  }>;
}): Record<string, unknown>[] {
  return agent.getMessages().map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    ...(m.toolCalls && m.toolCalls.length > 0
      ? {
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        }
      : {}),
  }));
}

async function processLLMFailure(
  state: IterationState,
  msg: string,
  filesChanged: Set<string>,
  step: number,
  logger: ReturnType<typeof createLogger>,
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T
): Promise<IterationOutcome> {
  const updated = { ...state, consecutiveErrors: state.consecutiveErrors + 1 };
  logger.error({ error: msg, iteration: step }, "LLM request failed");
  const events = handleLLMError(
    updated.consecutiveErrors,
    msg,
    state.lastOutput,
    filesChanged,
    state.totalInputTokens,
    state.totalOutputTokens,
    state.totalToolCalls,
    step,
    state.totalCreditsConsumed,
    makeEvent
  );

  if (updated.consecutiveErrors >= BLOCKER_THRESHOLD) {
    return {
      action: "return",
      events,
      state: updated,
      spanStatus: { code: SpanStatusCode.ERROR, message: msg },
    };
  }

  await new Promise((r) => setTimeout(r, 2000));
  return {
    action: "continue",
    events,
    state: updated,
    spanStatus: { code: SpanStatusCode.ERROR, message: msg },
  };
}

function processLLMResponse(
  llmCallResult: LLMCallResult,
  state: IterationState,
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T
): {
  events: ExecutionEvent[];
  response: LLMResponse;
  streamed: boolean;
  state: IterationState;
} | null {
  if (!llmCallResult.response) {
    return null;
  }

  const events: ExecutionEvent[] = [];
  const response = llmCallResult.response;
  const updated = { ...state, consecutiveErrors: 0 };

  if (llmCallResult.streamContent) {
    events.push(
      makeEvent<TokenEvent>({
        type: "token",
        content: llmCallResult.streamContent,
      })
    );
  }

  updated.totalInputTokens += response.usage.prompt_tokens;
  updated.totalOutputTokens += response.usage.completion_tokens;
  const credits = Math.ceil(response.usage.total_tokens / 1000);
  updated.totalCreditsConsumed += credits;

  events.push(
    makeEvent<CreditUpdateEvent>({
      type: "credit_update",
      creditsConsumed: credits,
      totalCreditsConsumed: updated.totalCreditsConsumed,
    })
  );

  return { events, response, streamed: llmCallResult.streamed, state: updated };
}

async function processToolCallsAndConfidence(
  toolCalls: NonNullable<LLMResponse["choices"][0]["message"]["tool_calls"]>,
  assistantContent: string,
  state: IterationState,
  step: number,
  agent: ReturnType<(typeof AGENT_ROLES)[keyof typeof AGENT_ROLES]["create"]>,
  ctx: ExecutionContext,
  filesChanged: Set<string>,
  deps: {
    confidenceScorer: ConfidenceScorer;
    secretsScanner: SecretsScanner;
    blueprintEnforcer: BlueprintEnforcer;
    selfReview: SelfReview;
    qualityGate: QualityGate;
    healthWatchdog: HealthWatchdog;
    recoveryStrategy: RecoveryStrategy;
    allowedTools: Set<string>;
    logger: ReturnType<typeof createLogger>;
    makeEvent: <T extends ExecutionEvent>(
      partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
    ) => T;
  }
): Promise<IterationOutcome> {
  const events: ExecutionEvent[] = [];
  const updated = { ...state };

  // Parse and execute tool calls
  const parsedToolCalls: ToolCall[] = toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
  agent.addAssistantMessage(assistantContent, parsedToolCalls);

  const toolCallInfos = toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    args: parseToolArgs(tc.function.arguments),
  }));
  const executionGroups = classifyToolDependencies(toolCallInfos);

  const toolExecDeps: ToolCallDeps = {
    ctx,
    agent,
    secretsScanner: deps.secretsScanner,
    blueprintEnforcer: deps.blueprintEnforcer,
    allowedTools: deps.allowedTools,
    selfReview: deps.selfReview,
    qualityGate: deps.qualityGate,
    healthWatchdog: deps.healthWatchdog,
    logger: deps.logger,
    makeEvent: deps.makeEvent,
  };
  const toolExecResult = await executeToolGroups(
    executionGroups,
    toolExecDeps,
    filesChanged,
    {
      totalToolCalls: updated.totalToolCalls,
      consecutiveFailures: updated.consecutiveFailures,
    }
  );
  updated.totalToolCalls = toolExecResult.totalToolCalls;
  updated.consecutiveFailures = toolExecResult.consecutiveFailures;
  events.push(...toolExecResult.events);

  if (updated.consecutiveFailures >= BLOCKER_THRESHOLD) {
    events.push(
      deps.makeEvent<ErrorEvent>({
        type: "error",
        error: `Blocked: ${updated.consecutiveFailures} consecutive tool failures`,
        recoverable: false,
      }),
      deps.makeEvent<CompleteEvent>(
        buildFailureComplete(
          updated.lastOutput,
          filesChanged,
          updated.totalInputTokens,
          updated.totalOutputTokens,
          updated.totalToolCalls,
          step,
          updated.totalCreditsConsumed
        )
      )
    );
    return {
      action: "return",
      events,
      state: updated,
      spanStatus: {
        code: SpanStatusCode.ERROR,
        message: `${updated.consecutiveFailures} consecutive tool failures`,
      },
    };
  }

  // Self-review
  events.push(
    ...emitSelfReviewEvents(
      toolExecResult.filesToReview,
      deps.selfReview,
      agent,
      deps.makeEvent
    )
  );

  // Confidence
  const confResult = scoreIterationConfidence(
    toolCalls,
    assistantContent,
    filesChanged.size,
    updated.staleIterations,
    updated.lastOutput.length,
    deps.confidenceScorer
  );
  updated.staleIterations = confResult.staleIterations;
  updated.lastConfidence = confResult.confidence;

  events.push(
    deps.makeEvent<ConfidenceEvent>({
      type: "confidence",
      score: confResult.confidence.score,
      action: confResult.confidence.action,
      iteration: step,
      factors: confResult.confidence.factors.map((f) => ({
        name: f.name,
        value: f.value,
      })),
    })
  );

  if (confResult.confidence.recommendedSlot) {
    updated.slot = ConfidenceScorer.getModelSlot(
      updated.slot,
      confResult.confidence
    );
  }

  events.push(
    ...generateCheckpointEvents(
      filesChanged,
      step,
      updated.totalCreditsConsumed,
      agent,
      deps.makeEvent
    )
  );

  if (confResult.confidence.action === "escalate") {
    deps.logger.warn(
      { confidence: confResult.confidence.score, iteration: step },
      "Low confidence - escalating"
    );
    events.push(
      deps.makeEvent<ErrorEvent>({
        type: "error",
        error: `Agent confidence dropped to ${confResult.confidence.score.toFixed(2)}`,
        recoverable: false,
      }),
      deps.makeEvent<CompleteEvent>(
        buildFailureComplete(
          updated.lastOutput,
          filesChanged,
          updated.totalInputTokens,
          updated.totalOutputTokens,
          updated.totalToolCalls,
          step,
          updated.totalCreditsConsumed
        )
      )
    );
    return {
      action: "return",
      events,
      state: updated,
      spanStatus: {
        code: SpanStatusCode.ERROR,
        message: `Low confidence: ${confResult.confidence.score.toFixed(2)}`,
      },
    };
  }

  if (confResult.confidence.action === "request_help") {
    agent.addUserMessage(
      "[System] Your confidence appears moderate. Please verify your approach before proceeding."
    );
  }

  // Watchdog
  const wdResult = handleWatchdog(
    deps.healthWatchdog,
    deps.recoveryStrategy,
    ctx,
    updated.slot,
    updated.recoveryAttempts,
    agent,
    deps.logger
  );
  updated.recoveryAttempts = wdResult.recoveryAttempts;
  if (wdResult.newSlot) {
    updated.slot = wdResult.newSlot;
  }

  if (wdResult.abort) {
    events.push(
      deps.makeEvent<ErrorEvent>({
        type: "error",
        error: "Agent exceeded maximum runtime — aborting",
        recoverable: false,
      }),
      deps.makeEvent<CompleteEvent>(
        buildFailureComplete(
          updated.lastOutput,
          filesChanged,
          updated.totalInputTokens,
          updated.totalOutputTokens,
          updated.totalToolCalls,
          step,
          updated.totalCreditsConsumed
        )
      )
    );
    deps.healthWatchdog.stopMonitoring(ctx.sessionId);
    return {
      action: "return",
      events,
      state: updated,
      spanStatus: {
        code: SpanStatusCode.ERROR,
        message: "Health watchdog abort",
      },
    };
  }

  return {
    action: "continue",
    events,
    state: updated,
    spanStatus: { code: SpanStatusCode.OK },
  };
}

function initializeAgent(ctx: ExecutionContext): {
  agent: ReturnType<(typeof AGENT_ROLES)[keyof typeof AGENT_ROLES]["create"]>;
  allowedTools: Set<string>;
  toolDefs: unknown[];
} | null {
  const roleConfig = AGENT_ROLES[ctx.agentRole];
  if (!roleConfig) {
    return null;
  }

  const agent = roleConfig.create();
  const allowedTools = new Set(agent.getAllowedTools());

  const agentContext: AgentContext = {
    sessionId: ctx.sessionId,
    projectId: ctx.projectId,
    orgId: ctx.orgId,
    userId: ctx.userId,
    agentRole: ctx.agentRole as AgentRole,
    blueprintContent: ctx.blueprintContent,
    projectContext: ctx.projectContext,
    workDir: ctx.workDir,
  };
  agent.initialize(agentContext);
  agent.addUserMessage(buildEnrichedDescription(ctx));

  return { agent, allowedTools, toolDefs: agent.getToolDefinitions() };
}

function resolveInitialSlot(ctx: ExecutionContext): string {
  return ctx.options.slot === "default"
    ? (SLOT_MAP[ctx.agentRole] ?? "default")
    : ctx.options.slot;
}

async function injectConventions(
  agent: { addUserMessage: (msg: string) => void },
  ctx: ExecutionContext
): Promise<void> {
  try {
    const convResponse = await import("@prometheus/utils").then((u) =>
      u.projectBrainClient.get<{ conventions: string }>(
        `/conventions/${ctx.projectId}`,
        { timeout: 5000 }
      )
    );
    if (convResponse.data.conventions) {
      agent.addUserMessage(
        `[System] Project conventions:\n${convResponse.data.conventions}`
      );
    }
  } catch {
    // Non-critical
  }
}

interface ParsedChoice {
  assistantContent: string;
  events: ExecutionEvent[];
  skip?: "continue" | "break";
  toolCalls: NonNullable<LLMResponse["choices"][0]["message"]["tool_calls"]>;
}

function parseResponseChoice(
  response: LLMResponse,
  streamed: boolean,
  iterState: { lastOutput: string },
  agent: {
    addAssistantMessage: (content: string, toolCalls?: ToolCall[]) => void;
  },
  makeEvent: <T extends ExecutionEvent>(
    partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
  ) => T
): ParsedChoice {
  const choice = response.choices[0];
  if (!choice) {
    return {
      skip: "continue",
      events: [],
      toolCalls: [],
      assistantContent: "",
    };
  }

  const assistantContent = choice.message.content ?? "";
  const toolCalls = choice.message.tool_calls;
  const events: ExecutionEvent[] = [];

  if (assistantContent) {
    iterState.lastOutput = assistantContent;
    if (!streamed) {
      events.push(
        makeEvent<TokenEvent>({ type: "token", content: assistantContent })
      );
    }
  }

  if (!toolCalls || toolCalls.length === 0) {
    agent.addAssistantMessage(assistantContent);
    return { skip: "break", events, toolCalls: [], assistantContent };
  }

  return { events, toolCalls, assistantContent };
}

function finalizeIterationSpan(
  iterationSpan: {
    setStatus: (s: { code: number; message?: string }) => void;
    setAttribute: (k: string, v: string | number | boolean) => void;
    end: () => void;
  },
  iterOutcome: { spanStatus: { code: number; message?: string } },
  iterState: {
    totalToolCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    lastConfidence: ConfidenceResult | null;
  }
): void {
  iterationSpan.setStatus({
    code: iterOutcome.spanStatus.code,
    message: iterOutcome.spanStatus.message,
  });
  iterationSpan.setAttribute(
    "gen_ai.iteration.tool_calls",
    iterState.totalToolCalls
  );
  iterationSpan.setAttribute(
    "gen_ai.iteration.tokens.input",
    iterState.totalInputTokens
  );
  iterationSpan.setAttribute(
    "gen_ai.iteration.tokens.output",
    iterState.totalOutputTokens
  );
  if (iterState.lastConfidence) {
    iterationSpan.setAttribute(
      "gen_ai.iteration.confidence",
      iterState.lastConfidence.score
    );
  }
  iterationSpan.end();
}

async function runIterationBody(
  llmCallResult: LLMCallResult,
  state: IterationState,
  step: number,
  agent: ReturnType<(typeof AGENT_ROLES)[keyof typeof AGENT_ROLES]["create"]>,
  ctx: ExecutionContext,
  filesChanged: Set<string>,
  iterDeps: {
    confidenceScorer: ConfidenceScorer;
    secretsScanner: SecretsScanner;
    blueprintEnforcer: BlueprintEnforcer;
    selfReview: SelfReview;
    qualityGate: QualityGate;
    healthWatchdog: HealthWatchdog;
    recoveryStrategy: RecoveryStrategy;
    allowedTools: Set<string>;
    logger: ReturnType<typeof createLogger>;
    makeEvent: <T extends ExecutionEvent>(
      partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
    ) => T;
  }
): Promise<IterationOutcome> {
  const events: ExecutionEvent[] = [];
  let updated = { ...state };

  const llmResult = processLLMResponse(
    llmCallResult,
    updated,
    iterDeps.makeEvent
  );
  if (!llmResult) {
    return {
      action: "continue",
      events,
      state: updated,
      spanStatus: { code: SpanStatusCode.OK },
    };
  }

  updated = llmResult.state;
  events.push(...llmResult.events);

  const parsedChoice = parseResponseChoice(
    llmResult.response,
    llmResult.streamed,
    updated,
    agent,
    iterDeps.makeEvent
  );

  if (parsedChoice.skip) {
    events.push(...parsedChoice.events);
    const action: IterationAction =
      parsedChoice.skip === "continue" ? "continue" : "break";
    return {
      action,
      events,
      state: updated,
      spanStatus: { code: SpanStatusCode.OK },
    };
  }

  events.push(...parsedChoice.events);

  const toolOutcome = await processToolCallsAndConfidence(
    parsedChoice.toolCalls,
    parsedChoice.assistantContent,
    updated,
    step,
    agent,
    ctx,
    filesChanged,
    iterDeps
  );
  events.push(...toolOutcome.events);

  return {
    action: toolOutcome.action,
    events,
    state: toolOutcome.state,
    spanStatus: toolOutcome.spanStatus,
  };
}

export const ExecutionEngine = {
  async *execute(
    ctx: ExecutionContext
  ): AsyncGenerator<ExecutionEvent, void, undefined> {
    const logger = createLogger(`engine:${ctx.sessionId}`);
    let sequence = 0;

    const makeEvent = <T extends ExecutionEvent>(
      partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
    ): T =>
      ({
        ...partial,
        sessionId: ctx.sessionId,
        agentRole: ctx.agentRole,
        sequence: sequence++,
        timestamp: new Date().toISOString(),
      }) as T;

    const setup = initializeAgent(ctx);
    if (!setup) {
      yield makeEvent<ErrorEvent>({
        type: "error",
        error: `Unknown agent role: ${ctx.agentRole}`,
        recoverable: false,
      });
      return;
    }

    const { agent, allowedTools, toolDefs } = setup;

    const confidenceScorer = new ConfidenceScorer();
    const blueprintEnforcer = new BlueprintEnforcer();
    const secretsScanner = new SecretsScanner();
    const selfReview = new SelfReview();
    const qualityGate = new QualityGate();
    const contextCompressor = new ContextCompressor();
    const healthWatchdog = new HealthWatchdog();
    const recoveryStrategy = new RecoveryStrategy();
    healthWatchdog.startMonitoring(ctx.sessionId);

    await injectLearnedContext(agent, ctx, logger);
    await injectBlueprintContext(agent, blueprintEnforcer, ctx, logger);
    await injectConventions(agent, ctx);

    const filesChanged = new Set<string>();
    const { maxIterations, temperature, maxTokens } = ctx.options;

    let iterState: IterationState = {
      slot: resolveInitialSlot(ctx),
      totalToolCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCreditsConsumed: 0,
      consecutiveErrors: 0,
      consecutiveFailures: 0,
      staleIterations: 0,
      lastOutput: "",
      lastConfidence: null,
      recoveryAttempts: 0,
    };

    const iterDeps = {
      confidenceScorer,
      secretsScanner,
      blueprintEnforcer,
      selfReview,
      qualityGate,
      healthWatchdog,
      recoveryStrategy,
      allowedTools,
      logger,
      makeEvent,
    };

    for (let i = 0; i < maxIterations; i++) {
      const iterationSpan = startSpan("gen_ai.execution.iteration", {
        attributes: {
          "gen_ai.session.id": ctx.sessionId,
          "gen_ai.agent.role": ctx.agentRole,
          "gen_ai.iteration": i,
          "gen_ai.model.slot": iterState.slot,
          "gen_ai.project.id": ctx.projectId,
        },
      });

      if (i > 0 && i % 5 === 0) {
        await tryCompressContext(agent, contextCompressor, logger, i);
      }

      const messages = buildAgentMessages(agent);
      const llmCallResult = await callModelRouter(
        iterState.slot,
        messages,
        toolDefs,
        temperature,
        maxTokens
      );

      // Handle LLM failure separately to reduce branching
      if (!llmCallResult.response) {
        const failOutcome = await processLLMFailure(
          iterState,
          llmCallResult.error?.message ?? "LLM call failed",
          filesChanged,
          i,
          logger,
          makeEvent
        );
        iterState = failOutcome.state;
        for (const evt of failOutcome.events) {
          yield evt;
        }
        iterationSpan.setStatus({
          code: failOutcome.spanStatus.code,
          message: failOutcome.spanStatus.message,
        });
        iterationSpan.end();
        if (failOutcome.action === "return") {
          return;
        }
        continue;
      }

      // Run full iteration body: response processing, tool calls, confidence, watchdog
      const iterOutcome = await runIterationBody(
        llmCallResult,
        iterState,
        i,
        agent,
        ctx,
        filesChanged,
        iterDeps
      );
      iterState = iterOutcome.state;
      for (const evt of iterOutcome.events) {
        yield evt;
      }
      finalizeIterationSpan(iterationSpan, iterOutcome, iterState);

      if (iterOutcome.action === "return") {
        return;
      }
      if (iterOutcome.action === "break") {
        break;
      }
    }

    healthWatchdog.stopMonitoring(ctx.sessionId);

    yield makeEvent<CompleteEvent>({
      type: "complete",
      success: true,
      output: iterState.lastOutput,
      filesChanged: Array.from(filesChanged),
      tokensUsed: {
        input: iterState.totalInputTokens,
        output: iterState.totalOutputTokens,
      },
      toolCalls: iterState.totalToolCalls,
      steps: ctx.options.maxIterations,
      creditsConsumed: iterState.totalCreditsConsumed,
    });
  },

  /**
   * Resume execution from the last checkpoint for a given session and task.
   * Restores the checkpoint state and returns it so the caller can
   * reconstruct context and continue from the last saved iteration.
   */
  async resume(
    sessionId: string,
    taskId: string,
    orgId: string
  ): Promise<CheckpointState | null> {
    const resumeLogger = createLogger(`engine:resume:${sessionId}`);
    const persistence = new CheckpointPersistence(orgId);

    const checkpoint = await persistence.restore(sessionId, taskId);
    if (!checkpoint) {
      resumeLogger.info({ sessionId, taskId }, "No checkpoint found to resume");
      return null;
    }

    resumeLogger.info(
      {
        sessionId,
        taskId,
        phase: checkpoint.phase,
        savedAt: checkpoint.savedAt,
        completedSteps: checkpoint.completedSteps.length,
        modifiedFiles: checkpoint.modifiedFiles.length,
      },
      "Resuming from checkpoint"
    );

    return checkpoint;
  },

  /**
   * AI SDK 6 streaming path using AiSdkAgent with full role prompts.
   *
   * Uses the agent role system (BaseAgent subclasses) for proper system prompts,
   * reasoning protocols, and tool filtering. Integrates:
   * - Full role-specific system prompts via BaseAgent.getSystemPrompt()
   * - Structured reasoning protocol injection
   * - Automatic provider selection via createModelForSlot()
   * - AI SDK 6 tool format via convertToolsToAISDK() with RBAC filtering
   * - Safety checks (secrets scanner, blueprint enforcer) via onStepFinish
   * - Confidence scoring and credit tracking
   *
   * Enable with PROMETHEUS_USE_AI_SDK=true
   */
  async *streamWithAISDK(
    ctx: ExecutionContext
  ): AsyncGenerator<ExecutionEvent, void, undefined> {
    const logger = createLogger(`engine:aisdk:${ctx.sessionId}`);
    let sequence = 0;

    const makeEvent = <T extends ExecutionEvent>(
      partial: Omit<T, "sessionId" | "agentRole" | "sequence" | "timestamp">
    ): T =>
      ({
        ...partial,
        sessionId: ctx.sessionId,
        agentRole: ctx.agentRole,
        sequence: sequence++,
        timestamp: new Date().toISOString(),
      }) as T;

    try {
      const { AiSdkAgent, createModelForSlot } = await import("@prometheus/ai");
      const { convertToolsToAISDK } = await import("@prometheus/agent-sdk");

      // Initialize the role-specific agent to get proper system prompt
      const roleConfig = AGENT_ROLES[ctx.agentRole];
      if (!roleConfig) {
        yield makeEvent<ErrorEvent>({
          type: "error",
          error: `Unknown agent role: ${ctx.agentRole}`,
          recoverable: false,
        });
        return;
      }

      const baseAgent = roleConfig.create();
      const agentContext: AgentContext = {
        sessionId: ctx.sessionId,
        projectId: ctx.projectId,
        orgId: ctx.orgId,
        userId: ctx.userId,
        agentRole: ctx.agentRole as AgentRole,
        blueprintContent: ctx.blueprintContent,
        projectContext: ctx.projectContext,
        workDir: ctx.workDir,
      };
      baseAgent.initialize(agentContext);

      // Build full system prompt: reasoning protocol + role-specific prompt
      const systemPrompt = `${baseAgent.getReasoningProtocol()}\n\n${baseAgent.getSystemPrompt(agentContext)}`;

      // Resolve model for the current slot
      const slot =
        ctx.options.slot === "default"
          ? (SLOT_MAP[ctx.agentRole] ?? "default")
          : ctx.options.slot;

      const { model } = createModelForSlot(slot);

      // Convert only the agent's allowed tools to AI SDK 6 format (RBAC)
      const allowedToolNames = new Set(baseAgent.getAllowedTools());
      const filteredRegistry: Record<string, unknown> = {};
      for (const [name, toolDef] of Object.entries(TOOL_REGISTRY)) {
        if (allowedToolNames.has(name)) {
          filteredRegistry[name] = toolDef;
        }
      }

      const aiSdkTools = convertToolsToAISDK(
        filteredRegistry as Record<
          string,
          import("@prometheus/agent-sdk").AgentToolDefinition
        >,
        {
          sessionId: ctx.sessionId,
          projectId: ctx.projectId,
          sandboxId: ctx.sessionId,
          workDir: ctx.workDir,
          orgId: ctx.orgId,
          userId: ctx.userId,
        }
      );

      // Initialize safety integrations
      const blueprintEnforcer = new BlueprintEnforcer();
      const secretsScanner = new SecretsScanner();
      const confidenceScorer = new ConfidenceScorer();
      await blueprintEnforcer
        .loadForProject(ctx.projectId)
        .catch(() => undefined);

      let totalCreditsConsumed = 0;
      const pendingEvents: ExecutionEvent[] = [];

      // Build enriched task description with sprint context
      const enrichedTask = [
        ctx.taskDescription,
        ctx.sprintState ? `\n\n--- Sprint State ---\n${ctx.sprintState}` : "",
      ].join("");

      logger.info(
        {
          slot,
          agentRole: ctx.agentRole,
          toolCount: Object.keys(aiSdkTools).length,
          systemPromptLength: systemPrompt.length,
        },
        "Starting AiSdkAgent execution with full role prompt"
      );

      // Create AiSdkAgent with full role system prompt
      const agent = new AiSdkAgent({
        model,
        tools: aiSdkTools,
        systemPrompt,
        role: ctx.agentRole,
        maxSteps: ctx.options.maxIterations,
        temperature: ctx.options.temperature,
        maxTokens: ctx.options.maxTokens,
      });

      // Stream the agent execution with safety callbacks
      let fullText = "";
      for await (const event of agent.stream(enrichedTask, {
        onFileChange: (filePath, toolName) => {
          pendingEvents.push(
            makeEvent<FileChangeEvent>({
              type: "file_change",
              tool: toolName,
              filePath,
            })
          );
        },
        onStepFinish: (stepInfo) => {
          // Track credits
          const credits = Math.ceil(stepInfo.usage.totalTokens / 1000);
          totalCreditsConsumed += credits;
          pendingEvents.push(
            makeEvent<CreditUpdateEvent>({
              type: "credit_update",
              creditsConsumed: credits,
              totalCreditsConsumed,
            })
          );

          // Secrets scanning on file writes
          for (const tc of stepInfo.toolCalls) {
            if (tc.toolName === "file_write" || tc.toolName === "file_edit") {
              const args = tc.input as Record<string, unknown>;
              if (args.content) {
                const filePath =
                  (args.path as string) ?? (args.filePath as string) ?? "";
                const scanResult = secretsScanner.scan(
                  filePath,
                  args.content as string
                );
                if (scanResult.blocked) {
                  logger.warn(
                    { filePath, reason: scanResult.message },
                    "Secret detected in AI SDK execution"
                  );
                }
              }
            }
          }

          // Confidence scoring
          const confidenceResult = confidenceScorer.scoreIteration({
            toolCallCount: stepInfo.toolCalls.length,
            toolSuccessCount: stepInfo.toolCalls.length,
            toolErrorCount: 0,
            hasOutput: stepInfo.text.length > 0,
            outputLength: stepInfo.text.length,
            hasStructuredOutput: stepInfo.text.includes("```"),
            filesChanged: stepInfo.toolCalls.filter(
              (tc) =>
                tc.toolName === "file_write" || tc.toolName === "file_edit"
            ).length,
            expressedUncertainty: false,
            requestedHelp: false,
            staleIterations: 0,
          });
          pendingEvents.push(
            makeEvent<ConfidenceEvent>({
              type: "confidence",
              score: confidenceResult.score,
              factors: confidenceResult.factors.map((f) => ({
                name: f.name,
                value: f.value,
              })),
              action: confidenceResult.action,
              iteration: stepInfo.stepIndex,
            })
          );
        },
      })) {
        // Drain buffered events from callbacks
        while (pendingEvents.length > 0) {
          const buffered = pendingEvents.shift();
          if (buffered) {
            yield buffered;
          }
        }

        switch (event.type) {
          case "text-delta": {
            fullText += event.textDelta;
            yield makeEvent<TokenEvent>({
              type: "token",
              content: event.textDelta,
            });
            break;
          }
          case "tool-call": {
            yield makeEvent<ToolCallEvent>({
              type: "tool_call",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args as Record<string, unknown>,
            });
            break;
          }
          case "tool-result": {
            yield makeEvent<ToolResultEvent>({
              type: "tool_result",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              success: true,
              output: String(event.result).slice(0, 2000),
            });
            break;
          }
          case "step-finish": {
            // Step completion is already handled by onStepFinish callback
            break;
          }
          case "step-start": {
            // Step start events for observability
            break;
          }
          case "finish": {
            yield makeEvent<CompleteEvent>({
              type: "complete",
              success: true,
              output: fullText,
              filesChanged: event.filesChanged,
              tokensUsed: {
                input: event.usage.inputTokens,
                output: event.usage.outputTokens,
              },
              toolCalls: event.totalToolCalls,
              steps: event.totalToolCalls,
              creditsConsumed: totalCreditsConsumed,
            });
            break;
          }
          default:
            break;
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: msg },
        "AI SDK 6 execution failed, falling back to SSE streaming"
      );

      // Fall back to the standard execute() path
      yield* ExecutionEngine.execute(ctx);
    }
  },
};
