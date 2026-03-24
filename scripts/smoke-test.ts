/**
 * E2E Smoke Test Script for Prometheus Platform
 *
 * Verifies the full pipeline against running services.
 * Run AFTER `docker compose up -d && pnpm dev` has started everything.
 *
 * Usage:
 *   tsx scripts/smoke-test.ts          # Standard smoke tests
 *   tsx scripts/smoke-test.ts --full   # Include full task execution test
 *
 * Exit codes: 0 = all pass, 1 = one or more failures
 */

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
} as const;

function pass(label: string, detail?: string) {
  const extra = detail ? ` ${C.dim}${detail}${C.reset}` : "";
  console.log(`  ${C.green}PASS${C.reset}  ${label}${extra}`);
}

function fail(label: string, detail?: string) {
  const extra = detail ? ` ${C.dim}${detail}${C.reset}` : "";
  console.log(`  ${C.red}FAIL${C.reset}  ${label}${extra}`);
}

function skip(label: string, detail?: string) {
  const extra = detail ? ` ${C.dim}${detail}${C.reset}` : "";
  console.log(`  ${C.yellow}SKIP${C.reset}  ${label}${extra}`);
}

function header(title: string) {
  console.log(`\n${C.cyan}${C.bold}--- ${title} ---${C.reset}\n`);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:4000";
const ORCHESTRATOR_BASE = "http://localhost:4002";
const MODEL_ROUTER_BASE = "http://localhost:4004";
const SANDBOX_MANAGER_BASE = "http://localhost:4006";

const DEV_TOKEN = "dev_token_usr_seed_dev001__org_seed_dev001";
const AUTH_HEADER = { Authorization: `Bearer ${DEV_TOKEN}` };

const SEED_ORG_ID = "org_seed_dev001";
const _SEED_USER_ID = "usr_seed_dev001";
const SEED_PROJECT_ID = "proj_seed_001";
const SEED_SESSION_ID = "sess_seed_001";

const TIMEOUT_MS = 8000;
const FULL_MODE = process.argv.includes("--full");

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TestResult {
  detail?: string;
  name: string;
  ok: boolean;
  skipped?: boolean;
}

const results: TestResult[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  if (ok) {
    pass(name, detail);
  } else {
    fail(name, detail);
  }
}

function recordSkip(name: string, detail?: string) {
  results.push({ name, ok: true, skipped: true, detail });
  skip(name, detail);
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function elapsed(start: number): string {
  return `${(performance.now() - start).toFixed(0)}ms`;
}

// ─── Test 1: Database Connectivity ────────────────────────────────────────────

async function testDatabaseConnectivity() {
  header("Database Connectivity");

  // We test DB connectivity indirectly through the API by querying seed data.
  // Use the tRPC health.check endpoint which verifies DB access.
  try {
    const start = performance.now();
    const res = await fetchWithTimeout(`${API_BASE}/trpc/health.check`, {
      headers: AUTH_HEADER,
    });
    const body = (await res.json()) as {
      result?: { data?: { json?: unknown } };
    };

    if (res.ok && body.result?.data) {
      record("DB connectivity via health.check", true, elapsed(start));
    } else {
      record("DB connectivity via health.check", false, `status=${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record("DB connectivity via health.check", false, msg);
  }

  // Verify seed data exists by listing sessions for the seed project
  try {
    const start = performance.now();
    const input = JSON.stringify({
      json: { projectId: SEED_PROJECT_ID, limit: 1 },
    });
    const url = `${API_BASE}/trpc/sessions.list?input=${encodeURIComponent(input)}`;
    const res = await fetchWithTimeout(url, { headers: AUTH_HEADER });
    const body = (await res.json()) as {
      result?: { data?: { json?: { sessions?: unknown[] } } };
    };

    const sessions = body.result?.data?.json?.sessions;
    if (res.ok && Array.isArray(sessions) && sessions.length > 0) {
      record(
        `Seed data present (org=${SEED_ORG_ID}, project=${SEED_PROJECT_ID})`,
        true,
        `${sessions.length} session(s) found, ${elapsed(start)}`
      );
    } else {
      record(
        `Seed data present (org=${SEED_ORG_ID})`,
        false,
        `No sessions returned, status=${res.status}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record("Seed data present", false, msg);
  }
}

// ─── Test 2: API Health ───────────────────────────────────────────────────────

async function testApiHealth() {
  header("API Health");

  try {
    const start = performance.now();
    const res = await fetchWithTimeout(`${API_BASE}/health`);
    const body = await res.text();

    if (res.ok) {
      record("GET /health", true, `${res.status} ${elapsed(start)}`);
    } else {
      record("GET /health", false, `${res.status} ${body.slice(0, 100)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record("GET /health", false, msg);
  }
}

// ─── Test 3: Auth with Dev Bypass Token ───────────────────────────────────────

async function testAuthDevBypass() {
  header("Auth (Dev Bypass Token)");

  try {
    const start = performance.now();
    const res = await fetchWithTimeout(`${API_BASE}/trpc/health.check`, {
      headers: AUTH_HEADER,
    });

    if (res.ok) {
      record(
        "Authenticated tRPC call (health.check)",
        true,
        `${res.status} ${elapsed(start)}`
      );
    } else {
      const body = await res.text();
      record(
        "Authenticated tRPC call (health.check)",
        false,
        `${res.status} ${body.slice(0, 200)}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record("Authenticated tRPC call (health.check)", false, msg);
  }

  // Verify unauthenticated request is rejected
  try {
    const start = performance.now();
    const res = await fetchWithTimeout(`${API_BASE}/trpc/health.check`);

    if (res.status === 401) {
      record("Unauthenticated request rejected", true, `401 ${elapsed(start)}`);
    } else {
      record(
        "Unauthenticated request rejected",
        false,
        `Expected 401, got ${res.status}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record("Unauthenticated request rejected", false, msg);
  }
}

// ─── Test 4: Create Session via tRPC ──────────────────────────────────────────

let createdSessionId: string | null = null;

async function testCreateSession() {
  header("Session Creation (tRPC Mutation)");

  try {
    const start = performance.now();

    // SuperJSON batch format for tRPC v11 mutations
    const payload = {
      json: {
        projectId: SEED_PROJECT_ID,
        mode: "task",
      },
    };

    const res = await fetchWithTimeout(`${API_BASE}/trpc/sessions.create`, {
      method: "POST",
      headers: {
        ...AUTH_HEADER,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = (await res.json()) as {
      result?: { data?: { json?: { id?: string; status?: string } } };
      error?: { message?: string };
    };

    if (res.ok && body.result?.data?.json?.id) {
      createdSessionId = body.result.data.json.id;
      const status = body.result.data.json.status ?? "unknown";
      record(
        "sessions.create mutation",
        true,
        `id=${createdSessionId} status=${status} ${elapsed(start)}`
      );
    } else {
      const errMsg = body.error?.message ?? JSON.stringify(body).slice(0, 200);
      record("sessions.create mutation", false, `${res.status} ${errMsg}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record("sessions.create mutation", false, msg);
  }
}

// ─── Test 5: SSE Connectivity ─────────────────────────────────────────────────

/**
 * Attempt to read the initial SSE chunk and determine the connection result.
 */
async function readSseInitialChunk(
  res: Response,
  _sessionId: string,
  start: number
): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    return `content-type=text/event-stream ${elapsed(start)}`;
  }

  const { value } = await reader.read();
  const text = value ? new TextDecoder().decode(value) : "";
  reader.cancel().catch(() => {
    // Intentionally ignoring cancel errors on SSE stream teardown
  });

  if (text.includes("event: connected")) {
    return `got "connected" event, ${elapsed(start)}`;
  }
  return `stream open, content-type ok, ${elapsed(start)}`;
}

async function testSseConnectivity() {
  header("SSE Connectivity");

  const sessionId = createdSessionId ?? SEED_SESSION_ID;
  const label = `SSE stream connected (session=${sessionId})`;

  try {
    const start = performance.now();
    const url = `${API_BASE}/api/sse/sessions/${sessionId}/stream?token=${DEV_TOKEN}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      const detail = await readSseInitialChunk(res, sessionId, start);
      record(label, true, detail ?? undefined);
    } else if (res.ok) {
      record(label, false, `Unexpected content-type: ${contentType}`);
    } else {
      const body = await res.text();
      record(label, false, `${res.status} ${body.slice(0, 200)}`);
    }

    clearTimeout(timer);
    controller.abort();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      record(label, false, "Timed out waiting for SSE response");
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      record(label, false, msg);
    }
  }
}

// ─── Tests 6-8: Service Health Checks ─────────────────────────────────────────

async function testServiceHealth(name: string, baseUrl: string) {
  try {
    const start = performance.now();
    const res = await fetchWithTimeout(`${baseUrl}/health`);

    if (res.ok) {
      record(`${name} health`, true, `${res.status} ${elapsed(start)}`);
    } else {
      const body = await res.text();
      record(`${name} health`, false, `${res.status} ${body.slice(0, 100)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(`${name} health`, false, msg);
  }
}

// ─── Test 9 (Optional): Full Task Execution ──────────────────────────────────

async function testFullTaskExecution() {
  header("Full Task Execution (--full)");

  if (!FULL_MODE) {
    recordSkip("Full task execution", "Pass --full flag to enable");
    return;
  }

  if (!createdSessionId) {
    record("Full task execution", false, "No session was created in step 4");
    return;
  }

  // Send a message to the session to kick off a task
  try {
    const start = performance.now();

    const payload = {
      json: {
        sessionId: createdSessionId,
        content: "Create a simple hello world function in TypeScript",
      },
    };

    const res = await fetchWithTimeout(
      `${API_BASE}/trpc/sessions.sendMessage`,
      {
        method: "POST",
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      15_000
    );

    if (res.ok) {
      record(
        "sessions.sendMessage",
        true,
        `Message sent to session ${createdSessionId}, ${elapsed(start)}`
      );
    } else {
      const body = await res.text();
      record(
        "sessions.sendMessage",
        false,
        `${res.status} ${body.slice(0, 200)}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record("sessions.sendMessage", false, msg);
  }

  // Poll for task status via SSE (brief listen)
  try {
    const start = performance.now();
    const url = `${API_BASE}/api/sse/sessions/${createdSessionId}/stream?token=${DEV_TOKEN}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body?.getReader();

    if (!reader) {
      record("Task execution stream", false, "No response body");
      clearTimeout(timer);
      return;
    }

    let receivedEvents = 0;
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (receivedEvents < 5) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        // Count SSE events in buffer
        const events = buffer
          .split("\n\n")
          .filter((chunk) => chunk.includes("event:"));
        receivedEvents = events.length;
      }
    } catch {
      // AbortError or stream close is expected
    }

    clearTimeout(timer);
    controller.abort();
    reader.cancel().catch(() => {
      // Intentionally ignoring cancel errors on SSE stream teardown
    });

    if (receivedEvents > 0) {
      record(
        "Task execution stream",
        true,
        `Received ${receivedEvents} event(s), ${elapsed(start)}`
      );
    } else {
      record(
        "Task execution stream",
        false,
        `No events received within timeout, ${elapsed(start)}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record("Task execution stream", false, msg);
  }
}

// ─── All Service Health Matrix ────────────────────────────────────────────────

interface ServiceDef {
  healthPath: string;
  name: string;
  port: number;
}

const ALL_SERVICES: ServiceDef[] = [
  { name: "api", port: 4000, healthPath: "/health" },
  { name: "socket-server", port: 4001, healthPath: "/health" },
  { name: "orchestrator", port: 4002, healthPath: "/health" },
  { name: "project-brain", port: 4003, healthPath: "/health" },
  { name: "model-router", port: 4004, healthPath: "/health" },
  { name: "mcp-gateway", port: 4005, healthPath: "/health" },
  { name: "sandbox-manager", port: 4006, healthPath: "/health" },
  { name: "queue-worker", port: 4007, healthPath: "/health" },
];

async function testAllServicesMatrix() {
  header("Service Health Matrix");

  const checks = await Promise.all(
    ALL_SERVICES.map(async (svc) => {
      const url = `http://localhost:${svc.port}${svc.healthPath}`;
      const start = performance.now();
      try {
        const res = await fetchWithTimeout(url, undefined, 5000);
        return {
          name: svc.name,
          ok: res.ok,
          status: res.status,
          time: elapsed(start),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          name: svc.name,
          ok: false,
          status: 0,
          time: elapsed(start),
          error: msg,
        };
      }
    })
  );

  const maxName = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const name = c.name.padEnd(maxName);
    const status = c.ok ? `${C.green}UP${C.reset}` : `${C.red}DOWN${C.reset}`;
    const detail = c.error
      ? `${C.dim}${c.error}${C.reset}`
      : `${C.dim}${c.status} ${c.time}${C.reset}`;
    console.log(`  ${status}  ${name}  ${detail}`);
  }

  const upCount = checks.filter((c) => c.ok).length;
  console.log(
    `\n  ${C.dim}${upCount}/${checks.length} services healthy${C.reset}`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.bold}${C.cyan}  Prometheus E2E Smoke Test${C.reset}`);
  console.log(
    `${C.dim}  ${new Date().toISOString()}${FULL_MODE ? " (--full mode)" : ""}${C.reset}`
  );

  // Run tests sequentially so session creation feeds into SSE test
  await testApiHealth();
  await testAuthDevBypass();
  await testDatabaseConnectivity();
  await testCreateSession();
  await testSseConnectivity();

  // Individual service health checks (required by spec)
  header("Service Health Checks");
  await testServiceHealth("Sandbox Manager", SANDBOX_MANAGER_BASE);
  await testServiceHealth("Model Router", MODEL_ROUTER_BASE);
  await testServiceHealth("Orchestrator", ORCHESTRATOR_BASE);

  await testFullTaskExecution();

  // Full matrix overview
  await testAllServicesMatrix();

  // ─── Summary ──────────────────────────────────────────────────────────────

  header("Summary");

  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;

  console.log(`  ${C.green}Passed:${C.reset}  ${passed}`);
  if (failed > 0) {
    console.log(`  ${C.red}Failed:${C.reset}  ${failed}`);
  }
  if (skipped > 0) {
    console.log(`  ${C.yellow}Skipped:${C.reset} ${skipped}`);
  }
  console.log(`  ${C.dim}Total:   ${results.length}${C.reset}\n`);

  if (failed > 0) {
    console.log(`${C.red}${C.bold}  Some tests failed.${C.reset}\n`);
    for (const r of results.filter((t) => !t.ok)) {
      console.log(
        `    ${C.red}-${C.reset} ${r.name}${r.detail ? `: ${r.detail}` : ""}`
      );
    }
    console.log();
    process.exit(1);
  }

  console.log(`${C.green}${C.bold}  All tests passed.${C.reset}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${C.red}Smoke test crashed:${C.reset}`, err);
  process.exit(1);
});
