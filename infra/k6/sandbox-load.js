/**
 * Prometheus Platform — k6 Sandbox Stability Load Test
 *
 * GAP-008: Verifies sandbox create/execute/destroy cycles under concurrent load.
 *
 * Scenarios:
 *   - stability: 20 concurrent sandbox lifecycle cycles
 *   - stress: Ramp up to 40 concurrent sandboxes
 *
 * Measures:
 *   - Sandbox creation time
 *   - Command execution time
 *   - Sandbox cleanup/destroy time
 *   - Resource leaks (active containers before/after)
 *
 * Thresholds:
 *   - Creation time < 10s
 *   - Execution time < 5s
 *   - Cleanup time < 3s
 *   - No resource leaks
 *
 * Usage:
 *   k6 run infra/k6/sandbox-load.js
 *   k6 run --env SANDBOX_URL=http://localhost:4006 infra/k6/sandbox-load.js
 *   k6 run --env SCENARIO=stress infra/k6/sandbox-load.js
 */

import { check, group, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";

// ─── Configuration ────────────────────────────────────────────────────────────

const SANDBOX_URL = __ENV.SANDBOX_URL || "http://localhost:4006";
const API_TOKEN = __ENV.API_TOKEN || "";
const DURATION = __ENV.DURATION || "5m";

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const sandboxCreateDuration = new Trend("sandbox_create_duration", true);
const sandboxExecDuration = new Trend("sandbox_exec_duration", true);
const sandboxDestroyDuration = new Trend("sandbox_destroy_duration", true);
const sandboxLifecycleDuration = new Trend("sandbox_lifecycle_duration", true);
const sandboxCreateErrors = new Counter("sandbox_create_errors");
const sandboxExecErrors = new Counter("sandbox_exec_errors");
const sandboxDestroyErrors = new Counter("sandbox_destroy_errors");
const sandboxLeaks = new Counter("sandbox_resource_leaks");
const sandboxSuccessRate = new Rate("sandbox_success_rate");

// ─── Scenarios ────────────────────────────────────────────────────────────────

const selectedScenario = __ENV.SCENARIO || "stability";

const scenarios = {
  stability: {
    sandbox_cycles: {
      executor: "constant-vus",
      vus: 20,
      duration: DURATION,
    },
  },
  stress: {
    sandbox_stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 20 },
        { duration: "2m", target: 40 },
        { duration: "2m", target: 40 },
        { duration: "1m", target: 20 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
};

export const options = {
  scenarios: scenarios[selectedScenario] || scenarios.stability,
  thresholds: {
    sandbox_create_duration: ["p(95)<10000"], // Creation < 10s
    sandbox_exec_duration: ["p(95)<5000"], // Execution < 5s
    sandbox_destroy_duration: ["p(95)<3000"], // Cleanup < 3s
    sandbox_resource_leaks: ["count==0"], // No resource leaks
    sandbox_success_rate: ["rate>0.90"], // 90% success rate
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }
  return headers;
}

function getActiveContainerCount() {
  const res = http.get(`${SANDBOX_URL}/api/sandboxes/active`, {
    headers: getHeaders(),
    tags: { endpoint: "active_count" },
  });

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      return body.count || 0;
    } catch (_e) {
      return -1;
    }
  }
  return -1;
}

// ─── Test Logic ───────────────────────────────────────────────────────────────

