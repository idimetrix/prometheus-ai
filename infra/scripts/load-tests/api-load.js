import { check, group, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";

// ─── Custom Metrics ──────────────────────────────────────────────
const errorRate = new Rate("errors");
const taskSubmitDuration = new Trend("task_submit_duration", true);
const _sseConnectionDuration = new Trend("sse_connection_duration", true);
const healthCheckDuration = new Trend("health_check_duration", true);
const projectListDuration = new Trend("project_list_duration", true);
const taskSubmitCount = new Counter("task_submits");

// ─── Scenarios ───────────────────────────────────────────────────
export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: 5,
      duration: "30s",
      tags: { scenario: "smoke" },
    },
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 25 },
        { duration: "3m", target: 50 },
        { duration: "1m", target: 50 },
        { duration: "1m", target: 0 },
      ],
      tags: { scenario: "load" },
      startTime: "35s",
    },
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 100 },
        { duration: "3m", target: 200 },
        { duration: "2m", target: 0 },
      ],
      tags: { scenario: "stress" },
      startTime: "7m",
    },
  },

  // ── SLO Thresholds ────────────────────────────────────────────
  thresholds: {
    // Overall
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    errors: ["rate<0.05"],

    // Task submission: <100ms p95
    task_submit_duration: ["p(95)<100", "p(99)<250"],

    // Health check: <50ms p95
    health_check_duration: ["p(95)<50"],

    // Project listing: <200ms p95
    project_list_duration: ["p(95)<200"],
  },
};

// ─── Config ──────────────────────────────────────────────────────
const BASE_URL = __ENV.API_URL || "http://localhost:4000";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";

const headers = {
  "Content-Type": "application/json",
  ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
};

// ─── Test Functions ──────────────────────────────────────────────
export default function () {
  group("Health Check", () => {
    const res = http.get(`${BASE_URL}/health`);
    healthCheckDuration.add(res.timings.duration);
    check(res, {
      "health status 200": (r) => r.status === 200,
      "health has status field": (r) => {
        try {
          return JSON.parse(r.body).status === "ok";
        } catch {
          return false;
        }
      },
      "health response < 50ms": (r) => r.timings.duration < 50,
    }) || errorRate.add(1);
  });

  group("tRPC Health", () => {
    const res = http.get(`${BASE_URL}/trpc/health.check`);
    check(res, {
      "trpc health status 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  if (AUTH_TOKEN) {
    group("List Projects", () => {
      const res = http.get(
        `${BASE_URL}/trpc/projects.list?input=${encodeURIComponent(JSON.stringify({}))}`,
        { headers }
      );
      projectListDuration.add(res.timings.duration);
      check(res, {
        "projects status 200": (r) => r.status === 200,
        "projects response < 200ms": (r) => r.timings.duration < 200,
      }) || errorRate.add(1);
    });

    group("Get Analytics", () => {
      const input = JSON.stringify({ days: 7 });
      const res = http.get(
        `${BASE_URL}/trpc/analytics.overview?input=${encodeURIComponent(input)}`,
        { headers }
      );
      check(res, {
        "analytics status 200": (r) => r.status === 200,
        "analytics response < 500ms": (r) => r.timings.duration < 500,
      }) || errorRate.add(1);
    });

    group("Get Credit Balance", () => {
      const res = http.get(`${BASE_URL}/trpc/billing.getBalance`, { headers });
      check(res, {
        "billing status 200": (r) => r.status === 200,
      }) || errorRate.add(1);
    });

    // Simulate task submission (1 in 10 iterations)
    if (Math.random() < 0.1) {
      group("Submit Task", () => {
        const payload = JSON.stringify({
          sessionId: `load-test-${__VU}-${__ITER}`,
          title: "Load test task",
          mode: "ask",
        });
        const res = http.post(`${BASE_URL}/trpc/tasks.submit`, payload, {
          headers,
        });
        taskSubmitDuration.add(res.timings.duration);
        taskSubmitCount.add(1);
        check(res, {
          "task submit status 200": (r) => r.status === 200,
          "task submit < 100ms": (r) => r.timings.duration < 100,
        }) || errorRate.add(1);
      });
    }
  }

  sleep(Math.random() * 2 + 0.5); // 0.5-2.5s between iterations
}

// ─── Setup / Teardown ────────────────────────────────────────────
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    scenarios: Object.keys(options.scenarios),
    metrics: {
      http_req_duration_p95: data.metrics.http_req_duration?.values?.["p(95)"],
      http_req_duration_p99: data.metrics.http_req_duration?.values?.["p(99)"],
      error_rate: data.metrics.errors?.values?.rate,
      task_submit_p95: data.metrics.task_submit_duration?.values?.["p(95)"],
      health_check_p95: data.metrics.health_check_duration?.values?.["p(95)"],
      total_requests: data.metrics.http_reqs?.values?.count,
      task_submits: data.metrics.task_submits?.values?.count,
    },
    thresholds_passed: Object.entries(data.root_group?.checks || {}).every(
      ([, v]) => v.passes > 0 && v.fails === 0
    ),
  };

  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    "load-test-results.json": JSON.stringify(summary, null, 2),
  };
}
