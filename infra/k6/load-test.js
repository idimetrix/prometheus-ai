/**
 * Prometheus Platform — k6 Load Test Suite
 *
 * Scenarios:
 *   - smoke: Quick validation (5 VUs, 30s)
 *   - load: Standard load test (100 concurrent users, 5min sustained)
 *   - stress: Peak traffic simulation (200 VUs, ramp up/down)
 *
 * Thresholds:
 *   - p99 response time < 200ms
 *   - Error rate < 1%
 *   - Fail deployment if p99 regresses > 20% from baseline
 *
 * Usage:
 *   k6 run infra/k6/load-test.js
 *   k6 run --env BASE_URL=https://api.prometheus.dev infra/k6/load-test.js
 *   k6 run --env SCENARIO=smoke infra/k6/load-test.js
 */

import { check, group, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";
import ws from "k6/ws";

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const WS_URL = __ENV.WS_URL || "ws://localhost:4001";
const API_TOKEN = __ENV.API_TOKEN || "";
const BASELINE_P99 = Number.parseFloat(__ENV.BASELINE_P99 || "200"); // ms

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const healthCheckDuration = new Trend("health_check_duration", true);
const apiCrudDuration = new Trend("api_crud_duration", true);
const wsConnectionDuration = new Trend("ws_connection_duration", true);
const errorRate = new Rate("error_rate");
const regressionCounter = new Counter("p99_regressions");

// ─── Scenarios ────────────────────────────────────────────────────────────────

const selectedScenario = __ENV.SCENARIO || "load";

const scenarios = {
  smoke: {
    smoke: {
      executor: "constant-vus",
      vus: 5,
      duration: "30s",
    },
  },
  load: {
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 }, // Ramp up to 50
        { duration: "1m", target: 100 }, // Ramp to 100
        { duration: "3m", target: 100 }, // Sustain 100 VUs for 3 min
        { duration: "30s", target: 50 }, // Ramp down
        { duration: "30s", target: 0 }, // Cool down
      ],
      gracefulRampDown: "10s",
    },
  },
  stress: {
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "2m", target: 100 },
        { duration: "2m", target: 200 },
        { duration: "3m", target: 200 }, // Peak
        { duration: "1m", target: 100 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
};

export const options = {
  scenarios: scenarios[selectedScenario] || scenarios.load,
  thresholds: {
    // Global thresholds
    http_req_duration: [
      "p(95)<150", // 95th percentile under 150ms
      "p(99)<200", // 99th percentile under 200ms
    ],
    error_rate: ["rate<0.01"], // Error rate under 1%

    // Per-endpoint thresholds
    health_check_duration: ["p(99)<100"], // Health check: fast
    api_crud_duration: ["p(99)<200"], // CRUD operations: reasonable
    ws_connection_duration: ["p(99)<500"], // WebSocket: connection overhead

    // Regression check
    p99_regressions: ["count<1"], // No regressions allowed
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };
  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }
  return headers;
}

function checkResponse(res, name) {
  const passed = check(res, {
    [`${name}: status is 200`]: (r) => r.status === 200,
    [`${name}: response time < 500ms`]: (r) => r.timings.duration < 500,
    [`${name}: has body`]: (r) => r.body && r.body.length > 0,
  });

  errorRate.add(!passed);

  // Check for p99 regression
  if (res.timings.duration > BASELINE_P99 * 1.2) {
    regressionCounter.add(1);
  }

  return passed;
}

// ─── Test Scenarios ───────────────────────────────────────────────────────────

export default function () {
  // Distribute traffic across endpoint types
  const rand = Math.random();
  if (rand < 0.4) {
    testHealthEndpoint();
  } else if (rand < 0.85) {
    testApiCrud();
  } else {
    testWebSocketConnection();
  }
  sleep(0.5 + Math.random() * 1.5); // 0.5-2s think time
}

// ─── Health Endpoint ──────────────────────────────────────────────────────────

function testHealthEndpoint() {
  group("Health Check", () => {
    const res = http.get(`${BASE_URL}/api/trpc/health.check`, {
      headers: getHeaders(),
      tags: { endpoint: "health" },
    });

    healthCheckDuration.add(res.timings.duration);
    checkResponse(res, "health");
  });
}

// ─── API CRUD Operations ──────────────────────────────────────────────────────

