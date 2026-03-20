import { createServer } from "node:http";
import { createLogger } from "@prometheus/logger";
import {
  agentExecutionWorkflow,
  fleetCoordinationWorkflow,
  inngest,
} from "@prometheus/workflow";

const logger = createLogger("queue-worker:inngest");

/**
 * All Inngest functions registered for the Prometheus platform.
 *
 * BullMQ continues to handle simple jobs (credit reconciliation, notifications,
 * sandbox cleanup, etc.). Inngest handles durable, multi-step workflows that
 * benefit from step-level checkpointing and automatic retry.
 */
const functions = [agentExecutionWorkflow, fleetCoordinationWorkflow];

const port = Number(process.env.INNGEST_PORT ?? 4008);

/**
 * Create an HTTP server that serves Inngest function metadata and handles invocations.
 * When the real Inngest SDK is fully wired, this can be replaced with
 * `serve({ client: inngest, functions, servePath: '/api/inngest' })`
 * from `inngest/node`.
 */
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname !== "/api/inngest") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    // Return function metadata for Inngest discovery
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          functions: functions.map((_f, index) => ({
            id: `prometheus-fn-${index}`,
          })),
          inngestClientId: inngest.id,
          status: "ready",
        })
      );
      return;
    }

    // Handle function invocation
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf-8");
    const payload = JSON.parse(body) as {
      event: { name: string; data: unknown };
      functionId: string;
    };

    logger.info(
      { functionId: payload.functionId, event: payload.event.name },
      "Inngest function invoked"
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Inngest handler error");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

export function startInngestHandler(): void {
  server.listen(port, () => {
    logger.info(
      {
        port,
        path: "/api/inngest",
        functionCount: functions.length,
      },
      "Inngest handler running"
    );
  });
}

export function stopInngestHandler(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        logger.info("Inngest handler stopped");
        resolve();
      }
    });
  });
}
