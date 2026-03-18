import { createLogger } from "@prometheus/logger";
import type { AgentRole, TaskStatus } from "@prometheus/types";
import type { BaseAgent, AgentContext, AgentExecutionResult } from "@prometheus/agent-sdk";
import { AGENT_ROLES } from "@prometheus/agent-sdk";

export type AgentLoopStatus = "idle" | "running" | "paused" | "stopped";

interface LoopIteration {
  iteration: number;
  agentRole: string;
  startedAt: Date;
  completedAt: Date | null;
  result: AgentExecutionResult | null;
}

export class AgentLoop {
  private readonly logger;
  private readonly sessionId: string;
  private readonly projectId: string;
  private readonly orgId: string;
  private readonly userId: string;
  private status: AgentLoopStatus = "idle";
  private iterations: LoopIteration[] = [];
  private activeAgent: BaseAgent | null = null;

  constructor(sessionId: string, projectId: string, orgId: string, userId: string) {
    this.sessionId = sessionId;
    this.projectId = projectId;
    this.orgId = orgId;
    this.userId = userId;
    this.logger = createLogger(`agent-loop:${sessionId}`);
  }

  getStatus(): AgentLoopStatus {
    return this.status;
  }

  private createContext(): AgentContext {
    return {
      sessionId: this.sessionId,
      projectId: this.projectId,
      orgId: this.orgId,
      userId: this.userId,
      blueprintContent: null,
      projectContext: null,
    };
  }

  async executeTask(taskDescription: string, agentRole: string): Promise<AgentExecutionResult> {
    this.status = "running";
    const context = this.createContext();

    const roleConfig = AGENT_ROLES[agentRole];
    if (!roleConfig) {
      throw new Error(`Unknown agent role: ${agentRole}`);
    }

    const agent = roleConfig.create();
    this.activeAgent = agent;
    agent.initialize(context);
    agent.addUserMessage(taskDescription);

    const iteration: LoopIteration = {
      iteration: this.iterations.length + 1,
      agentRole,
      startedAt: new Date(),
      completedAt: null,
      result: null,
    };

    this.logger.info({
      iteration: iteration.iteration,
      agentRole,
    }, "Starting agent execution");

    try {
      // Agent execution loop: send to LLM -> get response -> execute tools -> repeat
      const result = await this.runAgentLoop(agent, context);
      iteration.completedAt = new Date();
      iteration.result = result;
      this.iterations.push(iteration);
      this.status = "idle";
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: errorMessage }, "Agent execution failed");
      iteration.completedAt = new Date();
      iteration.result = {
        success: false,
        output: "",
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        error: errorMessage,
      };
      this.iterations.push(iteration);
      this.status = "idle";
      return iteration.result;
    }
  }

  private async runAgentLoop(agent: BaseAgent, context: AgentContext): Promise<AgentExecutionResult> {
    const maxIterations = 50;
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const filesChanged: Set<string> = new Set();
    let lastOutput = "";

    for (let i = 0; i < maxIterations; i++) {
      if (this.status === "paused") {
        await this.waitForResume();
      }
      if (this.status === "stopped") {
        break;
      }

      // TODO: Send messages to LLM via model-router, get response
      // TODO: Parse tool calls from response
      // TODO: Execute tool calls via sandbox
      // TODO: Add results back to messages
      // TODO: Check if agent is done (no more tool calls)

      // Placeholder - in real implementation, this loops with the LLM
      lastOutput = `Agent ${agent.constructor.name} completed task`;
      break;
    }

    return {
      success: true,
      output: lastOutput,
      filesChanged: Array.from(filesChanged),
      tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
      toolCalls: totalToolCalls,
    };
  }

  private waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.status !== "paused") {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      };
      check();
    });
  }

  async pause(): Promise<void> {
    this.status = "paused";
    this.logger.info("Agent loop paused");
  }

  async resume(): Promise<void> {
    this.status = "running";
    this.logger.info("Agent loop resumed");
  }

  async stop(): Promise<void> {
    this.status = "stopped";
    this.activeAgent = null;
    this.logger.info("Agent loop stopped");
  }
}
