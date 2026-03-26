/**
 * Periodic Screenshot Capture — DEV-002 Devin Parity Feature
 *
 * Captures browser screenshots from sandboxes at regular intervals
 * during task execution and publishes them as session events via Redis.
 * This gives users real-time visual progress feedback.
 */

import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { sandboxManagerClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:periodic-screenshot");

/** Default capture interval in milliseconds (30 seconds) */
const DEFAULT_INTERVAL_MS = 30_000;

/** Maximum screenshot dimensions */
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;

interface SandboxStatus {
  hasBrowser: boolean;
  hasDevServer: boolean;
}

export class PeriodicScreenshotCapture {
  private readonly eventPublisher: EventPublisher;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private activeSandboxId: string | null = null;
  private activeSessionId: string | null = null;
  private stopped = false;

  constructor(eventPublisher?: EventPublisher) {
    this.eventPublisher = eventPublisher ?? new EventPublisher();
  }

  /**
   * Start periodic screenshot capture for a sandbox.
   * Screenshots are published as BROWSER_SCREENSHOT session events.
   */
  start(
    sandboxId: string,
    sessionId: string,
    intervalMs: number = DEFAULT_INTERVAL_MS
  ): void {
    // Stop any existing capture
    this.stop();

    this.activeSandboxId = sandboxId;
    this.activeSessionId = sessionId;
    this.stopped = false;

    logger.info(
      { sandboxId, sessionId, intervalMs },
      "Starting periodic screenshot capture"
    );

    // Capture immediately, then on interval
    this.captureAndPublish(sandboxId, sessionId).catch(() => {
      // Swallow initial capture errors — sandbox may not be ready yet
    });

    this.intervalHandle = setInterval(() => {
      if (this.stopped) {
        return;
      }
      this.captureAndPublish(sandboxId, sessionId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug({ sandboxId, error: msg }, "Periodic capture skipped");
      });
    }, intervalMs);
  }

  /**
   * Stop periodic screenshot capture and clean up the interval.
   */
  stop(): void {
    this.stopped = true;

    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    if (this.activeSandboxId) {
      logger.info(
        { sandboxId: this.activeSandboxId, sessionId: this.activeSessionId },
        "Stopped periodic screenshot capture"
      );
    }

    this.activeSandboxId = null;
    this.activeSessionId = null;
  }

  /**
   * Capture a single screenshot from the sandbox.
   * Returns the screenshot as a base64-encoded PNG string.
   */
  async captureOnce(sandboxId: string): Promise<string> {
    const status = await this.checkSandboxStatus(sandboxId);

    if (!(status.hasDevServer || status.hasBrowser)) {
      throw new Error(
        "Sandbox has no running dev server or browser — skipping capture"
      );
    }

    const response = await sandboxManagerClient.post<{
      screenshots: Array<{ url: string; base64: string }>;
    }>("/screenshots", {
      sandboxId,
      urls: ["http://localhost:3000"],
      width: MAX_WIDTH,
      height: MAX_HEIGHT,
    });

    const screenshot = response.data.screenshots[0];
    if (!screenshot) {
      throw new Error("No screenshot returned from sandbox manager");
    }

    return screenshot.base64;
  }

  /**
   * Capture a screenshot and publish it as a session event.
   */
  private async captureAndPublish(
    sandboxId: string,
    sessionId: string
  ): Promise<void> {
    const status = await this.checkSandboxStatus(sandboxId);

    // Only capture when there is an active dev server or browser
    if (!(status.hasDevServer || status.hasBrowser)) {
      logger.debug(
        { sandboxId },
        "No dev server or browser active, skipping capture"
      );
      return;
    }

    const base64 = await this.captureOnce(sandboxId);

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.BROWSER_SCREENSHOT,
      data: {
        sandboxId,
        base64,
        width: MAX_WIDTH,
        height: MAX_HEIGHT,
        capturedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });

    logger.debug({ sandboxId, sessionId }, "Screenshot captured and published");
  }

  /**
   * Check whether the sandbox has a running dev server or open browser.
   */
  private async checkSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    try {
      const response = await sandboxManagerClient.get<{
        hasDevServer?: boolean;
        hasBrowser?: boolean;
        status?: string;
      }>(`/sandboxes/${sandboxId}/status`);

      return {
        hasDevServer: response.data.hasDevServer ?? false,
        hasBrowser:
          response.data.hasBrowser ?? response.data.status === "running",
      };
    } catch {
      // If status check fails, assume the sandbox is active so we
      // at least attempt a capture (it will fail gracefully)
      return { hasDevServer: true, hasBrowser: false };
    }
  }
}
