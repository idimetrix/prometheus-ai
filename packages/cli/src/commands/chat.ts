import { createInterface } from "node:readline";
import { Command } from "commander";
import { APIClient } from "../api-client";

export const chatCommand = new Command("chat")
  .description("Interactive chat with Prometheus agents")
  .option("-p, --project <id>", "Project ID")
  .action((opts: { project?: string }) => {
    const client = new APIClient();
    const projectId = opts.project ?? process.env.PROMETHEUS_PROJECT_ID;

    if (!projectId) {
      console.error(
        "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
      );
      process.exit(1);
    }

    console.log("Prometheus AI Chat (type 'exit' to quit)\n");

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "you> ",
    });

    rl.prompt();

    rl.on("line", async (line) => {
      const input = line.trim();
      if (input === "exit" || input === "quit") {
        console.log("Goodbye!");
        rl.close();
        process.exit(0);
      }

      if (!input) {
        rl.prompt();
        return;
      }

      try {
        const result = await client.submitTask({
          title: input,
          description: input,
          projectId,
          mode: "ask",
        });

        process.stdout.write("\nagent> ");

        const stream = client.streamSession(result.sessionId, (event) => {
          if (event.type === "token") {
            process.stdout.write(
              String((event.data as { content: string }).content)
            );
          } else if (event.type === "complete") {
            console.log("\n");
            stream.close();
            rl.prompt();
          }
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`\nError: ${msg}\n`);
        rl.prompt();
      }
    });

    rl.on("close", () => {
      process.exit(0);
    });
  });
