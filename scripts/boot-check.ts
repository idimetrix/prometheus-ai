/**
 * Boot check script -- verifies all Prometheus services are healthy.
 *
 * Usage:
 *   npx tsx scripts/boot-check.ts          # One-shot check
 *   npx tsx scripts/boot-check.ts --wait   # Retry for up to 60 seconds
 *
 * Exit 0 if all healthy, 1 if any down.
 */

// ── ANSI colors ──────────────────────────────────────────────────────────────

const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
} as const;

// ── Service definitions ──────────────────────────────────────────────────────

interface ServiceDef {
  name: string;
  url: string;
}

function getServices(): ServiceDef[] {
  const apiUrl =
    process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  const socketUrl =
    process.env.SOCKET_URL ??
    `http://localhost:${process.env.SOCKET_PORT ?? 4001}`;
  const orchestratorUrl =
    process.env.ORCHESTRATOR_URL ??
    `http://localhost:${process.env.ORCHESTRATOR_PORT ?? 4002}`;
  const projectBrainUrl =
    process.env.PROJECT_BRAIN_URL ??
    `http://localhost:${process.env.PROJECT_BRAIN_PORT ?? 4003}`;
  const modelRouterUrl =
    process.env.MODEL_ROUTER_URL ??
    `http://localhost:${process.env.MODEL_ROUTER_PORT ?? 4004}`;
  const mcpGatewayUrl =
    process.env.MCP_GATEWAY_URL ??
    `http://localhost:${process.env.MCP_GATEWAY_PORT ?? 4005}`;
  const sandboxManagerUrl =
    process.env.SANDBOX_MANAGER_URL ??
    `http://localhost:${process.env.SANDBOX_MANAGER_PORT ?? 4006}`;
  const queueWorkerUrl =
    process.env.QUEUE_WORKER_URL ??
    `http://localhost:${process.env.HEALTH_PORT ?? 4007}`;

  return [
    { name: "api", url: `${apiUrl}/health` },
    { name: "socket-server", url: `${socketUrl}/health` },
    { name: "orchestrator", url: `${orchestratorUrl}/health` },
    { name: "project-brain", url: `${projectBrainUrl}/health` },
    { name: "model-router", url: `${modelRouterUrl}/health` },
    { name: "mcp-gateway", url: `${mcpGatewayUrl}/health` },
    { name: "sandbox-manager", url: `${sandboxManagerUrl}/health` },
    { name: "queue-worker", url: `${queueWorkerUrl}/health` },
  ];
}

// ── Health check types ───────────────────────────────────────────────────────

interface HealthResponse {
  service?: string;
  status?: string;
  timestamp?: string;
  uptime?: number;
  version?: string;
}

interface ServiceResult {
  error?: string;
  healthy: boolean;
  name: string;
  response?: HealthResponse;
  url: string;
}

// ── Health check logic ───────────────────────────────────────────────────────

async function checkService(svc: ServiceDef): Promise<ServiceResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(svc.url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok && res.status !== 503) {
      return {
        name: svc.name,
        url: svc.url,
        healthy: false,
        error: `HTTP ${res.status}`,
      };
    }

    const body = (await res.json()) as HealthResponse;
    const isHealthy =
      body.status === "ok" || body.status === "healthy" || res.status === 200;

    return {
      name: svc.name,
      url: svc.url,
      healthy: isHealthy,
      response: body,
      error: isHealthy ? undefined : `status: ${body.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: svc.name,
      url: svc.url,
      healthy: false,
      error: message.includes("abort") ? "Timeout (5s)" : message,
    };
  }
}

function checkAllServices(): Promise<ServiceResult[]> {
  const services = getServices();
  return Promise.all(services.map(checkService));
}

// ── Table rendering ──────────────────────────────────────────────────────────

function printTable(results: ServiceResult[]): void {
  const nameWidth = Math.max(...results.map((r) => r.name.length), 7);
  const versionWidth = 10;
  const uptimeWidth = 10;
  const statusWidth = 12;

  const header = [
    "Service".padEnd(nameWidth),
    "Status".padEnd(statusWidth),
    "Version".padEnd(versionWidth),
    "Uptime".padEnd(uptimeWidth),
    "Details",
  ].join("  ");

  const separator = "-".repeat(header.length + 10);

  console.log();
  console.log(
    `  ${color.bold}${color.cyan}Prometheus Service Health${color.reset}`
  );
  console.log(`  ${separator}`);
  console.log(`  ${color.bold}${header}${color.reset}`);
  console.log(`  ${separator}`);

  for (const r of results) {
    const name = r.name.padEnd(nameWidth);
    const statusText = r.healthy ? "UP" : "DOWN";
    const statusColor = r.healthy ? color.green : color.red;
    const status = `${statusColor}${statusText.padEnd(statusWidth)}${color.reset}`;
    const version = (r.response?.version ?? "-").padEnd(versionWidth);
    const uptime =
      r.response?.uptime === undefined
        ? "-".padEnd(uptimeWidth)
        : formatUptime(r.response.uptime).padEnd(uptimeWidth);
    const details = r.error
      ? `${color.red}${r.error}${color.reset}`
      : (r.response?.service ?? "");

    console.log(`  ${name}  ${status}  ${version}  ${uptime}  ${details}`);
  }

  console.log(`  ${separator}`);

  const up = results.filter((r) => r.healthy).length;
  const down = results.filter((r) => !r.healthy).length;
  const total = results.length;

  if (down === 0) {
    console.log(
      `  ${color.bold}${color.green}All ${total} services healthy${color.reset}`
    );
  } else {
    console.log(
      `  ${color.bold}${color.red}${down} of ${total} services down${color.reset}  ${color.dim}(${up} healthy)${color.reset}`
    );
  }
  console.log();
}

function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
  return `${Math.floor(seconds / 86_400)}d`;
}

// ── Wait/retry logic ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServices(
  maxWaitMs: number,
  intervalMs: number
): Promise<boolean> {
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    attempt++;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `  ${color.dim}[${elapsed}s] Attempt ${attempt}...${color.reset}`
    );

    const results = await checkAllServices();
    const allHealthy = results.every((r) => r.healthy);

    if (allHealthy) {
      printTable(results);
      return true;
    }

    const downServices = results
      .filter((r) => !r.healthy)
      .map((r) => r.name)
      .join(", ");
    console.log(`  ${color.yellow}Waiting for: ${downServices}${color.reset}`);

    await sleep(intervalMs);
  }

  // Final check
  const results = await checkAllServices();
  printTable(results);
  return results.every((r) => r.healthy);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldWait = args.includes("--wait");
  const maxWaitMs = 60_000;
  const intervalMs = 3000;

  if (shouldWait) {
    console.log(
      `\n  ${color.bold}Waiting for services (up to ${maxWaitMs / 1000}s)...${color.reset}`
    );
    const allHealthy = await waitForServices(maxWaitMs, intervalMs);
    process.exit(allHealthy ? 0 : 1);
  } else {
    const results = await checkAllServices();
    printTable(results);
    const allHealthy = results.every((r) => r.healthy);
    process.exit(allHealthy ? 0 : 1);
  }
}

main().catch((err: unknown) => {
  console.error("Boot check failed unexpectedly:", err);
  process.exit(1);
});
