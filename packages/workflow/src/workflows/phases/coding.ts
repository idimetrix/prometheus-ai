import { createLogger } from "@prometheus/logger";
import type { ExecutionResult, PlanStep } from "../agent-execution";

const logger = createLogger("workflow:phase:coding");

interface CodingInput {
  orchestratorUrl: string;
  orgId: string;
  projectId: string;
  sessionId: string;
  taskId: string;
}

export async function runCodingStep(
  input: CodingInput,
  planStep: PlanStep
): Promise<ExecutionResult> {
  const { taskId, sessionId, projectId, orgId, orchestratorUrl } = input;

  logger.info(
    { taskId, stepId: planStep.id, title: planStep.title },
    "Executing coding step"
  );

  try {
    const response = await fetch(`${orchestratorUrl}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: planStep.id,
        sessionId,
        projectId,
        orgId,
        userId: "system",
        title: planStep.title,
        description: planStep.description,
        mode: "autonomous",
        agentRole: planStep.agentRole,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { taskId, stepId: planStep.id, status: response.status },
        "Coding step request failed"
      );
      return {
        stepId: planStep.id,
        success: false,
        output: `HTTP ${response.status}: ${errorText}`,
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
        error: errorText,
      };
    }

    const result = (await response.json()) as {
      success: boolean;
      output?: string;
      filesChanged?: string[];
      tokensUsed?: { input: number; output: number };
      error?: string;
    };

    return {
      stepId: planStep.id,
      success: result.success,
      output: result.output ?? `Executed: ${planStep.title}`,
      filesChanged: result.filesChanged ?? [],
      tokensUsed: result.tokensUsed ?? { input: 0, output: 0 },
      error: result.error,
    };
  } catch (error) {
    logger.error(
      { taskId, stepId: planStep.id, error: String(error) },
      "Coding step execution failed"
    );
    return {
      stepId: planStep.id,
      success: false,
      output: String(error),
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      error: String(error),
    };
  }
}
