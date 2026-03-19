import { Command } from "commander";
import { APIClient } from "../api-client";

export const taskCommand = new Command("task")
  .description("Submit a task to Prometheus agents")
  .argument("<description>", "Task description")
  .option("-p, --project <id>", "Project ID")
  .option("-m, --mode <mode>", "Execution mode (task|plan|ask|fleet)", "task")
  .action(
    async (description: string, opts: { project?: string; mode: string }) => {
      const client = new APIClient();
      const projectId = opts.project ?? process.env.PROMETHEUS_PROJECT_ID;

      if (!projectId) {
        console.error(
          "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
        );
        process.exit(1);
      }

      try {
        console.log(`Submitting ${opts.mode} task...`);
        const result = await client.submitTask({
          title: description,
          description,
          projectId,
          mode: opts.mode,
        });

        console.log(`Task created: ${result.taskId}`);
        console.log(`Session: ${result.sessionId}`);
        console.log("\nStreaming output...\n");

        const stream = client.streamSession(result.sessionId, (event) => {
          switch (event.type) {
            case "token":
              process.stdout.write(
                String((event.data as { content: string }).content)
              );
              break;
            case "tool_call":
              console.log(
                `\n[Tool] ${(event.data as { toolName: string }).toolName}`
              );
              break;
            case "file_change":
              console.log(
                `[File] ${(event.data as { filePath: string }).filePath}`
              );
              break;
            case "error":
              console.error(
                `\n[Error] ${(event.data as { error: string }).error}`
              );
              break;
            case "complete": {
              const data = event.data as { success: boolean };
              console.log(`\n\nTask ${data.success ? "completed" : "failed"}`);
              stream.close();
              process.exit(data.success ? 0 : 1);
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
