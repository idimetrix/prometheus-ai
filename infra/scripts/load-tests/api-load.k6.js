import { check, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const apiLatency = new Trend("api_latency");

export const options = {
  scenarios: {
    ramp_up: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 100 },
        { duration: "1m", target: 500 },
        { duration: "2m", target: 1000 },
        { duration: "1m", target: 500 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<200"],
    errors: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost:4000";

export default function () {
  // Health check
  const health = http.get(`${BASE_URL}/health`);
  check(health, { "health 200": (r) => r.status === 200 });
  apiLatency.add(health.timings.duration);
  errorRate.add(health.status !== 200);

  // List projects (authenticated)
  const projects = http.get(`${BASE_URL}/trpc/projects.list`, {
    headers: { Authorization: `Bearer ${__ENV.API_TOKEN || "test-token"}` },
  });
  check(projects, { "projects 200": (r) => r.status === 200 });
  apiLatency.add(projects.timings.duration);
  errorRate.add(projects.status !== 200);

  sleep(1);
}
