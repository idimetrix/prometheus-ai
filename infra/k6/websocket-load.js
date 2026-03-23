/* biome-ignore-all lint/correctness/noUndeclaredVariables: k6 provides __ENV as a global */
/**
 * Prometheus Platform — k6 WebSocket Streaming Reliability Load Test
 *
 * GAP-007: Verifies streaming reliability under concurrent load.
 *
 * Scenarios:
 *   - sustained: 100 concurrent WebSocket connections for 5 minutes
 *   - burst: Rapid connect/disconnect cycles
 *
 * Measures:
 *   - Connection establishment time
 *   - Message latency (send to receive)
 *   - Message ordering via sequence numbers
 *   - Reconnection time after disconnect
 *   - Dropped message count
 *
 * Thresholds:
 *   - p95 message latency < 500ms
 *   - 0 dropped messages
 *   - 0 out-of-order messages
 *
 * Usage:
 *   k6 run infra/k6/websocket-load.js
 *   k6 run --env WS_URL=ws://localhost:4001 infra/k6/websocket-load.js
 *   k6 run --env SCENARIO=burst infra/k6/websocket-load.js
 *   k6 run --env DURATION=10m infra/k6/websocket-load.js
 */

import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import ws from "k6/ws";

// ─── Configuration ────────────────────────────────────────────────────────────

const WS_URL = __ENV.WS_URL || "ws://localhost:4001";
const API_TOKEN = __ENV.API_TOKEN || "";
const DURATION = __ENV.DURATION || "5m";

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const wsConnectDuration = new Trend("ws_connect_duration", true);
const wsMessageLatency = new Trend("ws_message_latency", true);
const wsReconnectDuration = new Trend("ws_reconnect_duration", true);
const wsDroppedMessages = new Counter("ws_dropped_messages");
const wsOutOfOrderMessages = new Counter("ws_out_of_order_messages");
const wsConnectionErrors = new Counter("ws_connection_errors");
const wsMessagesSent = new Counter("ws_messages_sent");
const wsMessagesReceived = new Counter("ws_messages_received");
const wsSuccessRate = new Rate("ws_success_rate");

// ─── Scenarios ────────────────────────────────────────────────────────────────

const selectedScenario = __ENV.SCENARIO || "sustained";

