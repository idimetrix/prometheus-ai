import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";

interface PlatformStatus {
  activeAgents: number;
  queueDepth: number;
  services: Record<string, boolean>;
}

interface SessionInfo {
  id: string;
  mode: string;
  status: string;
  title?: string;
}

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

function displaySessionDetails(session: {
  id: string;
  status: string;
  mode: string;
  progress?: number;
}): void {
  console.log("Session Details\n");
  console.log(`  ID:         ${session.id}`);
  console.log(`  Status:     ${session.status}`);
  console.log(`  Mode:       ${session.mode}`);
  if (session.progress != null) {
    console.log(`  Progress:   ${session.progress}%`);
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
    console.log(
      `  ${icon} ${session.id} [${session.mode}] ${session.title ?? "untitled"} (${session.status})`
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
          const session = await client.getSessionStatus(sessionId);
          displaySessionDetails(session);
        } else {
          const status = await client.getStatus();
          displayPlatformStatus(status);

          if (config.projectId) {
            try {
              const sessions = await client.listSessions(config.projectId);
              displayRecentSessions(sessions.slice(0, 5));
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
