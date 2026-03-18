import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const sseConnectTime = new Trend("sse_connect_time", true);
const sseEventsReceived = new Counter("sse_events_received");

export const options = {
  scenarios: {
    sse_connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "2m", target: 25 },
        { duration: "1m", target: 50 },
        { duration: "2m", target: 50 },
        { duration: "30s", target: 0 },
      ],
    },
  },

  thresholds: {
    errors: ["rate<0.1"],
    sse_connect_time: ["p(95)<500"],
  },
};

// biome-ignore lint/correctness/noUndeclaredVariables: k6 global
const BASE_URL = __ENV.API_URL || "http://localhost:4000";
// biome-ignore lint/correctness/noUndeclaredVariables: k6 global
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";

export default function () {
  // biome-ignore lint/correctness/noUndeclaredVariables: k6 global
  const sessionId = `sse-load-test-${__VU % 3}`;
  const url = `${BASE_URL}/api/sse/session/${sessionId}`;
  const headers = AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};

  const startTime = Date.now();

  // SSE connections are long-lived HTTP - use timeout to control duration
  const res = http.get(url, {
    headers,
    timeout: "15s",
    tags: { name: "SSE" },
  });

  const connectTime = Date.now() - startTime;
  sseConnectTime.add(connectTime);

  check(res, {
    "SSE connected (200)": (r) => r.status === 200,
    "SSE has event-stream content type": (r) =>
      (r.headers["Content-Type"] || "").includes("text/event-stream"),
    "SSE received data": (r) => r.body && r.body.length > 0,
  }) || errorRate.add(1);

  // Count events in response (each event separated by double newline)
  if (res.body) {
    const events = res.body.split("\n\n").filter((e) => e.trim().length > 0);
    sseEventsReceived.add(events.length);
  }

  sleep(Math.random() * 2 + 1);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    type: "sse",
    metrics: {
      connect_time_p95: data.metrics.sse_connect_time?.values?.["p(95)"],
      error_rate: data.metrics.errors?.values?.rate,
      total_events: data.metrics.sse_events_received?.values?.count,
      total_requests: data.metrics.http_reqs?.values?.count,
    },
  };

  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    "sse-test-results.json": JSON.stringify(summary, null, 2),
  };
}
