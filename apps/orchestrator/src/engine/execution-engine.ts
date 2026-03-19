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
import type { AgentRole } from "@prometheus/types";
import { AgentError, modelRouterClient } from "@prometheus/utils";
import { BlueprintEnforcer } from "../blueprint-enforcer";
import { type ConfidenceResult, ConfidenceScorer } from "../confidence";
import { ContextCompressor } from "../context/context-compressor";
import { SecretsScanner } from "../guardian/secrets-scanner";
import { SelfReview } from "../self-review";
import { classifyToolDependencies } from "../tool-dependency";
import type { ExecutionContext } from "./execution-context";
import type {
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
import { QualityGate } from "./quality-gate";

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
 * Core execution engine yielding events as an async generator.
 *
 * Usage:
 * ```ts
 * for await (const event of ExecutionEngine.execute(context)) {
 *   // handle event by type
 * }
 * ```
 */
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

    // Initialize agent
    const roleConfig = AGENT_ROLES[ctx.agentRole];
    if (!roleConfig) {
      yield makeEvent<ErrorEvent>({
        type: "error",
        error: `Unknown agent role: ${ctx.agentRole}`,
        recoverable: false,
      });
      return;
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

    // Build enriched task description
    let enrichedDescription = ctx.taskDescription;
    if (ctx.blueprintContent) {
      enrichedDescription += `\n\n--- Blueprint ---\n${ctx.blueprintContent}`;
    }
    if (ctx.sprintState) {
      enrichedDescription += `\n\n--- Current Sprint State ---\n${ctx.sprintState}`;
    }
    if (ctx.recentCIResults) {
      enrichedDescription += `\n\n--- Recent CI Results ---\n${ctx.recentCIResults}`;
    }
    if (ctx.priorSessionContext) {
      enrichedDescription += `\n\n--- Prior Session Context ---\n${ctx.priorSessionContext}`;
    }
    agent.addUserMessage(enrichedDescription);

    // Initialize integrations
    const confidenceScorer = new ConfidenceScorer();
    const blueprintEnforcer = new BlueprintEnforcer();
    const secretsScanner = new SecretsScanner();
    const selfReview = new SelfReview();
    const qualityGate = new QualityGate();
    const contextCompressor = new ContextCompressor();

    await blueprintEnforcer.loadForProject(ctx.projectId).catch((err) => {
      logger.warn({ err }, "Blueprint loading failed");
    });

    const blueprintContext = blueprintEnforcer.getContextForPrompt();
    if (blueprintContext) {
      agent.addUserMessage(
        `[System] Blueprint constraints for this project:\n${blueprintContext}`
      );
    }

    // Load project conventions from Project Brain
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
      // Non-critical: conventions unavailable
    }

    // Execution state
    let slot =
      ctx.options.slot === "default"
        ? (SLOT_MAP[ctx.agentRole] ?? "default")
        : ctx.options.slot;
    const toolDefs = agent.getToolDefinitions();
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCreditsConsumed = 0;
    const filesChanged = new Set<string>();
    let lastOutput = "";
    let consecutiveErrors = 0;
    let consecutiveFailures = 0;
    let staleIterations = 0;
    let _lastConfidence: ConfidenceResult | null = null;

    const { maxIterations, temperature, maxTokens } = ctx.options;

    for (let i = 0; i < maxIterations; i++) {
      // Every 5 iterations, check if context compression is needed
      if (i > 0 && i % 5 === 0) {
        const currentMessages = agent.getMessages().map((m) => ({
          role: m.role,
          content: m.content ?? "",
          toolCallId: m.toolCallId,
          toolCalls: m.toolCalls,
        }));

        if (contextCompressor.shouldCompress(currentMessages)) {
          logger.info(
            { iteration: i, messageCount: currentMessages.length },
            "Compressing agent context (token budget exceeded)"
          );

          try {
            const compressionResult =
              await contextCompressor.compress(currentMessages);

            if (compressionResult.ratio < 1.0) {
              // Inject a summary of compressed history as a system message
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
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(
              { error: msg },
              "Context compression failed, continuing without compression"
            );
          }
        }
      }

      // Build messages for LLM
      const messages = agent.getMessages().map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
      }));

      // Call model-router with streaming
      let response: {
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
      };

      let streamingSucceeded = false;
      try {
        // Check circuit breaker before attempting LLM call
        if (modelRouterClient.getCircuitState() === "open") {
          throw new AgentError(
            "Model router circuit breaker is open — service unavailable",
            "STUCK",
            { recoverable: true }
          );
        }

        const routeResponse = await fetch(
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

        if (!routeResponse.ok) {
          const errBody = await routeResponse.text();
          throw new Error(
            `Model router returned ${routeResponse.status}: ${errBody}`
          );
        }

        const contentType = routeResponse.headers.get("content-type") ?? "";

        if (contentType.includes("text/event-stream") && routeResponse.body) {
          // Parse SSE stream and yield token events
          let accumulatedContent = "";
          const accumulatedToolCalls: Map<
            number,
            { id: string; function: { name: string; arguments: string } }
          > = new Map();
          let usageData = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cost_usd: 0,
          };
          let finishReason = "stop";

          const reader = routeResponse.body.getReader();
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
              const trimmed = line.trim();
              if (
                !trimmed ||
                trimmed.startsWith(":") ||
                !trimmed.startsWith("data: ")
              ) {
                continue;
              }

              const payload = trimmed.slice(6);
              if (payload === "[DONE]") {
                continue;
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
                usage?: typeof usageData;
              };

              try {
                chunk = JSON.parse(payload);
              } catch {
                continue;
              }

              if (chunk.usage) {
                usageData = chunk.usage;
              }

              const delta = chunk.choices?.[0]?.delta;
              if (!delta) {
                continue;
              }

              if (chunk.choices?.[0]?.finish_reason) {
                finishReason = chunk.choices[0].finish_reason;
              }

              // Yield token events for streaming content
              if (delta.content) {
                accumulatedContent += delta.content;
                yield makeEvent<TokenEvent>({
                  type: "token",
                  content: delta.content,
                });
              }

              // Accumulate tool call deltas
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const existing = accumulatedToolCalls.get(tc.index);
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
                    accumulatedToolCalls.set(tc.index, {
                      id: tc.id ?? "",
                      function: {
                        name: tc.function?.name ?? "",
                        arguments: tc.function?.arguments ?? "",
                      },
                    });
                  }
                }
              }
            }
          }

          const toolCallsArray = Array.from(accumulatedToolCalls.values());
          response = {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: accumulatedContent,
                  ...(toolCallsArray.length > 0
                    ? { tool_calls: toolCallsArray }
                    : {}),
                },
                finish_reason: finishReason,
              },
            ],
            usage: usageData,
          };
          streamingSucceeded = true;
        } else {
          response = (await routeResponse.json()) as typeof response;
          streamingSucceeded = true;
        }
      } catch (error) {
        consecutiveErrors++;
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg, iteration: i }, "LLM request failed");

        if (consecutiveErrors >= BLOCKER_THRESHOLD) {
          yield makeEvent<ErrorEvent>({
            type: "error",
            error: `Blocked after ${consecutiveErrors} consecutive LLM failures: ${msg}`,
            recoverable: false,
          });

          yield makeEvent<CompleteEvent>({
            type: "complete",
            success: false,
            output: lastOutput,
            filesChanged: Array.from(filesChanged),
            tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
            toolCalls: totalToolCalls,
            steps: i,
            creditsConsumed: totalCreditsConsumed,
          });
          return;
        }

        yield makeEvent<ErrorEvent>({
          type: "error",
          error: `LLM request failed (attempt ${consecutiveErrors}/${BLOCKER_THRESHOLD}): ${msg}`,
          recoverable: true,
        });

        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      consecutiveErrors = 0;

      // Track tokens and credits
      totalInputTokens += response.usage.prompt_tokens;
      totalOutputTokens += response.usage.completion_tokens;
      const creditsForRequest = Math.ceil(response.usage.total_tokens / 1000);
      totalCreditsConsumed += creditsForRequest;

      yield makeEvent<CreditUpdateEvent>({
        type: "credit_update",
        creditsConsumed: creditsForRequest,
        totalCreditsConsumed,
      });

      const choice = response.choices[0];
      if (!choice) {
        logger.warn("Empty response from LLM");
        continue;
      }

      const assistantContent = choice.message.content ?? "";
      const toolCalls = choice.message.tool_calls;

      if (assistantContent) {
        lastOutput = assistantContent;
        // If non-streaming, yield the full content as a single token event
        if (!streamingSucceeded) {
          yield makeEvent<TokenEvent>({
            type: "token",
            content: assistantContent,
          });
        }
      }

      // No tool calls = agent is done
      if (!toolCalls || toolCalls.length === 0) {
        agent.addAssistantMessage(assistantContent);
        break;
      }

      // Add assistant message with tool calls
      const parsedToolCalls: ToolCall[] = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
      agent.addAssistantMessage(assistantContent, parsedToolCalls);

      // Classify tool calls for parallel execution
      const toolCallInfos = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: parseToolArgs(tc.function.arguments),
      }));
      const executionGroups = classifyToolDependencies(toolCallInfos);

      const filesToReview: string[] = [];

      // Execute tool groups
      for (const group of executionGroups) {
        const executeCall = async (tc: {
          id: string;
          name: string;
          args: Record<string, unknown>;
        }): Promise<ExecutionEvent[]> => {
          const events: ExecutionEvent[] = [];
          totalToolCalls++;

          // Yield tool_call event
          events.push(
            makeEvent<ToolCallEvent>({
              type: "tool_call",
              toolCallId: tc.id,
              toolName: tc.name,
              args: tc.args,
            })
          );

          // Secrets scanning
          if (
            (tc.name === "file_write" || tc.name === "file_edit") &&
            tc.args.content
          ) {
            const filePath =
              (tc.args.path as string) ?? (tc.args.filePath as string) ?? "";
            const scanResult = secretsScanner.scan(
              filePath,
              tc.args.content as string
            );
            if (scanResult.blocked) {
              agent.addToolResult(
                tc.id,
                JSON.stringify({ success: false, error: scanResult.message })
              );
              events.push(
                makeEvent<ToolResultEvent>({
                  type: "tool_result",
                  toolCallId: tc.id,
                  toolName: tc.name,
                  success: false,
                  output: "",
                  error: scanResult.message,
                })
              );
              return events;
            }
          }

          // Blueprint validation
          if (blueprintEnforcer.isLoaded()) {
            let actionType:
              | "file_write"
              | "file_edit"
              | "terminal_exec"
              | "other";
            if (tc.name === "file_write" || tc.name === "file_edit") {
              actionType = tc.name as "file_write" | "file_edit";
            } else if (tc.name === "terminal_exec") {
              actionType = "terminal_exec";
            } else {
              actionType = "other";
            }
            const violations = blueprintEnforcer.validateAction({
              type: actionType,
              filePath:
                (tc.args.path as string) ?? (tc.args.filePath as string),
              content: tc.args.content as string,
              command: tc.args.command as string,
            });

            const errors = violations.filter((v) => v.severity === "error");
            if (errors.length > 0) {
              const violationMsg = errors
                .map((v) => `- ${v.description}`)
                .join("\n");
              agent.addToolResult(
                tc.id,
                JSON.stringify({
                  success: false,
                  error: `Blueprint violation(s):\n${violationMsg}`,
                })
              );
              events.push(
                makeEvent<ToolResultEvent>({
                  type: "tool_result",
                  toolCallId: tc.id,
                  toolName: tc.name,
                  success: false,
                  output: "",
                  error: `Blueprint violation(s):\n${violationMsg}`,
                })
              );
              return events;
            }
          }

          // Destructive command detection
          if (
            tc.name === "terminal_exec" &&
            tc.args.command &&
            isDestructiveCommand(String(tc.args.command))
          ) {
            agent.addToolResult(
              tc.id,
              JSON.stringify({
                success: false,
                error: "Destructive command blocked: requires human approval.",
              })
            );
            events.push(
              makeEvent<CheckpointEvent>({
                type: "checkpoint",
                checkpointType: "large_change",
                reason: `Destructive command detected: ${tc.args.command}`,
                affectedFiles: [],
              })
            );
            return events;
          }

          // RBAC: check if tool is allowed for this agent role
          if (allowedTools.size > 0 && !allowedTools.has(tc.name)) {
            agent.addToolResult(
              tc.id,
              JSON.stringify({
                success: false,
                error: `Tool "${tc.name}" is not permitted for role "${ctx.agentRole}". Allowed tools: ${Array.from(allowedTools).join(", ")}`,
              })
            );
            events.push(
              makeEvent<ToolResultEvent>({
                type: "tool_result",
                toolCallId: tc.id,
                toolName: tc.name,
                success: false,
                output: "",
                error: `RBAC denied: ${tc.name} not in allowed tools for ${ctx.agentRole}`,
              })
            );
            return events;
          }

          // Execute the tool
          const toolDef = TOOL_REGISTRY[tc.name];
          if (!toolDef) {
            agent.addToolResult(
              tc.id,
              JSON.stringify({
                success: false,
                error: `Unknown tool: ${tc.name}`,
              })
            );
            events.push(
              makeEvent<ToolResultEvent>({
                type: "tool_result",
                toolCallId: tc.id,
                toolName: tc.name,
                success: false,
                output: "",
                error: `Unknown tool: ${tc.name}`,
              })
            );
            return events;
          }

          try {
            const toolResult = await toolDef.execute(tc.args, {
              sessionId: ctx.sessionId,
              projectId: ctx.projectId,
              sandboxId: ctx.sessionId,
              workDir: ctx.workDir,
              orgId: ctx.orgId,
              userId: ctx.userId,
            });

            agent.addToolResult(tc.id, JSON.stringify(toolResult));

            // Track file changes
            if (toolResult.metadata?.filePath) {
              filesChanged.add(toolResult.metadata.filePath as string);
            }
            if (tc.name === "file_write" || tc.name === "file_edit") {
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

              // Phase 9: Quality gate for significant file writes (>20 lines)
              if (qualityGate.shouldEvaluate(tc.name, tc.args)) {
                const qgResult = await qualityGate.evaluate({
                  filePath: String(filePath),
                  content: String(tc.args.content ?? ""),
                  taskDescription: ctx.taskDescription,
                  blueprintContext: ctx.blueprintContent ?? undefined,
                });

                if (
                  qgResult.verdict === "revise" ||
                  qgResult.verdict === "reject"
                ) {
                  const feedback = qualityGate.getFeedbackPrompt(
                    qgResult,
                    String(filePath)
                  );
                  if (feedback) {
                    agent.addUserMessage(feedback);
                  }
                }
              }
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
                filePath:
                  (tc.args.path as string) ?? (tc.args.filePath as string),
                error: toolResult.error,
              })
            );

            consecutiveFailures = 0;
          } catch (error) {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            logger.error(
              { tool: tc.name, error: errMsg },
              "Tool execution failed"
            );
            agent.addToolResult(
              tc.id,
              JSON.stringify({ success: false, error: errMsg })
            );
            events.push(
              makeEvent<ToolResultEvent>({
                type: "tool_result",
                toolCallId: tc.id,
                toolName: tc.name,
                success: false,
                output: "",
                error: errMsg,
              })
            );
            consecutiveFailures++;
          }

          return events;
        };

        // Execute calls within the group
        let groupEvents: ExecutionEvent[];
        if (group.calls.length === 1 || group.sequential) {
          groupEvents = [];
          for (const tc of group.calls) {
            const callEvents = await executeCall(tc);
            groupEvents.push(...callEvents);
          }
        } else {
          const results = await Promise.allSettled(
            group.calls.map(executeCall)
          );
          groupEvents = results.flatMap((r) =>
            r.status === "fulfilled" ? r.value : []
          );
        }

        // Yield all events from this group
        for (const event of groupEvents) {
          yield event;
        }

        // Check for blocker
        if (consecutiveFailures >= BLOCKER_THRESHOLD) {
          yield makeEvent<ErrorEvent>({
            type: "error",
            error: `Blocked: ${consecutiveFailures} consecutive tool failures`,
            recoverable: false,
          });
          yield makeEvent<CompleteEvent>({
            type: "complete",
            success: false,
            output: lastOutput,
            filesChanged: Array.from(filesChanged),
            tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
            toolCalls: totalToolCalls,
            steps: i,
            creditsConsumed: totalCreditsConsumed,
          });
          return;
        }
      }

      // Self-review injection
      if (filesToReview.length > 0) {
        const reviewPrompt = filesToReview
          .map((fp) => selfReview.getReviewPrompt(fp))
          .join("\n\n");
        agent.addUserMessage(reviewPrompt);

        for (const fp of filesToReview) {
          yield makeEvent<SelfReviewEvent>({
            type: "self_review",
            filePath: fp,
          });
        }
      }

      // Confidence scoring
      const iterationToolResults = toolCalls.map((tc) => {
        const toolDef = TOOL_REGISTRY[tc.function.name];
        return { success: !!toolDef, name: tc.function.name };
      });
      const signals = ConfidenceScorer.extractSignals(
        assistantContent,
        iterationToolResults,
        filesChanged.size,
        staleIterations,
        lastOutput.length
      );
      staleIterations = signals.staleIterations;

      const confidence = confidenceScorer.scoreIteration(signals);
      _lastConfidence = confidence;

      yield makeEvent<ConfidenceEvent>({
        type: "confidence",
        score: confidence.score,
        action: confidence.action,
        iteration: i,
        factors: confidence.factors.map((f) => ({
          name: f.name,
          value: f.value,
        })),
      });

      // Adaptive model slot
      if (confidence.recommendedSlot) {
        slot = ConfidenceScorer.getModelSlot(slot, confidence);
      }

      // Strategic checkpoints
      if (filesChanged.size > 5 && i > 3) {
        yield makeEvent<CheckpointEvent>({
          type: "checkpoint",
          checkpointType: "large_change",
          reason: `Agent has modified ${filesChanged.size} files`,
          affectedFiles: Array.from(filesChanged),
        });
        agent.addUserMessage(
          "[System] A strategic checkpoint was triggered. Continue with your current approach unless directed otherwise."
        );
      }

      if (totalCreditsConsumed > 50 && i > 10) {
        yield makeEvent<CheckpointEvent>({
          type: "checkpoint",
          checkpointType: "cost_threshold",
          reason: `Task has consumed ${totalCreditsConsumed} credits across ${i} iterations`,
          affectedFiles: [],
        });
      }

      // Handle low confidence
      if (confidence.action === "escalate") {
        logger.warn(
          { confidence: confidence.score, iteration: i },
          "Low confidence - escalating"
        );
        yield makeEvent<ErrorEvent>({
          type: "error",
          error: `Agent confidence dropped to ${confidence.score.toFixed(2)}`,
          recoverable: false,
        });
        yield makeEvent<CompleteEvent>({
          type: "complete",
          success: false,
          output: lastOutput,
          filesChanged: Array.from(filesChanged),
          tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
          toolCalls: totalToolCalls,
          steps: i,
          creditsConsumed: totalCreditsConsumed,
        });
        return;
      }

      if (confidence.action === "request_help") {
        agent.addUserMessage(
          "[System] Your confidence appears moderate. Please verify your approach before proceeding."
        );
      }
    }

    // Completed all iterations or agent finished naturally
    yield makeEvent<CompleteEvent>({
      type: "complete",
      success: true,
      output: lastOutput,
      filesChanged: Array.from(filesChanged),
      tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
      toolCalls: totalToolCalls,
      steps: ctx.options.maxIterations,
      creditsConsumed: totalCreditsConsumed,
    });
  },
};
