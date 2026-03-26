import { createInterface } from "node:readline";
import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";
import { StreamRenderer } from "../renderer/stream-renderer";

export const chatCommand = new Command("chat")
  .description("Interactive chat with Prometheus agents")
  .option("-p, --project <id>", "Project ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(
    async (opts: { apiKey?: string; apiUrl?: string; project?: string }) => {
      const config = resolveConfig({
        apiUrl: opts.apiUrl,
        apiKey: opts.apiKey,
        project: opts.project,
      });
      const client = new APIClient(config);
      const projectId = config.projectId;

      if (!projectId) {
        console.error(
          "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
        );
        process.exit(1);
      }

      // Create a persistent chat session
      let sessionId: string | undefined;

      try {
        const session = await client.createSession({
          projectId,
          mode: "ask",
        });
        sessionId = session.id;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error creating session: ${msg}`);
        process.exit(1);
      }

      console.log("Prometheus AI Chat (type 'exit' to quit)");
      console.log("Use '\\' at end of line for multi-line input\n");

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "you> ",
      });

      const renderer = new StreamRenderer();
      let multilineBuffer = "";
      let isMultiline = false;

      rl.prompt();

      rl.on("line", async (line) => {
        // Multi-line support: lines ending with \ continue
        if (line.endsWith("\\")) {
          multilineBuffer += `${line.slice(0, -1)}\n`;
          isMultiline = true;
          process.stdout.write("...> ");
          return;
        }

        let input: string;
        if (isMultiline) {
          input = (multilineBuffer + line).trim();
          multilineBuffer = "";
          isMultiline = false;
        } else {
          input = line.trim();
        }

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
          await client.sendMessage(sessionId as string, input);

          process.stdout.write("\nagent> ");

          const stream = client.streamSession(
            sessionId as string,
            (event) => {
              if (event.type === "token") {
                renderer.renderTextDelta(
                  String((event.data as { content: string }).content)
                );
              } else if (event.type === "tool_call") {
                const data = event.data as { toolName: string };
                renderer.renderToolCall(data.toolName);
              } else if (event.type === "file_change") {
                const data = event.data as { filePath: string };
                renderer.renderInfo(`File: ${data.filePath}`);
              } else if (event.type === "error") {
                renderer.renderError(
                  String(
                    (event.data as { error?: string }).error ?? "Unknown error"
                  )
                );
              } else if (event.type === "complete") {
                renderer.clear();
                console.log();
                stream.close();
                rl.prompt();
              }
            },
            () => {
              renderer.renderError("Connection lost, retrying...");
            }
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`\nError: ${msg}\n`);
          rl.prompt();
        }
      });

      rl.on("close", () => {
        process.exit(0);
      });
    }
  );
