/**
 * Service boot validation script — verifies infrastructure, application
 * services, inter-service connectivity, and Redis pub/sub.
 *
 * Usage: pnpm tsx scripts/validate-boot.ts
 *
 * Exit 0 if all checks pass, exit 1 if any fail.
 */

import * as net from "node:net";

// ── ANSI colors ──────────────────────────────────────────────────────────────

const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
} as const;

function pass(label: string): string {
  return `${color.green}PASS${color.reset}  ${label}`;
}

function fail(label: string, reason?: string): string {
  const suffix = reason ? `${color.dim} (${reason})${color.reset}` : "";
  return `${color.red}FAIL${color.reset}  ${label}${suffix}`;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface CheckResult {
  category: string;
  error?: string;
  label: string;
  ok: boolean;
}

// ── Infrastructure checks ────────────────────────────────────────────────────

function checkTcpPort(
  host: string,
  port: number,
  timeoutMs = 3000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.connect(port, host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

async function checkInfrastructure(): Promise<CheckResult[]> {
  const infra = [
    { label: "PostgreSQL", host: "127.0.0.1", port: 5432 },
    { label: "Redis", host: "127.0.0.1", port: 6379 },
  ];

  const results: CheckResult[] = [];

  for (const svc of infra) {
    const reachable = await checkTcpPort(svc.host, svc.port);
    results.push({
      category: "Infrastructure",
      label: `${svc.label} (:${svc.port})`,
      ok: reachable,
      error: reachable ? undefined : `Port ${svc.port} not reachable`,
    });
  }

  return results;
}

// ── Application health checks ────────────────────────────────────────────────

interface AppService {
  expectJson?: boolean;
  healthPath: string;
  name: string;
  port: number;
}

const APP_SERVICES: AppService[] = [
  { name: "API", port: 4000, healthPath: "/health", expectJson: true },
  {
    name: "Socket Server",
    port: 4001,
    healthPath: "/health",
    expectJson: true,
  },
  { name: "Orchestrator", port: 4002, healthPath: "/health", expectJson: true },
  {
    name: "Project Brain",
    port: 4003,
    healthPath: "/health",
    expectJson: true,
  },
  { name: "Model Router", port: 4004, healthPath: "/health", expectJson: true },
  { name: "MCP Gateway", port: 4005, healthPath: "/health", expectJson: true },
  {
    name: "Sandbox Manager",
    port: 4006,
    healthPath: "/health",
    expectJson: true,
  },
  { name: "Queue Worker", port: 4007, healthPath: "/health", expectJson: true },
  { name: "Web", port: 3000, healthPath: "/", expectJson: false },
];

async function checkAppHealth(svc: AppService): Promise<CheckResult> {
  const url = `http://localhost:${svc.port}${svc.healthPath}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        category: "App Health",
        label: `${svc.name} (:${svc.port}${svc.healthPath})`,
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }

    return {
      category: "App Health",
      label: `${svc.name} (:${svc.port}${svc.healthPath})`,
      ok: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      category: "App Health",
      label: `${svc.name} (:${svc.port}${svc.healthPath})`,
      ok: false,
      error: message.includes("abort") ? "Timeout (5s)" : message,
    };
  }
}

function checkAllAppHealth(): Promise<CheckResult[]> {
  return Promise.all(APP_SERVICES.map(checkAppHealth));
}

// ── Inter-service connectivity ───────────────────────────────────────────────

interface ConnectivityCheck {
  from: string;
  path: string;
  port: number;
  to: string;
}

const CONNECTIVITY_CHECKS: ConnectivityCheck[] = [
  { from: "API", to: "Orchestrator", port: 4002, path: "/live" },
  { from: "API", to: "Model Router", port: 4004, path: "/live" },
  { from: "API", to: "Sandbox Manager", port: 4006, path: "/live" },
  { from: "API", to: "Project Brain", port: 4003, path: "/live" },
];

async function checkConnectivity(
  check: ConnectivityCheck
): Promise<CheckResult> {
  const url = `http://localhost:${check.port}${check.path}`;
  const label = `${check.from} -> ${check.to} (${check.path})`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    return {
      category: "Connectivity",
      label,
      ok: res.ok,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      category: "Connectivity",
      label,
      ok: false,
      error: message.includes("abort") ? "Timeout (5s)" : message,
    };
  }
}

function checkAllConnectivity(): Promise<CheckResult[]> {
  return Promise.all(CONNECTIVITY_CHECKS.map(checkConnectivity));
}

// ── Redis pub/sub check ──────────────────────────────────────────────────────

function checkRedisPubSub(): Promise<CheckResult> {
  const label = "Redis pub/sub roundtrip";
  const channel = `__validate_boot_${Date.now()}`;
  const testMessage = `ping-${Date.now()}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscriber.destroy();
      publisher.destroy();
      resolve({
        category: "Redis",
        label,
        ok: false,
        error: "Timeout waiting for pub/sub message (3s)",
      });
    }, 3000);

    const subscriber = new net.Socket();
    const publisher = new net.Socket();
    let subscriberReady = false;
    let receivedData = "";

    subscriber.connect(6379, "127.0.0.1", () => {
      subscriber.write(`SUBSCRIBE ${channel}\r\n`);
    });

    subscriber.on("data", (data) => {
      receivedData += data.toString();

      // Wait for subscription confirmation before publishing
      if (!subscriberReady && receivedData.includes("subscribe")) {
        subscriberReady = true;
        publisher.connect(6379, "127.0.0.1", () => {
          publisher.write(`PUBLISH ${channel} ${testMessage}\r\n`);
        });
      }

      // Check if we received our message
      if (subscriberReady && receivedData.includes(testMessage)) {
        clearTimeout(timer);
        // Unsubscribe and clean up
        subscriber.write("UNSUBSCRIBE\r\n");
        setTimeout(() => {
          subscriber.destroy();
          publisher.destroy();
        }, 100);
        resolve({
          category: "Redis",
          label,
          ok: true,
        });
      }
    });

    subscriber.on("error", (err) => {
      clearTimeout(timer);
      subscriber.destroy();
      publisher.destroy();
      resolve({
        category: "Redis",
        label,
        ok: false,
        error: err.message,
      });
    });

    publisher.on("error", (err) => {
      clearTimeout(timer);
      subscriber.destroy();
      publisher.destroy();
      resolve({
        category: "Redis",
        label,
        ok: false,
        error: `Publisher: ${err.message}`,
      });
    });
  });
}

// ── Summary table ────────────────────────────────────────────────────────────

function printSection(title: string, results: CheckResult[]): void {
  console.log(`\n  ${color.bold}${color.cyan}${title}${color.reset}`);
  console.log(`  ${"─".repeat(60)}`);

  const maxLabel = Math.max(...results.map((r) => r.label.length), 10);

  for (const r of results) {
    const line = r.ok
      ? pass(r.label.padEnd(maxLabel))
      : fail(r.label.padEnd(maxLabel), r.error);
    console.log(`  ${line}`);
  }
}

function printSummary(all: CheckResult[]): void {
  const passed = all.filter((r) => r.ok).length;
  const failed = all.filter((r) => !r.ok).length;
  const total = all.length;

  console.log(`\n  ${"═".repeat(60)}`);

  if (failed === 0) {
    console.log(
      `  ${color.bold}${color.green}ALL ${total} CHECKS PASSED${color.reset}`
    );
  } else {
    console.log(
      `  ${color.bold}${color.red}${failed} of ${total} CHECKS FAILED${color.reset}  ${color.dim}(${passed} passed)${color.reset}`
    );
  }

  console.log(`  ${"═".repeat(60)}\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n  ${color.bold}Prometheus Boot Validation${color.reset}`);
  console.log(
    `  ${color.dim}Verifying all services are running and connected${color.reset}`
  );

  // 1. Infrastructure
  const infraResults = await checkInfrastructure();
  printSection("Infrastructure", infraResults);

  // 2. Application health
  const appResults = await checkAllAppHealth();
  printSection("Application Health", appResults);

  // 3. Inter-service connectivity
  const connectivityResults = await checkAllConnectivity();
  printSection("Inter-Service Connectivity", connectivityResults);

  // 4. Redis pub/sub
  const redisUp = infraResults.find((r) => r.label.includes("Redis"))?.ok;
  let redisResults: CheckResult[];

  if (redisUp) {
    const pubsubResult = await checkRedisPubSub();
    redisResults = [pubsubResult];
  } else {
    redisResults = [
      {
        category: "Redis",
        label: "Redis pub/sub roundtrip",
        ok: false,
        error: "Skipped — Redis not reachable",
      },
    ];
  }
  printSection("Redis Pub/Sub", redisResults);

  // 5. Summary
  const all = [
    ...infraResults,
    ...appResults,
    ...connectivityResults,
    ...redisResults,
  ];
  printSummary(all);

  const failed = all.some((r) => !r.ok);
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("Boot validation failed unexpectedly:", err);
  process.exit(1);
});
