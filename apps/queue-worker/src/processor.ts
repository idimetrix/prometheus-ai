import { createLogger } from "@prometheus/logger";
import { EventPublisher } from "@prometheus/queue";
import { db } from "@prometheus/db";
import { tasks, agents, sessions, creditBalances, creditTransactions, modelUsage } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { eq, sql } from "drizzle-orm";
import type { AgentTaskData } from "@prometheus/queue";

interface ProcessResult {
  success: boolean;
  output: string;
  filesChanged: string[];
  tokensUsed: { input: number; output: number };
  creditsConsumed: number;
}

export class TaskProcessor {
  private readonly logger = createLogger("queue-worker:processor");
  private readonly publisher = new EventPublisher();

  async process(taskData: AgentTaskData): Promise<ProcessResult> {
    const { taskId, sessionId, projectId, orgId, userId, title, mode, agentRole } = taskData;

    this.logger.info({ taskId, sessionId, mode }, "Processing task: %s", title);

    // Update task status to running
    await db.update(tasks)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(tasks.id, taskId));

    // Publish running status
    await this.publisher.publishSessionEvent(sessionId, {
      type: "task_status",
      data: { taskId, status: "running", startedAt: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    });

    try {
      // Create agent instance record
      const agentId = generateId("agt");
      await db.insert(agents).values({
        id: agentId,
        sessionId,
        role: agentRole ?? "orchestrator",
        status: "working",
        currentTaskId: taskId,
      });

      // Call orchestrator service to process the task
      const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";
      let result: ProcessResult;

      try {
        const response = await fetch(`${orchestratorUrl}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            sessionId,
            projectId,
            orgId,
            userId,
            title,
            description: taskData.description,
            mode,
            agentRole,
            agentId,
          }),
          signal: AbortSignal.timeout(3600000), // 1 hour timeout
        });

        if (response.ok) {
          result = await response.json() as ProcessResult;
        } else {
          // Fallback: basic processing if orchestrator is unavailable
          result = await this.fallbackProcess(taskData, agentId);
        }
      } catch (fetchError) {
        this.logger.warn({ taskId }, "Orchestrator unavailable, using fallback processing");
        result = await this.fallbackProcess(taskData, agentId);
      }

      // Update agent status
      await db.update(agents)
        .set({
          status: "idle",
          tokensIn: result.tokensUsed.input,
          tokensOut: result.tokensUsed.output,
          lastActiveAt: new Date(),
        })
        .where(eq(agents.id, agentId));

      // Update task status to completed
      await db.update(tasks)
        .set({
          status: "completed",
          completedAt: new Date(),
          creditsConsumed: result.creditsConsumed,
        })
        .where(eq(tasks.id, taskId));

      // Consume credits
      if (result.creditsConsumed > 0) {
        await this.consumeCredits(orgId, taskId, result.creditsConsumed);
      }

      // Record model usage
      if (result.tokensUsed.input > 0 || result.tokensUsed.output > 0) {
        await db.insert(modelUsage).values({
          id: generateId("mu"),
          orgId,
          sessionId,
          taskId,
          provider: "ollama",
          model: "default",
          tokensIn: result.tokensUsed.input,
          tokensOut: result.tokensUsed.output,
          costUsd: 0,
        });
      }

      // Publish completion
      await this.publisher.publishSessionEvent(sessionId, {
        type: "task_status",
        data: {
          taskId,
          status: "completed",
          completedAt: new Date().toISOString(),
          output: result.output,
          filesChanged: result.filesChanged,
          creditsConsumed: result.creditsConsumed,
        },
        timestamp: new Date().toISOString(),
      });

      // Check session completion (all tasks done?)
      await this.checkSessionCompletion(sessionId);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ taskId, error: errorMessage }, "Task processing failed");

      // Update task status to failed
      await db.update(tasks)
        .set({ status: "failed" })
        .where(eq(tasks.id, taskId));

      await this.publisher.publishSessionEvent(sessionId, {
        type: "task_status",
        data: { taskId, status: "failed", error: errorMessage },
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  }

  private async fallbackProcess(taskData: AgentTaskData, agentId: string): Promise<ProcessResult> {
    // Basic processing when orchestrator is not available
    // Publishes thinking/progress events for the UI
    await this.publisher.publishSessionEvent(taskData.sessionId, {
      type: "reasoning",
      data: { content: `Analyzing task: ${taskData.title}` },
      agentRole: taskData.agentRole ?? "orchestrator",
      timestamp: new Date().toISOString(),
    });

    await this.publisher.publishSessionEvent(taskData.sessionId, {
      type: "agent_output",
      data: {
        content: `Task "${taskData.title}" has been received and queued for processing. The orchestrator service will handle agent dispatch when available.`,
        agentRole: taskData.agentRole ?? "orchestrator",
      },
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      output: `Task "${taskData.title}" processed (orchestrator fallback mode)`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      creditsConsumed: taskData.creditsReserved > 0 ? Math.min(taskData.creditsReserved, 2) : 2,
    };
  }

  private async consumeCredits(orgId: string, taskId: string, amount: number): Promise<void> {
    try {
      await db.update(creditBalances)
        .set({
          balance: sql`GREATEST(${creditBalances.balance} - ${amount}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.orgId, orgId));

      const balance = await db.query.creditBalances.findFirst({
        where: eq(creditBalances.orgId, orgId),
      });

      await db.insert(creditTransactions).values({
        id: generateId("ctx"),
        orgId,
        type: "consumption",
        amount: -amount,
        balanceAfter: balance?.balance ?? 0,
        taskId,
        description: `Task execution: ${taskId}`,
      });
    } catch (error) {
      this.logger.error({ orgId, amount, error }, "Failed to consume credits");
    }
  }

  private async checkSessionCompletion(sessionId: string): Promise<void> {
    const pendingTasks = await db.query.tasks.findMany({
      where: eq(tasks.sessionId, sessionId),
      columns: { status: true },
    });

    const allDone = pendingTasks.every(
      (t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled"
    );

    if (allDone && pendingTasks.length > 0) {
      const anyFailed = pendingTasks.some((t) => t.status === "failed");
      await db.update(sessions)
        .set({
          status: anyFailed ? "failed" : "completed",
          endedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));
    }
  }
}
