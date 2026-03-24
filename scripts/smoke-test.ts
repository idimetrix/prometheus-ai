/**
 * Smoke test script — verifies all Prometheus services are healthy.
 *
 * Usage: tsx scripts/smoke-test.ts
 *
 * Hits /health on all services, reports status matrix, and optionally
 * tests inter-service connectivity.
 */

interface ServiceDef {
  healthPath: string;
  name: string;
  port: number;
}

const SERVICES: ServiceDef[] = [
  { name: "api", port: 4000, healthPath: "/health" },
  { name: "socket-server", port: 4001, healthPath: "/health" },
  { name: "orchestrator", port: 4002, healthPath: "/health" },
  { name: "project-brain", port: 4003, healthPath: "/health" },
  { name: "model-router", port: 4004, healthPath: "/health" },
  { name: "mcp-gateway", port: 4005, healthPath: "/health" },
  { name: "sandbox-manager", port: 4006, healthPath: "/health" },
  { name: "queue-worker", port: 4007, healthPath: "/health" },
];

interface HealthResult {
  details?: Record<string, unknown>;
  error?: string;
  responseTime: number;
  service: string;
  status: "healthy" | "degraded" | "down";
  statusCode?: number;
}

async function checkHealth(svc: ServiceDef): Promise<HealthResult> {
  const url = `http://localhost:${svc.port}${svc.healthPath}`;
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const elapsed = performance.now() - start;
    let details: Record<string, unknown> | undefined;

    try {
      details = (await res.json()) as Record<string, unknown>;
    } catch {
      // Response may not be JSON
    }

    if (res.ok) {
      return {
        service: svc.name,
        status: "healthy",
        responseTime: elapsed,
        statusCode: res.status,
        details,
      };
    }

    return {
      service: svc.name,
      status: "degraded",
      responseTime: elapsed,
      statusCode: res.status,
      details,
    };
  } catch (err) {
    const elapsed = performance.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    return {
      service: svc.name,
      status: "down",
      responseTime: elapsed,
      error: message,
    };
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "healthy":
      return "\u2705";
    case "degraded":
      return "\u26A0\uFE0F";
    case "down":
      return "\u274C";
    default:
      return "\u2753";
  }
}

async function main() {
  console.log("\n  Prometheus Smoke Test\n");
  console.log("  Checking all services...\n");

  const results = await Promise.all(SERVICES.map(checkHealth));

  // Display results
  const maxName = Math.max(...results.map((r) => r.service.length));

  for (const r of results) {
    const name = r.service.padEnd(maxName);
    const time = `${r.responseTime.toFixed(0)}ms`.padStart(6);
    const code = r.statusCode ? ` (${r.statusCode})` : "";
    const err = r.error ? ` — ${r.error}` : "";
    console.log(`  ${statusIcon(r.status)} ${name}  ${time}${code}${err}`);
  }

  const healthy = results.filter((r) => r.status === "healthy").length;
  const degraded = results.filter((r) => r.status === "degraded").length;
  const down = results.filter((r) => r.status === "down").length;

  console.log(
    `\n  Summary: ${healthy} healthy, ${degraded} degraded, ${down} down (${results.length} total)\n`
  );

  // Test inter-service connectivity if API is up
  const apiResult = results.find((r) => r.service === "api");
  if (apiResult?.status === "healthy") {
    console.log("  Inter-service connectivity:\n");

    const connectivityChecks = [
      { from: "api", to: "orchestrator", port: 4002 },
      { from: "api", to: "model-router", port: 4004 },
      { from: "api", to: "project-brain", port: 4003 },
      { from: "api", to: "mcp-gateway", port: 4005 },
      { from: "api", to: "sandbox-manager", port: 4006 },
    ];

    for (const check of connectivityChecks) {
      try {
        const res = await fetch(`http://localhost:${check.port}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        const icon = res.ok ? "\u2705" : "\u26A0\uFE0F";
        console.log(
          `  ${icon} ${check.from} -> ${check.to.padEnd(maxName)} reachable`
        );
      } catch {
        console.log(
          `  \u274C ${check.from} -> ${check.to.padEnd(maxName)} unreachable`
        );
      }
    }
    console.log();
  }

  // Exit with error code if any service is down
  if (down > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
