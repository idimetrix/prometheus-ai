import { Command } from "commander";
import { APIClient } from "../api-client";

interface AgentProgress {
  agentId: string;
  message: string;
  progress: number;
  status: "pending" | "running" | "complete" | "error";
}

function renderProgressBars(agents: AgentProgress[]): void {
  // Move cursor up to overwrite previous output
  if (agents.length > 0) {
    process.stdout.write(`\x1b[${agents.length}A`);
  }

  for (const agent of agents) {
    const barWidth = 30;
    const filled = Math.round((agent.progress / 100) * barWidth);
    const empty = barWidth - filled;
    const bar = `[${"#".repeat(filled)}${"-".repeat(empty)}]`;
    let statusIcon = "   ";
    if (agent.status === "complete") {
      statusIcon = "OK";
    } else if (agent.status === "error") {
      statusIcon = "ERR";
    } else if (agent.status === "running") {
      statusIcon = "...";
    }

    const line = `  ${statusIcon} Agent ${agent.agentId} ${bar} ${agent.progress}% ${agent.message}`;
    process.stdout.write(`${line.padEnd(80)}\n`);
  }
}

export const fleetCommand = new Command("fleet")
  .description("Execute task with parallel multi-agent fleet")
  .argument("<description>", "Task description")
  .option("-p, --project <id>", "Project ID")
  .option("-n, --agents <count>", "Number of agents", "3")
  .action(
    async (description: string, opts: { project?: string; agents: string }) => {
      const client = new APIClient();
      const projectId = opts.project ?? process.env.PROMETHEUS_PROJECT_ID;
      const agentCount = Number.parseInt(opts.agents, 10);

      if (!projectId) {
        console.error(
          "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
        );
        process.exit(1);
      }

      if (Number.isNaN(agentCount) || agentCount < 1) {
        console.error("Error: Agent count must be a positive number");
        process.exit(1);
      }

      try {
        console.log(`Launching fleet with ${agentCount} agents...\n`);

        const result = await client.submitTask({
          title: description,
          description,
          projectId,
          mode: "fleet",
        });

        console.log(`Session: ${result.sessionId}\n`);

        // Initialize agent progress tracking
        const agents: AgentProgress[] = Array.from(
          { length: agentCount },
          (_, i) => ({
            agentId: String(i + 1).padStart(2, "0"),
            status: "pending" as const,
            message: "Waiting...",
            progress: 0,
          })
        );

        // Print initial empty lines for progress bars
        for (const agent of agents) {
          console.log(`     Agent ${agent.agentId} [${"-".repeat(30)}]   0%`);
        }

        const stream = client.streamSession(result.sessionId, (event) => {
          switch (event.type) {
            case "agent_progress": {
              const data = event.data as {
                agentIndex: number;
                progress: number;
                message: string;
                status: string;
              };
              const agent = agents[data.agentIndex];
              if (agent) {
                agent.progress = data.progress;
                agent.message = data.message;
                agent.status = data.status as AgentProgress["status"];
                renderProgressBars(agents);
              }
              break;
            }
            case "complete": {
              // Mark all as complete
              for (const agent of agents) {
                if (agent.status !== "error") {
                  agent.status = "complete";
                  agent.progress = 100;
                }
              }
              renderProgressBars(agents);
              const success = (event.data as { success: boolean }).success;
              console.log(
                `\nFleet execution ${success ? "completed" : "failed"}`
              );
              stream.close();
              process.exit(success ? 0 : 1);
              break;
            }
            case "error": {
              console.error(
                `\n[Error] ${(event.data as { error: string }).error}`
              );
              break;
            }
            default:
              break;
          }
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    }
  );
