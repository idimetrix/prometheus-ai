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
        const result = await client.listSessions({
          projectId: config.projectId ?? opts.project,
          status: opts.status,
          limit: Number(opts.limit ?? "10"),
        });

        if (result.sessions.length === 0) {
          console.log("No sessions found.");
          return;
        }

        console.log(
          `\n${"ID".padEnd(20)} ${"Mode".padEnd(8)} ${"Status".padEnd(12)} ${"Started".padEnd(24)}`
        );
        console.log("-".repeat(70));

        for (const session of result.sessions) {
          const started = session.startedAt
            ? new Date(session.startedAt).toLocaleString()
            : "N/A";
          console.log(
            `${session.id.padEnd(20)} ${session.mode.padEnd(8)} ${session.status.padEnd(12)} ${started.padEnd(24)}`
          );
        }

        if (result.nextCursor) {
          console.log("\n... more sessions available");
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
        const session = await client.getSession(sessionId);
        console.log(`\nSession: ${session.id}`);
        console.log(`  Mode:    ${session.mode}`);
        console.log(`  Status:  ${session.status}`);
        console.log(`  Project: ${session.project?.name ?? session.projectId}`);
        console.log(
          `  Started: ${session.startedAt ? new Date(session.startedAt).toLocaleString() : "N/A"}`
        );
        if (session.endedAt) {
          console.log(
            `  Ended:   ${new Date(session.endedAt).toLocaleString()}`
          );
        }
        console.log();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    }
  );
