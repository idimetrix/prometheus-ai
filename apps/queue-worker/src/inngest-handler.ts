import { createServer } from "node:http";
import { createLogger } from "@prometheus/logger";
import {
  agentExecutionWorkflow,
  fleetCoordinationWorkflow,
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
          functions: functions.map((f) => ({
            id: f.config.id,
            name: f.config.name,
            trigger: f.trigger,
          })),
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

    const fn = functions.find((f) => f.config.id === payload.functionId);
    if (!fn) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: `Function not found: ${payload.functionId}` })
      );
      return;
    }

    logger.info(
      { functionId: fn.config.id, event: payload.event.name },
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
        functions: functions.map((f) => f.config.id),
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
