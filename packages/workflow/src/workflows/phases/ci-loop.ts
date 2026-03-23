import { createLogger } from "@prometheus/logger";

const logger = createLogger("workflow:phase:ci-loop");

export interface CIResult {
  buildPassed: boolean;
  iterations: number;
  lintPassed: boolean;
  output: string;
  typecheckPassed: boolean;
}

interface CIInput {
  maxIterations?: number;
  orchestratorUrl: string;
  orgId: string;
  projectId: string;
  sessionId: string;
  taskId: string;
}

export async function runCILoop(input: CIInput): Promise<CIResult> {
  const {
    taskId,
    sessionId,
    projectId,
    orgId,
    orchestratorUrl,
    maxIterations = 3,
  } = input;

  logger.info({ taskId, maxIterations }, "Running CI loop phase");

  let lastResult: CIResult = {
    buildPassed: true,
    lintPassed: true,
    typecheckPassed: true,
    iterations: 0,
    output: "",
  };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    lastResult.iterations = iteration + 1;

    try {
      const response = await fetch(`${orchestratorUrl}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: `${taskId}-ci-${iteration}`,
          sessionId,
          projectId,
          orgId,
          userId: "system",
          title: `CI loop (iteration ${iteration + 1})`,
          description:
            "Run typecheck, lint, and build. If there are errors, fix them. Report results.",
          mode: "autonomous",
          agentRole: "ci_loop",
        }),
      });

      if (!response.ok) {
        logger.warn(
          { taskId, status: response.status },
          "CI loop request failed"
        );
        break;
      }

      const result = (await response.json()) as {
        success: boolean;
        output?: string;
        buildPassed?: boolean;
        lintPassed?: boolean;
        typecheckPassed?: boolean;
      };

      lastResult = {
        buildPassed: result.buildPassed ?? result.success,
        lintPassed: result.lintPassed ?? result.success,
        typecheckPassed: result.typecheckPassed ?? result.success,
        iterations: iteration + 1,
        output: result.output ?? "",
      };

      if (
        lastResult.buildPassed &&
        lastResult.lintPassed &&
        lastResult.typecheckPassed
      ) {
        logger.info({ taskId, iteration }, "CI loop passed");
        break;
      }

      if (iteration < maxIterations - 1) {
        logger.info(
          {
            taskId,
            build: lastResult.buildPassed,
            lint: lastResult.lintPassed,
            typecheck: lastResult.typecheckPassed,
            iteration,
          },
          "CI loop failed, retrying with fixes"
        );
      }
    } catch (error) {
      logger.error(
        { taskId, error: String(error), iteration },
        "CI loop iteration failed"
      );
      break;
    }
  }

  return lastResult;
}
