import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";

export const sessionsCommand = new Command("sessions").description(
  "Manage Prometheus sessions"
);

sessionsCommand
  .command("list")
  .description("List recent sessions")
  .option("-p, --project <id>", "Filter by project ID")
  .option(
    "-s, --status <status>",
    "Filter by status (active, completed, paused)"
  )
  .option("-l, --limit <n>", "Number of sessions to show", "10")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(
    async (opts: {
      apiKey?: string;
      apiUrl?: string;
      limit?: string;
      project?: string;
      status?: string;
    }) => {
      const config = resolveConfig({
        apiUrl: opts.apiUrl,
        apiKey: opts.apiKey,
        project: opts.project,
      });
      const client = new APIClient(config);

      try {
        const sessions = await client.listSessions(
          config.projectId ?? opts.project
        );

        const filteredSessions = opts.status
          ? sessions.filter((s) => s.status === opts.status)
          : sessions;

        const limited = filteredSessions.slice(0, Number(opts.limit ?? "10"));

        if (limited.length === 0) {
          console.log("No sessions found.");
          return;
        }

        console.log(
          `\n${"ID".padEnd(20)} ${"Mode".padEnd(8)} ${"Status".padEnd(12)} ${"Title".padEnd(24)}`
        );
        console.log("-".repeat(70));

        for (const session of limited) {
          console.log(
            `${session.id.padEnd(20)} ${session.mode.padEnd(8)} ${session.status.padEnd(12)} ${(session.title ?? "N/A").padEnd(24)}`
          );
        }
        console.log();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error listing sessions: ${msg}`);
        process.exit(1);
      }
    }
  );

sessionsCommand
  .command("show")
  .description("Show session details")
  .argument("<id>", "Session ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(
    async (sessionId: string, opts: { apiKey?: string; apiUrl?: string }) => {
      const config = resolveConfig({
        apiUrl: opts.apiUrl,
        apiKey: opts.apiKey,
      });
      const client = new APIClient(config);

      try {
        const session = await client.getSessionStatus(sessionId);
        console.log(`\nSession: ${session.id}`);
        console.log(`  Mode:    ${session.mode}`);
        console.log(`  Status:  ${session.status}`);
        if (session.progress != null) {
          console.log(`  Progress: ${session.progress}%`);
        }
        console.log();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    }
  );
