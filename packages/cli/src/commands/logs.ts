import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";

interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
}

const LEVEL_COLORS: Record<string, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const RESET = "\x1b[0m";

function formatLogEntry(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level] ?? "";
  const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
  const level = entry.level.toUpperCase().padEnd(5);
  return `${color}${ts} [${level}]${RESET} ${entry.message}`;
}

function shouldShow(entryLevel: string, minLevel: string): boolean {
  const order: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };
  return (order[entryLevel] ?? 0) >= (order[minLevel] ?? 0);
}

interface LogsOpts {
  apiKey?: string;
  apiUrl?: string;
  follow?: boolean;
  level: string;
  project?: string;
  session?: string;
  tail: string;
}

export const logsCommand = new Command("logs")
  .description("Stream session or agent logs in real-time")
  .option("-s, --session <id>", "Session ID to stream logs for")
  .option("-p, --project <id>", "Project ID")
  .option("-f, --follow", "Follow log output (like tail -f)")
  .option("-n, --tail <n>", "Number of recent lines to show", "50")
  .option(
    "-l, --level <level>",
    "Minimum log level (debug|info|warn|error)",
    "info"
  )
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (opts: LogsOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const tailCount = Number.parseInt(opts.tail, 10) || 50;

    const sessionId = opts.session;
    const projectId = config.projectId;

    if (!(sessionId || projectId)) {
      console.error(
        "Error: Session ID or Project ID required. Use --session or --project"
      );
      process.exit(1);
    }

    try {
      // Fetch recent logs
      const recentLogs = await client.getLogs({
        sessionId,
        projectId,
        limit: tailCount,
      });

      for (const entry of recentLogs) {
        if (shouldShow(entry.level, opts.level)) {
          console.log(formatLogEntry(entry));
        }
      }

      // If --follow, stream new logs
      if (opts.follow) {
        if (!sessionId) {
          console.error("Error: --follow requires a --session ID to stream");
          process.exit(1);
        }

        console.log("\n--- Streaming logs (Ctrl+C to stop) ---\n");

        const stream = client.streamSession(sessionId, (event) => {
          if (event.type === "log") {
            const entry = event.data as LogEntry;
            if (shouldShow(entry.level, opts.level)) {
              console.log(formatLogEntry(entry));
            }
          } else if (event.type === "complete") {
            console.log("\n--- Session complete ---");
            stream.close();
            process.exit(0);
          }
        });

        // Handle Ctrl+C gracefully
        process.on("SIGINT", () => {
          stream.close();
          console.log("\nStopped following logs.");
          process.exit(0);
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
