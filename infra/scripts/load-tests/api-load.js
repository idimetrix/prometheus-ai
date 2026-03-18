import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

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
        { duration: "1m", target: 50 },
        { duration: "3m", target: 50 },
        { duration: "1m", target: 100 },
        { duration: "3m", target: 100 },
        { duration: "1m", target: 0 },
      ],
      tags: { scenario: "load" },
    },
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 200 },
        { duration: "5m", target: 500 },
        { duration: "2m", target: 1000 },
        { duration: "5m", target: 1000 },
        { duration: "2m", target: 0 },
      ],
      tags: { scenario: "stress" },
      startTime: "10m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    errors: ["rate<0.05"],
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost:4000";

export default function () {
  // Health check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    "health status 200": (r) => r.status === 200,
    "health response time < 100ms": (r) => r.timings.duration < 100,
  }) || errorRate.add(1);

  // Queue stats (public endpoint)
  const queueRes = http.get(`${BASE_URL}/trpc/queue.stats`);
  check(queueRes, {
    "queue stats status 200": (r) => r.status === 200,
    "queue stats response time < 200ms": (r) => r.timings.duration < 200,
  }) || errorRate.add(1);

  sleep(1);
}
