import { createInterface } from "node:readline";
import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";
import { LocalEngine } from "../local/local-engine";
import { StreamRenderer } from "../renderer/stream-renderer";

export const chatCommand = new Command("chat")
  .description("Interactive chat with Prometheus agents")
  .option("-p, --project <id>", "Project ID")
  .option("--resume", "Resume the most recent session")
  .option("--session <id>", "Resume a specific session by ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .option("--local", "Run locally using direct LLM API calls")
  .option(
    "--provider <provider>",
    "LLM provider for local mode (anthropic, openai, groq, ollama)"
  )
  .option("--llm-key <key>", "API key for the LLM provider in local mode")
  .action(
    async (opts: {
      apiKey?: string;
      apiUrl?: string;
      llmKey?: string;
      local?: boolean;
      project?: string;
      provider?: string;
      resume?: boolean;
      session?: string;
    }) => {
      if (opts.local) {
        runLocalChat(opts);
        return;
      }

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

      let sessionId: string | undefined;

      // Resume an existing session
      if (opts.session) {
        sessionId = opts.session;
        console.log(`Resuming session: ${sessionId}`);
      } else if (opts.resume) {
        try {
          const sessions = await client.listSessions(projectId);
          const activeSessions = sessions.filter((s) => s.status === "active");
          if (activeSessions.length > 0) {
            sessionId = activeSessions[0]?.id;
            console.log(`Resuming most recent session: ${sessionId}`);
          } else {
            console.log("No active sessions found, creating a new one...");
          }
        } catch {
          console.log("Could not fetch sessions, creating a new one...");
        }
      }

      // Create a new session if not resuming
      if (!sessionId) {
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

        if (input === "exit" || input === "quit" || input === "/exit") {
          console.log("Goodbye!");
          rl.close();
          process.exit(0);
        }

        if (input === "/clear") {
          console.clear();
          console.log("Chat history cleared.\n");
          rl.prompt();
          return;
        }

        if (input === "/help") {
          console.log("\nAvailable commands:");
          console.log("  /exit   - Exit the chat session");
          console.log("  /clear  - Clear the screen");
          console.log("  /help   - Show this help message");
          console.log("  exit    - Exit the chat session\n");
          rl.prompt();
          return;
        }

        if (!input) {
          rl.prompt();
          return;
        }

        try {
          await client.sendMessage({
            sessionId: sessionId as string,
            content: input,
          });

          process.stdout.write("\nagent> ");

          const stream = client.streamSession(sessionId as string, (event) => {
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
    }
  );

function runLocalChat(opts: { llmKey?: string; provider?: string }): void {
  const projectDir = process.cwd();

  const engine = new LocalEngine({
    provider: opts.provider,
    apiKey: opts.llmKey,
    projectDir,
  });

  console.log("Prometheus Local Chat (type 'exit' to quit)");
  console.log(`Provider: ${opts.provider ?? "auto-detected"}`);
  console.log(`Project: ${projectDir}`);
  console.log("Use '\\' at end of line for multi-line input\n");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "you> ",
  });

  let multilineBuffer = "";
  let isMultiline = false;

  rl.prompt();

  rl.on("line", async (line) => {
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

    if (input === "exit" || input === "quit" || input === "/exit") {
      console.log("Goodbye!");
      rl.close();
      process.exit(0);
    }

    if (input === "/clear") {
      console.clear();
      console.log("Chat history cleared.\n");
      rl.prompt();
      return;
    }

    if (input.startsWith("/model ")) {
      const newModel = input.slice(7).trim();
      console.log("Model switching is not supported mid-session.");
      console.log(`Current provider: ${opts.provider ?? "auto-detected"}`);
      console.log(`Requested model: ${newModel}\n`);
      rl.prompt();
      return;
    }

    if (input === "/help") {
      console.log("\nAvailable commands:");
      console.log("  /exit       - Exit the chat session");
      console.log("  /clear      - Clear the screen");
      console.log("  /model <m>  - Show model info");
      console.log("  /help       - Show this help message");
      console.log("  exit        - Exit the chat session\n");
      rl.prompt();
      return;
    }

    if (!input) {
      rl.prompt();
      return;
    }

    try {
      process.stdout.write("\nagent> ");
      const stream = engine.chat(input);
      for await (const chunk of stream) {
        process.stdout.write(chunk);
      }
      console.log("\n");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`\nError: ${msg}\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
