import ws from "k6/ws";
import { check } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

export const options = {
  scenarios: {
    websocket: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "3m", target: 50 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    errors: ["rate<0.1"],
  },
};

const WS_URL = __ENV.WS_URL || "ws://localhost:4001";

export default function () {
  const res = ws.connect(`${WS_URL}/sessions`, {}, function (socket) {
    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "join_session",
        sessionId: "load-test-session",
      }));
    });

    socket.on("message", (data) => {
      check(data, {
        "received message": (d) => d.length > 0,
      }) || errorRate.add(1);
    });

    socket.on("error", (e) => {
      errorRate.add(1);
    });

    socket.setTimeout(() => {
      socket.close();
    }, 10000);
  });

  check(res, {
    "websocket connected": (r) => r && r.status === 101,
  }) || errorRate.add(1);
}
