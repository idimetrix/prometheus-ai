import { createLogger } from "@prometheus/logger";

const logger = createLogger("debug-endpoints");

/**
 * Register debug endpoints on the given HTTP app.
 * Only available in development mode (NODE_ENV === "development").
 *
 * - GET /debug/heapdump — triggers v8.writeHeapSnapshot() and returns the file path
 * - GET /debug/gc-stats — returns V8 heap statistics via process.memoryUsage()
 */
export function registerDebugEndpoints(app: {
  get: (
    path: string,
    handler: (
      req: unknown,
      res: {
        writeHead: (status: number, headers: Record<string, string>) => void;
        end: (body: string) => void;
      }
    ) => void
  ) => void;
}): void {
  const isDev = process.env.NODE_ENV === "development";

  if (!isDev) {
    logger.info("Debug endpoints disabled (NODE_ENV is not 'development')");
    return;
  }

  app.get("/debug/heapdump", (_req, res) => {
    try {
      // Dynamic require to avoid loading v8 in production
      const v8 = require("node:v8") as {
        writeHeapSnapshot: () => string;
      };
      const filePath = v8.writeHeapSnapshot();
      logger.info({ filePath }, "Heap snapshot written");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filePath }));
    } catch (error) {
      logger.error({ error }, "Failed to write heap snapshot");
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  });

  app.get("/debug/gc-stats", (_req, res) => {
    try {
      const memoryUsage = process.memoryUsage();
      const stats = {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers,
        rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
        heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        externalMb: Math.round(memoryUsage.external / 1024 / 1024),
        uptime: process.uptime(),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats));
    } catch (error) {
      logger.error({ error }, "Failed to collect GC stats");
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  });

  logger.info("Debug endpoints registered: /debug/heapdump, /debug/gc-stats");
}
