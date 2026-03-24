/**
 * k6 Smoke Test — Prometheus Platform
 *
 * Validates core API endpoints under light load to catch regressions.
 *
 * Usage:
 *   k6 run tests/load/k6-smoke.js
 *   k6 run --env API_BASE=https://api.prometheus.dev tests/load/k6-smoke.js
 *   k6 run --env API_BASE=http://localhost:4000 tests/load/k6-smoke.js
 */

import { check, group, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

// ---------------------------------------------------------------------------
// Custom Metrics
// ---------------------------------------------------------------------------

const errorRate = new Rate("errors");
const healthLatency = new Trend("health_latency", true);
const taskSubmitLatency = new Trend("task_submit_latency", true);
const sessionStreamLatency = new Trend("session_stream_latency", true);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE = __ENV.API_BASE || "http://localhost:4000";
const API_KEY = __ENV.API_KEY || "test-api-key";

export const options = {
  // Smoke test: minimal load to verify correctness
  stages: [
    { duration: "10s", target: 5 }, // Ramp up to 5 VUs
    { duration: "30s", target: 5 }, // Hold at 5 VUs
    { duration: "10s", target: 10 }, // Ramp up to 10 VUs
    { duration: "30s", target: 10 }, // Hold at 10 VUs
    { duration: "10s", target: 0 }, // Ramp down
  ],

  thresholds: {
    http_req_duration: ["p(95)<2000"], // 95th percentile under 2s
    http_req_failed: ["rate<0.05"], // Less than 5% errors
    errors: ["rate<0.05"], // Custom error rate under 5%
    health_latency: ["p(95)<500"], // Health check under 500ms
    task_submit_latency: ["p(95)<3000"], // Task submission under 3s
  },
};

// ---------------------------------------------------------------------------
// Common Headers
// ---------------------------------------------------------------------------

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

// ---------------------------------------------------------------------------
// Test Scenarios
// ---------------------------------------------------------------------------

export default function () {
  // ── 1. Health Check ──────────────────────────────────────────────────

  group("API Health Check", () => {
    const res = http.get(`${API_BASE}/health`, { tags: { name: "health" } });
    const success = check(res, {
      "health status is 200": (r) => r.status === 200,
      "health response has status field": (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.status === "ok" || body.status === "healthy";
        } catch {
          return false;
        }
      },
      "health response time < 500ms": (r) => r.timings.duration < 500,
    });

    healthLatency.add(res.timings.duration);
    errorRate.add(!success);
  });

  sleep(0.5);

  // ── 2. Task Submission ───────────────────────────────────────────────

  group("Task Submission", () => {
    const payload = JSON.stringify({
      prompt: `k6 smoke test task — ${Date.now()}`,
      model: "gpt-4o-mini",
    });

    const res = http.post(`${API_BASE}/api/trpc/tasks.create`, payload, {
      headers,
      tags: { name: "task_create" },
    });

    const success = check(res, {
      "task create returns 200": (r) => r.status === 200,
      "task create response has result": (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.result !== undefined;
        } catch {
          return false;
        }
      },
      "task create response time < 3s": (r) => r.timings.duration < 3000,
    });

    taskSubmitLatency.add(res.timings.duration);
    errorRate.add(!success);
  });

  sleep(0.5);

  // ── 3. Session Streaming (SSE Connection) ────────────────────────────

  group("Session Streaming", () => {
    // Test the SSE endpoint connection (just verify it responds)
    const res = http.get(`${API_BASE}/api/trpc/sessions.list`, {
      headers,
      tags: { name: "session_list" },
      timeout: "5s",
    });

    const success = check(res, {
      "session list returns 200": (r) => r.status === 200,
      "session list response time < 2s": (r) => r.timings.duration < 2000,
    });

    sessionStreamLatency.add(res.timings.duration);
    errorRate.add(!success);
  });

  sleep(1);

  // ── 4. Readiness / Liveness Probes ───────────────────────────────────

  group("Readiness Probe", () => {
    const res = http.get(`${API_BASE}/ready`, {
      tags: { name: "readiness" },
    });

    check(res, {
      "readiness returns 200": (r) => r.status === 200,
    });
  });

  sleep(0.5);
}

// ---------------------------------------------------------------------------
// Lifecycle Hooks
// ---------------------------------------------------------------------------

export function setup() {
  // Verify the API is reachable before running tests
  const res = http.get(`${API_BASE}/health`);
  if (res.status !== 200) {
    console.warn(
      `API health check failed with status ${res.status}. Tests may fail.`
    );
  }
  return { startTime: new Date().toISOString() };
}

export function teardown(data) {
  console.log(`Test run started at: ${data.startTime}`);
  console.log(`Test run ended at: ${new Date().toISOString()}`);
}
