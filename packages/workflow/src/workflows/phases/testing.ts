import { createLogger } from "@prometheus/logger";

const logger = createLogger("workflow:phase:testing");

export interface TestResult {
  coverage: number | null;
  failedTests: string[];
  output: string;
  passed: boolean;
  testsFailed: number;
  testsRun: number;
}

interface TestInput {
  filesChanged: string[];
  maxFixIterations?: number;
  orchestratorUrl: string;
  orgId: string;
  projectId: string;
  sessionId: string;
  taskId: string;
  testRunner: string | null;
}

export async function runTestingPhase(input: TestInput): Promise<TestResult> {
  const {
    taskId,
    sessionId,
    projectId,
    filesChanged,
    testRunner,
    orchestratorUrl,
    maxFixIterations = 3,
  } = input;

  logger.info(
    { taskId, filesChanged: filesChanged.length, testRunner },
    "Running testing phase"
  );

  const detectedRunner = testRunner ?? detectTestRunner(filesChanged);

  let lastResult: TestResult = {
    passed: true,
    testsRun: 0,
    testsFailed: 0,
    failedTests: [],
    coverage: null,
    output: "No tests detected",
  };

  for (let iteration = 0; iteration <= maxFixIterations; iteration++) {
    try {
      // Ask orchestrator to run tests via the test_engineer agent
      const response = await fetch(`${orchestratorUrl}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: `${taskId}-test-${iteration}`,
          sessionId,
          projectId,
          orgId: input.orgId,
          userId: "system",
          title: `Run tests (iteration ${iteration + 1})`,
          description: buildTestCommand(detectedRunner, filesChanged),
          mode: "autonomous",
          agentRole: "test_engineer",
        }),
      });

      if (!response.ok) {
        logger.warn(
          { taskId, status: response.status },
          "Test execution request failed"
        );
        break;
      }

      const result = (await response.json()) as {
        success: boolean;
        output?: string;
        testsRun?: number;
        testsFailed?: number;
        failedTests?: string[];
        coverage?: number;
      };

      lastResult = {
        passed: result.success,
        testsRun: result.testsRun ?? 0,
        testsFailed: result.testsFailed ?? 0,
        failedTests: result.failedTests ?? [],
        coverage: result.coverage ?? null,
        output: result.output ?? "",
      };

      if (lastResult.passed) {
        logger.info(
          { taskId, testsRun: lastResult.testsRun, iteration },
          "Tests passed"
        );
        break;
      }

      if (iteration < maxFixIterations) {
        logger.info(
          {
            taskId,
            testsFailed: lastResult.testsFailed,
            iteration,
          },
          "Tests failed, triggering fix loop"
        );
      }
    } catch (error) {
      logger.error(
        { taskId, error: String(error), iteration },
        "Test phase iteration failed"
      );
      break;
    }
  }

  return lastResult;
}

function detectTestRunner(filesChanged: string[]): string {
  const hasTS = filesChanged.some(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx")
  );
  const hasPy = filesChanged.some((f) => f.endsWith(".py"));
  const hasGo = filesChanged.some((f) => f.endsWith(".go"));
  const hasRust = filesChanged.some((f) => f.endsWith(".rs"));

  if (hasGo) {
    return "go test";
  }
  if (hasRust) {
    return "cargo test";
  }
  if (hasPy) {
    return "pytest";
  }
  if (hasTS) {
    return "vitest";
  }
  return "npm test";
}

function buildTestCommand(runner: string, filesChanged: string[]): string {
  const fileList = filesChanged.slice(0, 10).join(", ");
  return `Run tests for changed files: ${fileList}. Use ${runner} as the test runner. Report test results with pass/fail counts.`;
}