export default function () {
  const lifecycleStart = Date.now();
  const sandboxTag = `bench-${__VU}-${Date.now()}`;
  let sandboxId = null;
  let success = true;

  // Check active containers before
  const containersBefore = getActiveContainerCount();

  // ─── Phase 1: Create Sandbox ────────────────────────────────────────────

  group("Create Sandbox", () => {
    const createStart = Date.now();

    const createRes = http.post(
      `${SANDBOX_URL}/api/sandboxes`,
      JSON.stringify({
        name: sandboxTag,
        image: "node:20-slim",
        timeout: 60,
        memoryMb: 256,
        cpuShares: 512,
      }),
      {
        headers: getHeaders(),
        tags: { endpoint: "sandbox.create" },
        timeout: "15s",
      }
    );

    const createDuration = Date.now() - createStart;
    sandboxCreateDuration.add(createDuration);

    const created = check(createRes, {
      "sandbox create: status 200 or 201": (r) =>
        r.status === 200 || r.status === 201,
      "sandbox create: has id": (r) => {
        try {
          const body = JSON.parse(r.body);
          return !!body.id;
        } catch (_e) {
          return false;
        }
      },
      "sandbox create: under 10s": () => createDuration < 10_000,
    });

    if (created) {
      try {
        sandboxId = JSON.parse(createRes.body).id;
      } catch (_e) {
        sandboxId = null;
      }
    } else {
      sandboxCreateErrors.add(1);
      success = false;
    }
  });

  // ─── Phase 2: Execute Commands ──────────────────────────────────────────

  if (sandboxId) {
    group("Execute Commands", () => {
      // Execute a simple echo command
      const execCommands = [
        { cmd: "echo 'hello from sandbox'", label: "echo" },
        { cmd: 'node -e "console.log(1+1)"', label: "node-eval" },
        { cmd: "ls -la /tmp", label: "ls" },
      ];

      for (const { cmd, label } of execCommands) {
        const execStart = Date.now();

        const execRes = http.post(
          `${SANDBOX_URL}/api/sandboxes/${sandboxId}/exec`,
          JSON.stringify({ command: cmd }),
          {
            headers: getHeaders(),
            tags: { endpoint: `sandbox.exec.${label}` },
            timeout: "10s",
          }
        );

        const execDuration = Date.now() - execStart;
        sandboxExecDuration.add(execDuration);

        const executed = check(execRes, {
          [`exec ${label}: status 200`]: (r) => r.status === 200,
          [`exec ${label}: has output`]: (r) => {
            try {
              const body = JSON.parse(r.body);
              return body.output !== undefined || body.stdout !== undefined;
            } catch (_e) {
              return false;
            }
          },
          [`exec ${label}: under 5s`]: () => execDuration < 5000,
        });

        if (!executed) {
          sandboxExecErrors.add(1);
          success = false;
        }
      }
    });
  }

  // ─── Phase 3: Destroy Sandbox ───────────────────────────────────────────

  if (sandboxId) {
    group("Destroy Sandbox", () => {
      const destroyStart = Date.now();

      const destroyRes = http.del(
        `${SANDBOX_URL}/api/sandboxes/${sandboxId}`,
        null,
        {
          headers: getHeaders(),
          tags: { endpoint: "sandbox.destroy" },
          timeout: "10s",
        }
      );

      const destroyDuration = Date.now() - destroyStart;
      sandboxDestroyDuration.add(destroyDuration);

      const destroyed = check(destroyRes, {
        "sandbox destroy: status 200 or 204": (r) =>
          r.status === 200 || r.status === 204,
        "sandbox destroy: under 3s": () => destroyDuration < 3000,
      });

      if (!destroyed) {
        sandboxDestroyErrors.add(1);
        success = false;
      }
    });
  }

  // ─── Phase 4: Verify No Resource Leaks ──────────────────────────────────

  if (containersBefore >= 0) {
    // Brief pause to let cleanup finish
    sleep(1);
    const containersAfter = getActiveContainerCount();

    if (containersAfter >= 0 && containersAfter > containersBefore) {
      sandboxLeaks.add(1);
    }
  }

  // Record lifecycle metrics
  const lifecycleDuration = Date.now() - lifecycleStart;
  sandboxLifecycleDuration.add(lifecycleDuration);
  sandboxSuccessRate.add(success);

  // Think time between cycles
  sleep(2 + Math.random() * 3);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const createP95 = data.metrics.sandbox_create_duration
    ? data.metrics.sandbox_create_duration.values["p(95)"]
    : 0;
  const execP95 = data.metrics.sandbox_exec_duration
    ? data.metrics.sandbox_exec_duration.values["p(95)"]
    : 0;
  const destroyP95 = data.metrics.sandbox_destroy_duration
    ? data.metrics.sandbox_destroy_duration.values["p(95)"]
    : 0;
  const leaks = data.metrics.sandbox_resource_leaks
    ? data.metrics.sandbox_resource_leaks.values.count
    : 0;
  const createErrors = data.metrics.sandbox_create_errors
    ? data.metrics.sandbox_create_errors.values.count
    : 0;
  const execErrors = data.metrics.sandbox_exec_errors
    ? data.metrics.sandbox_exec_errors.values.count
    : 0;
  const destroyErrors = data.metrics.sandbox_destroy_errors
    ? data.metrics.sandbox_destroy_errors.values.count
    : 0;

  const passed =
    createP95 < 10_000 && execP95 < 5000 && destroyP95 < 3000 && leaks === 0;

  const summary = {
    status: passed ? "PASSED" : "FAILED",
    create_time_p95_ms: Math.round(createP95 * 100) / 100,
    exec_time_p95_ms: Math.round(execP95 * 100) / 100,
    destroy_time_p95_ms: Math.round(destroyP95 * 100) / 100,
    resource_leaks: leaks,
    errors: {
      create: createErrors,
      exec: execErrors,
      destroy: destroyErrors,
    },
    timestamp: new Date().toISOString(),
  };

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Sandbox Stability Load Test Results");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Status:           ${summary.status}`);
  console.log(
    `  Create p95:       ${summary.create_time_p95_ms}ms (threshold: 10000ms)`
  );
  console.log(
    `  Execute p95:      ${summary.exec_time_p95_ms}ms (threshold: 5000ms)`
  );
  console.log(
    `  Destroy p95:      ${summary.destroy_time_p95_ms}ms (threshold: 3000ms)`
  );
  console.log(`  Resource leaks:   ${summary.resource_leaks}`);
  console.log(
    `  Errors:           create=${summary.errors.create} exec=${summary.errors.exec} destroy=${summary.errors.destroy}`
  );
  console.log("═══════════════════════════════════════════════════\n");

  return {
    stdout: JSON.stringify(summary, null, 2),
    "sandbox-load-results.json": JSON.stringify(data, null, 2),
  };
}