function testApiCrud() {
  group("API CRUD", () => {
    // List projects (GET)
    const listRes = http.get(
      `${BASE_URL}/api/trpc/projects.list?input=${encodeURIComponent(JSON.stringify({ json: { limit: 10 } }))}`,
      {
        headers: getHeaders(),
        tags: { endpoint: "projects.list" },
      }
    );
    apiCrudDuration.add(listRes.timings.duration);
    checkResponse(listRes, "projects.list");

    // Get session list
    const sessionsRes = http.get(
      `${BASE_URL}/api/trpc/sessions.list?input=${encodeURIComponent(JSON.stringify({ json: { limit: 5 } }))}`,
      {
        headers: getHeaders(),
        tags: { endpoint: "sessions.list" },
      }
    );
    apiCrudDuration.add(sessionsRes.timings.duration);
    checkResponse(sessionsRes, "sessions.list");

    // Get tasks
    const tasksRes = http.get(
      `${BASE_URL}/api/trpc/tasks.list?input=${encodeURIComponent(JSON.stringify({ json: { limit: 10 } }))}`,
      {
        headers: getHeaders(),
        tags: { endpoint: "tasks.list" },
      }
    );
    apiCrudDuration.add(tasksRes.timings.duration);
    checkResponse(tasksRes, "tasks.list");

    // Get user profile (read-only, safe for load test)
    const profileRes = http.get(`${BASE_URL}/api/trpc/user.profile`, {
      headers: getHeaders(),
      tags: { endpoint: "user.profile" },
    });
    apiCrudDuration.add(profileRes.timings.duration);
    checkResponse(profileRes, "user.profile");

    // Get billing stats
    const billingRes = http.get(`${BASE_URL}/api/trpc/billing.getBalance`, {
      headers: getHeaders(),
      tags: { endpoint: "billing.balance" },
    });
    apiCrudDuration.add(billingRes.timings.duration);
    checkResponse(billingRes, "billing.balance");
  });
}

// ─── WebSocket Connection ─────────────────────────────────────────────────────

function testWebSocketConnection() {
  group("WebSocket", () => {
    const startTime = Date.now();

    const res = ws.connect(WS_URL, null, (socket) => {
      socket.on("open", () => {
        const elapsed = Date.now() - startTime;
        wsConnectionDuration.add(elapsed);

        // Send a ping
        socket.send(JSON.stringify({ type: "ping" }));
      });

      socket.on("message", (msg) => {
        check(msg, {
          "ws: received message": (m) => m.length > 0,
        });
      });

      socket.on("error", (_e) => {
        errorRate.add(true);
      });

      // Keep connection open briefly to simulate real usage
      socket.setTimeout(() => {
        socket.close();
      }, 2000);
    });

    const passed = check(res, {
      "ws: connected successfully": (r) => r && r.status === 101,
    });

    if (!passed) {
      errorRate.add(true);
    }
  });
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const p99 = data.metrics.http_req_duration
    ? data.metrics.http_req_duration.values["p(99)"]
    : 0;
  const errors = data.metrics.error_rate
    ? data.metrics.error_rate.values.rate
    : 0;
  const regressions = data.metrics.p99_regressions
    ? data.metrics.p99_regressions.values.count
    : 0;

  const passed = p99 < 200 && errors < 0.01 && regressions === 0;

  const summary = {
    status: passed ? "PASSED" : "FAILED",
    p99_ms: Math.round(p99 * 100) / 100,
    error_rate: `${Math.round(errors * 10_000) / 100}%`,
    baseline_p99_ms: BASELINE_P99,
    regression_detected: regressions > 0,
    regression_threshold: "20%",
    timestamp: new Date().toISOString(),
  };

  console.log("\n═══════════════════════════════════════════════");
  console.log("  Prometheus Load Test Results");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Status:       ${summary.status}`);
  console.log(`  p99:          ${summary.p99_ms}ms (threshold: 200ms)`);
  console.log(`  Error rate:   ${summary.error_rate} (threshold: 1%)`);
  console.log(`  Regression:   ${summary.regression_detected ? "YES" : "No"}`);
  console.log(`  Baseline p99: ${summary.baseline_p99_ms}ms`);
  console.log("═══════════════════════════════════════════════\n");

  return {
    stdout: JSON.stringify(summary, null, 2),
    "load-test-results.json": JSON.stringify(data, null, 2),
  };
}
