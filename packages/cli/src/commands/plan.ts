import { Command } from "commander";
import type { SessionEvent } from "../api-client";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";
import { parsePrometheusRules } from "../prometheus-md";
import { StreamRenderer } from "../renderer/stream-renderer";
import { CLISessionStore } from "../session/session-store";

interface PlanStep {
  complexity?: "low" | "medium" | "high";
  description: string;
  destructive?: boolean;
  filesAffected?: string[];
  stepNumber: number;
}

function formatComplexity(complexity?: string): string {
  const labels: Record<string, string> = {
    low: "[LOW]   ",
    medium: "[MED]   ",
    high: "[HIGH]  ",
  };
  return labels[complexity ?? ""] ?? "        ";
}

function formatPlanStep(step: PlanStep): void {
  const destructiveTag = step.destructive ? " [DESTRUCTIVE]" : "";
  const complexity = formatComplexity(step.complexity);
  console.log(
    `  ${step.stepNumber}. ${complexity}${step.description}${destructiveTag}`
  );
  if (step.filesAffected && step.filesAffected.length > 0) {
    for (const file of step.filesAffected) {
      console.log(`       -> ${file}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handleApprove(
  client: APIClient,
  approveSessionId: string
): Promise<void> {
  try {
    const session = await client.getSession(approveSessionId);
    if (!session) {
      console.error(`Session ${approveSessionId} not found.`);
      process.exit(1);
    }
    await client.approvePlan(approveSessionId, approveSessionId);
    console.log(`Plan approved for session ${approveSessionId}`);
    console.log("Execution will begin shortly.");
    process.exit(0);
  } catch (error) {
    console.error(`Error approving plan: ${errorMessage(error)}`);
    process.exit(1);
  }
}

async function handleExecute(
  client: APIClient,
  sessionStore: CLISessionStore
): Promise<void> {
  const sessions = sessionStore.listSessions();
  const lastPlan = sessions.find((s) => s.agentRole === "plan");
  if (!lastPlan) {
    console.error("No previous plan found. Run 'prometheus plan' first.");
    process.exit(1);
  }
  try {
    await client.approvePlan(lastPlan.sessionId, lastPlan.sessionId);
    console.log(`Executing plan from session ${lastPlan.sessionId}`);
    process.exit(0);
  } catch (error) {
    console.error(`Error executing plan: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function handleStreamEvent(
  event: SessionEvent,
  renderer: StreamRenderer,
  phases: string[],
  phaseState: { index: number },
  planSteps: PlanStep[]
): "complete" | "continue" {
  switch (event.type) {
    case "token": {
      renderer.renderTextDelta(
        String((event.data as { content: string }).content)
      );
      return "continue";
    }
    case "phase_change": {
      phaseState.index++;
      const phase = phases[phaseState.index] ?? "Complete";
      renderer.clear();
      console.log(`\n--- Phase: ${phase} ---\n`);
      return "continue";
    }
    case "plan_step": {
      planSteps.push(event.data as PlanStep);
      return "continue";
    }
    case "error": {
      renderer.renderError(
        String((event.data as { error?: string }).error ?? "Unknown error")
      );
      return "continue";
    }
    case "complete": {
      return "complete";
    }
    default:
      return "continue";
  }
}

export const planCommand = new Command("plan")
  .description("Generate an execution plan without running it")
  .argument("<description>", "Task description")
  .option("-p, --project <id>", "Project ID")
  .option("--path <dir>", "Project directory path", process.cwd())
  .option("--execute", "Execute the last generated plan")
  .option("--approve <session-id>", "Approve a specific plan by session ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(
    async (
      description: string,
      opts: {
        apiKey?: string;
        apiUrl?: string;
        approve?: string;
        execute?: boolean;
        path: string;
        project?: string;
      }
    ) => {
      const config = resolveConfig({
        apiUrl: opts.apiUrl,
        apiKey: opts.apiKey,
        project: opts.project,
      });
      const client = new APIClient(config);
      const projectId = config.projectId;
      const sessionStore = new CLISessionStore();

      if (!projectId) {
        console.error(
          "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
        );
        process.exit(1);
      }

      if (opts.approve) {
        await handleApprove(client, opts.approve);
        return;
      }

      if (opts.execute) {
        await handleExecute(client, sessionStore);
        return;
      }

      const rules = parsePrometheusRules(opts.path);
      const phases = ["Discovery", "Architecture", "Planning"];

      try {
        console.log("Starting planning session...\n");
        console.log(`Project path: ${opts.path}`);
        console.log(`Task: ${description}\n`);

        const result = await client.submitTask({
          title: description,
          description: `[PLAN ONLY] ${description}`,
          projectId,
          mode: "plan",
          rules: rules.length > 0 ? rules : undefined,
        });

        console.log(`Session: ${result.sessionId}\n`);

        sessionStore.saveSession(result.sessionId, {
          agentRole: "plan",
          createdAt: new Date().toISOString(),
          filesChanged: [],
          messages: [
            {
              role: "user",
              content: description,
              timestamp: new Date().toISOString(),
            },
          ],
          projectPath: opts.path,
          updatedAt: new Date().toISOString(),
        });

        console.log(`--- Phase: ${phases[0]} ---\n`);

        const renderer = new StreamRenderer();
        const planSteps: PlanStep[] = [];
        const phaseState = { index: 0 };

        const stream = client.streamSession(result.sessionId, (event) => {
          const status = handleStreamEvent(
            event,
            renderer,
            phases,
            phaseState,
            planSteps
          );

          if (status === "complete") {
            renderer.clear();
            if (planSteps.length > 0) {
              console.log("\n\n=== Execution Plan ===\n");
              for (const step of planSteps) {
                formatPlanStep(step);
              }
              const credits = (event.data as { estimatedCredits?: number })
                .estimatedCredits;
              if (credits) {
                console.log(`\nEstimated credits: ${credits}`);
              }
            }
            console.log("\nPlanning complete.");
            console.log(
              `Run 'prometheus plan --approve ${result.sessionId}' to execute.`
            );
            stream.close();
            process.exit(0);
          }
        });
      } catch (error) {
        console.error(`Error: ${errorMessage(error)}`);
        process.exit(1);
      }
    }
  );
