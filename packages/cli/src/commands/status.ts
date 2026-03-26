import { Command } from "commander";
import type { PlatformStatus, SessionInfo, TaskInfo } from "../api-client";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";

function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    active: "[...]",
    running: "[...]",
    completed: "[ OK]",
    failed: "[ERR]",
    cancelled: "[CXL]",
    paused: "[||]",
  };
  return icons[status] ?? "[   ]";
}

function displaySessionDetails(session: SessionInfo, tasks: TaskInfo[]): void {
  console.log("Session Details\n");
  console.log(`  ID:         ${session.id}`);
  console.log(`  Project:    ${session.project?.name ?? session.projectId}`);
  console.log(`  Status:     ${session.status}`);
  console.log(`  Mode:       ${session.mode}`);
  console.log(`  Started:    ${session.startedAt}`);
  if (session.endedAt) {
    console.log(`  Ended:      ${session.endedAt}`);
  }

  if (tasks.length > 0) {
    console.log("\n  Tasks:");
    for (const task of tasks) {
      const icon = getStatusIcon(task.status);
      console.log(`    ${icon} ${task.title} (${task.status})`);
    }
  }
}

function displayPlatformStatus(status: PlatformStatus): void {
  console.log("Prometheus Platform Status\n");
  console.log(`Active Agents:  ${status.activeAgents}`);
  console.log(`Queue Depth:    ${status.queueDepth}`);
  console.log("\nServices:");

  for (const [service, healthy] of Object.entries(status.services)) {
    const icon = healthy ? "OK  " : "DOWN";
    console.log(`  ${icon} ${service}`);
  }
}

function displayRecentSessions(sessions: SessionInfo[]): void {
  if (sessions.length === 0) {
    return;
  }
  console.log("\nRecent Sessions:");
  for (const session of sessions) {
    const icon = getStatusIcon(session.status);
    const name = session.project?.name ?? session.projectId;
    console.log(
      `  ${icon} ${session.id} [${session.mode}] ${name} (${session.status})`
    );
  }
}

export const statusCommand = new Command("status")
  .description("View running agents, queue depth, and service health")
  .argument("[session-id]", "Show specific session status")
  .option("-p, --project <id>", "Project ID (for listing sessions)")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(
    async (
      sessionId: string | undefined,
      opts: { apiKey?: string; apiUrl?: string; project?: string }
    ) => {
      const config = resolveConfig({
        apiUrl: opts.apiUrl,
        apiKey: opts.apiKey,
        project: opts.project,
      });
      const client = new APIClient(config);

      try {
        if (sessionId) {
          const session = await client.getSession(sessionId);
          const taskResult = await client.listTasks({
            sessionId,
            limit: 10,
          });
          displaySessionDetails(session, taskResult.tasks);
        } else {
          const status = await client.getStatus();
          displayPlatformStatus(status);

          if (config.projectId) {
            try {
              const sessionsResult = await client.listSessions({
                projectId: config.projectId,
                limit: 5,
              });
              displayRecentSessions(sessionsResult.sessions);
            } catch {
              // Ignore session listing errors
            }
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error connecting to Prometheus: ${msg}`);
        console.error("Is the API server running?");
        process.exit(1);
      }
    }
  );
