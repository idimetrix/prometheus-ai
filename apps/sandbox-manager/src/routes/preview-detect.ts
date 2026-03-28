import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import type { ContainerManager } from "../container";

const logger = createLogger("sandbox:preview-detect");

/** Common dev server ports to scan */
const KNOWN_PORTS = [3000, 3001, 4000, 5173, 5174, 8080, 8000, 8888, 4200];

/** Framework hints based on response content */
const FRAMEWORK_HINTS: Array<{ framework: string; pattern: RegExp }> = [
  { pattern: /__next/i, framework: "next" },
  { pattern: /vite/i, framework: "vite" },
  { pattern: /react/i, framework: "react" },
  { pattern: /angular/i, framework: "angular" },
  { pattern: /svelte/i, framework: "svelte" },
  { pattern: /vue/i, framework: "vue" },
  { pattern: /express/i, framework: "express" },
];

const TITLE_RE = /<title[^>]*>(.*?)<\/title>/i;

interface DetectedServer {
  framework: string | null;
  port: number;
  title: string | null;
}

/**
 * Attempt to connect to a port inside the sandbox.
 * Returns server info if successful, null if port is not open.
 */
async function probePort(port: number): Promise<DetectedServer | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`http://localhost:${port}/`, {
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });

    clearTimeout(timeout);

    if (!response.ok && response.status >= 500) {
      return null;
    }

    const body = await response.text();
    let framework: string | null = null;
    let title: string | null = null;

    // Detect framework from response content
    for (const hint of FRAMEWORK_HINTS) {
      if (hint.pattern.test(body)) {
        framework = hint.framework;
        break;
      }
    }

    // Extract title
    const titleMatch = body.match(TITLE_RE);
    if (titleMatch) {
      title = titleMatch[1] ?? null;
    }

    return { port, framework, title };
  } catch {
    return null;
  }
}

/**
 * Creates the preview detection route.
 *
 * Scans known ports in a sandbox to find running dev servers.
 * Returns a list of detected servers with their framework type.
 */
export function createPreviewDetectRoute(_containerManager: ContainerManager) {
  const route = new Hono();

  route.get("/preview-detect/:sandboxId", async (c) => {
    const sandboxId = c.req.param("sandboxId");

    logger.info({ sandboxId }, "Scanning for dev servers");

    const results = await Promise.all(KNOWN_PORTS.map(probePort));
    const servers = results.filter((r): r is DetectedServer => r !== null);

    logger.info(
      { sandboxId, serversFound: servers.length },
      "Dev server scan complete"
    );

    return c.json({
      sandboxId,
      servers,
      scannedPorts: KNOWN_PORTS,
    });
  });

  return route;
}
