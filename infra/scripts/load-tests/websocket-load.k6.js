import { check } from "k6";
import { Rate } from "k6/metrics";
import ws from "k6/ws";

const connectionErrors = new Rate("ws_connection_errors");

export const options = {
  scenarios: {
    websocket_connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 1000 },
        { duration: "2m", target: 5000 },
        { duration: "2m", target: 10_000 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    ws_connection_errors: ["rate<0.05"],
  },
};

const WS_URL = __ENV.WS_URL || "ws://localhost:4001";

export default function () {
  const res = ws.connect(
    `${WS_URL}/socket.io/?EIO=4&transport=websocket`,
    {},
    (socket) => {
      socket.on("open", () => {
        socket.send('40{"token":"test-token"}');
      });

      socket.on("message", (msg) => {
        if (msg.startsWith("40")) {
          // Connected successfully
          socket.send('42["subscribe",{"sessionId":"load-test"}]');
        }
      });

      socket.on("error", (_e) => {
        connectionErrors.add(true);
      });

      socket.setTimeout(() => {
        socket.close();
      }, 30_000);
    }
  );

  check(res, { "ws status 101": (r) => r && r.status === 101 });
  connectionErrors.add(!res || res.status !== 101);
}