const scenarios = {
  sustained: {
    sustained_connections: {
      executor: "constant-vus",
      vus: 100,
      duration: DURATION,
    },
  },
  burst: {
    burst_connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "30s", target: 100 },
        { duration: "1m", target: 100 },
        { duration: "15s", target: 0 },
        { duration: "15s", target: 100 },
        { duration: "1m", target: 100 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
};

export const options = {
  scenarios: scenarios[selectedScenario] || scenarios.sustained,
  thresholds: {
    ws_message_latency: ["p(95)<500"], // p95 latency < 500ms
    ws_dropped_messages: ["count==0"], // Zero dropped messages
    ws_out_of_order_messages: ["count==0"], // Zero out-of-order messages
    ws_success_rate: ["rate>0.95"], // 95% success rate
    ws_connect_duration: ["p(95)<2000"], // Connection under 2s at p95
  },
};

// ─── Test Logic ───────────────────────────────────────────────────────────────

export default function () {
  const sessionId = `bench-${__VU}-${Date.now()}`;
  const connectStart = Date.now();

  const params = {};
  if (API_TOKEN) {
    params.headers = { Authorization: `Bearer ${API_TOKEN}` };
  }

  const res = ws.connect(
    `${WS_URL}?sessionId=${sessionId}`,
    params,
    (socket) => {
      let lastSeq = -1;
      let expectedResponses = 0;
      let receivedResponses = 0;

      socket.on("open", () => {
        const connectTime = Date.now() - connectStart;
        wsConnectDuration.add(connectTime);

        // Subscribe to session events
        socket.send(
          JSON.stringify({
            type: "subscribe",
            channel: `session:${sessionId}`,
          })
        );

        // Send a series of numbered messages to verify ordering
        for (let i = 0; i < 10; i++) {
          const sendTime = Date.now();
          socket.send(
            JSON.stringify({
              type: "ping",
              seq: i,
              sendTime,
              sessionId,
            })
          );
          wsMessagesSent.add(1);
          expectedResponses++;
        }
      });

      socket.on("message", (raw) => {
        wsMessagesReceived.add(1);
        receivedResponses++;

        try {
          const msg = JSON.parse(raw);

          // Check message ordering
          if (typeof msg.seq === "number") {
            if (msg.seq <= lastSeq) {
              wsOutOfOrderMessages.add(1);
            }
            lastSeq = msg.seq;

            // Measure latency
            if (msg.sendTime) {
              const latency = Date.now() - msg.sendTime;
              wsMessageLatency.add(latency);
            }
          }
        } catch (_e) {
          // Non-JSON message (e.g., heartbeat), ignore parse errors
        }
      });

      socket.on("error", (_e) => {
        wsConnectionErrors.add(1);
        wsSuccessRate.add(false);
      });

      // Keep connection open to receive all responses
      socket.setTimeout(() => {
        // Check for dropped messages
        const dropped = expectedResponses - receivedResponses;
        if (dropped > 0) {
          wsDroppedMessages.add(dropped);
        }

        wsSuccessRate.add(true);
        socket.close();
      }, 5000);
    }
  );

  const connected = check(res, {
    "ws: connected (status 101)": (r) => r && r.status === 101,
  });

  if (!connected) {
    wsConnectionErrors.add(1);
    wsSuccessRate.add(false);
  }

  // Test reconnection
  if (Math.random() < 0.1) {
    testReconnection(sessionId, params);
  }

  sleep(1 + Math.random() * 2);
}

// ─── Reconnection Test ───────────────────────────────────────────────────────

function testReconnection(sessionId, params) {
  const reconnectStart = Date.now();

  const res = ws.connect(
    `${WS_URL}?sessionId=${sessionId}&reconnect=true`,
    params,
    (socket) => {
      socket.on("open", () => {
        const reconnectTime = Date.now() - reconnectStart;
        wsReconnectDuration.add(reconnectTime);

        // Verify we can still send/receive after reconnecting
        socket.send(
          JSON.stringify({
            type: "ping",
            seq: 0,
            reconnect: true,
            sendTime: Date.now(),
          })
        );
        wsMessagesSent.add(1);
      });

      socket.on("message", () => {
        wsMessagesReceived.add(1);
      });

      socket.setTimeout(() => {
        socket.close();
      }, 2000);
    }
  );

  check(res, {
    "ws reconnect: connected (status 101)": (r) => r && r.status === 101,
  });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const latencyP95 = data.metrics.ws_message_latency
    ? data.metrics.ws_message_latency.values["p(95)"]
    : 0;
  const dropped = data.metrics.ws_dropped_messages
    ? data.metrics.ws_dropped_messages.values.count
    : 0;
  const outOfOrder = data.metrics.ws_out_of_order_messages
    ? data.metrics.ws_out_of_order_messages.values.count
    : 0;
  const sent = data.metrics.ws_messages_sent
    ? data.metrics.ws_messages_sent.values.count
    : 0;
  const received = data.metrics.ws_messages_received
    ? data.metrics.ws_messages_received.values.count
    : 0;
  const connectP95 = data.metrics.ws_connect_duration
    ? data.metrics.ws_connect_duration.values["p(95)"]
    : 0;
  const errors = data.metrics.ws_connection_errors
    ? data.metrics.ws_connection_errors.values.count
    : 0;

  const passed = latencyP95 < 500 && dropped === 0 && outOfOrder === 0;

  const summary = {
    status: passed ? "PASSED" : "FAILED",
    message_latency_p95_ms: Math.round(latencyP95 * 100) / 100,
    connect_time_p95_ms: Math.round(connectP95 * 100) / 100,
    messages_sent: sent,
    messages_received: received,
    dropped_messages: dropped,
    out_of_order_messages: outOfOrder,
    connection_errors: errors,
    timestamp: new Date().toISOString(),
  };

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  WebSocket Streaming Reliability Test Results");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Status:            ${summary.status}`);
  console.log(
    `  Latency p95:       ${summary.message_latency_p95_ms}ms (threshold: 500ms)`
  );
  console.log(`  Connect p95:       ${summary.connect_time_p95_ms}ms`);
  console.log(`  Messages sent:     ${summary.messages_sent}`);
  console.log(`  Messages received: ${summary.messages_received}`);
  console.log(`  Dropped messages:  ${summary.dropped_messages}`);
  console.log(`  Out-of-order:      ${summary.out_of_order_messages}`);
  console.log(`  Connection errors: ${summary.connection_errors}`);
  console.log("═══════════════════════════════════════════════════\n");

  return {
    stdout: JSON.stringify(summary, null, 2),
    "websocket-load-results.json": JSON.stringify(data, null, 2),
  };
}
