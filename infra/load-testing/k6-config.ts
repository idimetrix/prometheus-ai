/**
 * k6 Load Testing Configuration — GAP-107
 *
 * Run with: k6 run --out json=results.json infra/load-testing/k6-config.ts
 *
 * Scenarios:
 * 1. smoke — Verify system works (1 VU, 30s)
 * 2. load — Normal load (50 VUs, 5m)
 * 3. stress — Peak load (200 VUs, 2m ramp + 5m sustain)
 * 4. spike — Sudden burst (10 → 500 VUs in 10s)
 * 5. soak — Endurance (50 VUs, 30m)
 */

export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: 1,
      duration: "30s",
      tags: { scenario: "smoke" },
    },
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "3m", target: 50 },
        { duration: "1m", target: 0 },
      ],
      tags: { scenario: "load" },
    },
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 200 },
        { duration: "5m", target: 200 },
        { duration: "2m", target: 0 },
      ],
      tags: { scenario: "stress" },
    },
    spike: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "10s", target: 500 },
        { duration: "1m", target: 500 },
        { duration: "10s", target: 10 },
      ],
      tags: { scenario: "spike" },
    },
    soak: {
      executor: "constant-vus",
      vus: 50,
      duration: "30m",
      tags: { scenario: "soak" },
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1500"],
    http_req_failed: ["rate<0.01"],
    http_reqs: ["rate>100"],
  },
};

const API_URL = __ENV.API_URL || "http://localhost:4000";
const API_KEY = __ENV.API_KEY || "pk_test_loadtest";

export default function () {
  // Health check
  const healthRes = http.get(`${API_URL}/health`);
  check(healthRes, {
    "health status 200": (r: { status: number }) => r.status === 200,
  });

  // List projects
  const projectsRes = http.get(`${API_URL}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  check(projectsRes, {
    "projects status 200": (r: { status: number }) => r.status === 200,
  });

  // Create task
  const taskRes = http.post(
    `${API_URL}/api/v2/tasks`,
    JSON.stringify({
      prompt: "Load test task",
      projectId: "proj_loadtest",
      mode: "ask",
    }),
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  check(taskRes, {
    "task created": (r: { status: number }) =>
      r.status === 200 || r.status === 201,
  });

  sleep(1);
}

// Type stubs for k6 (not a real TypeScript module)
declare const http: {
  get: (url: string, params?: Record<string, unknown>) => { status: number };
  post: (
    url: string,
    body: string,
    params?: Record<string, unknown>
  ) => { status: number };
};
declare const check: (
  res: unknown,
  checks: Record<string, (r: unknown) => boolean>
) => void;
declare const sleep: (seconds: number) => void;
declare const __ENV: Record<string, string>;
