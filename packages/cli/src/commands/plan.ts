import { Command } from "commander";
import { APIClient } from "../api-client";

export const planCommand = new Command("plan")
  .description(
    "Start a planning-only session (Discovery -> Architecture -> Planning)"
  )
  .argument("<description>", "Task description")
  .option("-p, --project <id>", "Project ID")
  .option("--path <dir>", "Project directory path", process.cwd())
  .action(
    async (description: string, opts: { project?: string; path: string }) => {
      const client = new APIClient();
      const projectId = opts.project ?? process.env.PROMETHEUS_PROJECT_ID;

      if (!projectId) {
        console.error(
          "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
        );
        process.exit(1);
      }

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
        });

        console.log(`Session: ${result.sessionId}\n`);

        let currentPhaseIndex = 0;
        console.log(`--- Phase: ${phases[0]} ---\n`);

        const stream = client.streamSession(result.sessionId, (event) => {
          switch (event.type) {
            case "token": {
              process.stdout.write(
                String((event.data as { content: string }).content)
              );
              break;
            }
            case "phase_change": {
              currentPhaseIndex++;
              const phase = phases[currentPhaseIndex] ?? "Complete";
              console.log(`\n\n--- Phase: ${phase} ---\n`);
              break;
            }
            case "complete": {
              console.log("\n\nPlanning complete.");
              console.log("Run 'prometheus task' to execute this plan.");
              stream.close();
              process.exit(0);
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
