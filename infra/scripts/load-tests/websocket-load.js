import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import ws from "k6/ws";

const errorRate = new Rate("errors");
const connectionTime = new Trend("ws_connection_time", true);
const messageLatency = new Trend("ws_message_latency", true);
const connectionsOpened = new Counter("ws_connections_opened");
const messagesReceived = new Counter("ws_messages_received");

export const options = {
  scenarios: {
    // Simulate users connecting to watch sessions
    watchers: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 25 },
        { duration: "2m", target: 50 },
        { duration: "1m", target: 50 },
        { duration: "30s", target: 0 },
      ],
      tags: { scenario: "watchers" },
    },
    // Simulate concurrent session viewers
    concurrent_sessions: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 5,
      maxDuration: "3m",
      tags: { scenario: "concurrent_sessions" },
      startTime: "4m30s",
    },
  },

  thresholds: {
    errors: ["rate<0.1"],
    ws_connection_time: ["p(95)<1000"],
    ws_message_latency: ["p(95)<100"], // SSE event delivery <100ms
  },
};

const WS_URL = __ENV.WS_URL || "ws://localhost:4001";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";

export default function () {
  const sessionId = `load-test-session-${__VU % 5}`; // 5 shared sessions
  const url = `${WS_URL}/sessions`;
  const params = AUTH_TOKEN
    ? { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
    : {};

  const startTime = Date.now();

  const res = ws.connect(url, params, (socket) => {
    socket.on("open", () => {
      const connTime = Date.now() - startTime;
      connectionTime.add(connTime);
      connectionsOpened.add(1);

      // Join session room
      socket.send(
        JSON.stringify({
          type: "join_session",
          sessionId,
        })
      );
    });

    socket.on("message", (data) => {
      messagesReceived.add(1);

      try {
        const msg = JSON.parse(data);

        // Measure event delivery latency if timestamp is present
        if (msg.timestamp) {
          const serverTime = new Date(msg.timestamp).getTime();
          const latency = Date.now() - serverTime;
          if (latency > 0 && latency < 30_000) {
            messageLatency.add(latency);
          }
        }

        check(msg, {
          "message has type": (m) =>
            m.type !== undefined || m.event !== undefined,
        }) || errorRate.add(1);
      } catch {
        // Non-JSON message (e.g., heartbeat)
        check(data, {
          "received data": (d) => d.length > 0,
        });
      }
    });

    socket.on("error", (_e) => {
      errorRate.add(1);
    });

    // Send periodic pings to keep connection alive
    socket.setInterval(() => {
      socket.send(JSON.stringify({ type: "ping" }));
    }, 5000);

    // Stay connected for 15-30 seconds
    const duration = 15_000 + Math.random() * 15_000;
    socket.setTimeout(() => {
      // Leave session before disconnecting
      socket.send(
        JSON.stringify({
          type: "leave_session",
          sessionId,
        })
      );
      socket.close();
    }, duration);
  });

  check(res, {
    "websocket connected": (r) => r && r.status === 101,
  }) || errorRate.add(1);

  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    type: "websocket",
    metrics: {
      connection_time_p95: data.metrics.ws_connection_time?.values?.["p(95)"],
      message_latency_p95: data.metrics.ws_message_latency?.values?.["p(95)"],
      error_rate: data.metrics.errors?.values?.rate,
      total_connections: data.metrics.ws_connections_opened?.values?.count,
      total_messages: data.metrics.ws_messages_received?.values?.count,
    },
  };

  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    "websocket-test-results.json": JSON.stringify(summary, null, 2),
  };
}
