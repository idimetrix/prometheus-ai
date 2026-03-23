import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import { PlaywrightRunner } from "../playwright-runner";

const logger = createLogger("sandbox:screenshot-route");

const runner = new PlaywrightRunner();

// Initialize on first use
let initialized = false;

export const screenshotRoute = new Hono();

screenshotRoute.post("/screenshots", async (c) => {
  if (!initialized) {
    await runner.initialize();
    initialized = true;
  }

  const body = await c.req.json<{
    urls: string[];
    width?: number;
    height?: number;
    fullPage?: boolean;
  }>();

  if (!body.urls || body.urls.length === 0) {
    return c.json({ error: "urls array is required" }, 400);
  }

  // Cap at 5 screenshots per request
  const urls = body.urls.slice(0, 5);

  logger.info({ urlCount: urls.length }, "Taking screenshots");

  const screenshots = await runner.takeMultipleScreenshots(urls, {
    width: body.width,
    height: body.height,
    fullPage: body.fullPage,
  });

  return c.json({
    screenshots,
    requested: urls.length,
    captured: screenshots.length,
  });
});
