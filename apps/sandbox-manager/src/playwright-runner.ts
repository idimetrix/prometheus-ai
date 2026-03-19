import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("sandbox:playwright");

/** Maximum browsers in the pool */
const MAX_BROWSER_POOL_SIZE = 5;

/** Browser idle timeout before eviction (ms) */
const BROWSER_IDLE_TTL_MS = 5 * 60 * 1000;

export interface ScreenshotOptions {
  fullPage?: boolean;
  height?: number;
  timeout?: number;
  url: string;
  width?: number;
}

export interface ScreenshotResult {
  base64: string;
  height: number;
  url: string;
  width: number;
}

export interface VisionSlotResult {
  analysis: string;
  screenshot: string;
}

export interface NetworkEntry {
  duration: number;
  method: string;
  resourceType: string;
  status: number;
  url: string;
}

export interface NetworkRecording {
  entries: NetworkEntry[];
  sandboxId: string;
  totalRequests: number;
  totalTransferSize: number;
  url: string;
}

/** Internal type for a pooled browser instance */
interface PooledBrowser {
  browser: unknown;
  createdAt: Date;
  id: string;
  inUse: boolean;
  lastUsedAt: Date;
}

/** Playwright page type (dynamically loaded) */
interface PlaywrightPage {
  close: () => Promise<void>;
  goto: (
    url: string,
    opts: { timeout: number; waitUntil: string }
  ) => Promise<void>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  screenshot: (opts: { fullPage: boolean }) => Promise<Buffer>;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
}

/** Playwright browser type (dynamically loaded) */
interface PlaywrightBrowser {
  close: () => Promise<void>;
  newPage: () => Promise<PlaywrightPage>;
}

/** Playwright module type */
interface PlaywrightModule {
  chromium: {
    launch: (opts: Record<string, unknown>) => Promise<PlaywrightBrowser>;
  };
}

/**
 * PlaywrightRunner manages browser lifecycle for taking screenshots,
 * vision slot analysis, and network recording in sandboxed environments.
 *
 * Features:
 * - Browser pool management for headless Chromium instances
 * - Screenshot-to-vision slot pipeline for AI analysis
 * - Network activity recording during navigation
 */
export class PlaywrightRunner {
  private readonly browserPool: PooledBrowser[] = [];
  private pw: PlaywrightModule | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  async initialize(): Promise<void> {
    try {
      // Dynamic import -- playwright is optional and may not be installed
      this.pw = (await import("playwright" as string)) as PlaywrightModule;

      // Pre-warm one browser instance
      await this.acquireBrowser();

      // Start cleanup interval for idle browsers
      this.cleanupInterval = setInterval(() => {
        this.cleanupIdleBrowsers().catch(() => {
          /* best-effort */
        });
      }, 60_000);

      logger.info("Playwright browser pool initialized");
    } catch (err) {
      logger.warn(
        { err },
        "Playwright not available -- screenshots will be skipped"
      );
    }
  }

  async takeScreenshot(
    options: ScreenshotOptions
  ): Promise<ScreenshotResult | null> {
    const pooled = await this.acquireBrowser();
    if (!pooled) {
      return null;
    }

    const width = options.width ?? 1280;
    const height = options.height ?? 720;
    const timeout = options.timeout ?? 30_000;

    try {
      const browser = pooled.browser as PlaywrightBrowser;
      const page = await browser.newPage();
      await page.setViewportSize({ width, height });

      await page.goto(options.url, {
        timeout,
        waitUntil: "networkidle",
      });

      const buffer = await page.screenshot({
        fullPage: options.fullPage ?? false,
      });

      await page.close();
      this.releaseBrowser(pooled.id);

      return {
        url: options.url,
        base64: buffer.toString("base64"),
        width,
        height,
      };
    } catch (err) {
      this.releaseBrowser(pooled.id);
      logger.warn({ url: options.url, err }, "Screenshot failed");
      return null;
    }
  }

  async takeMultipleScreenshots(
    urls: string[],
    options?: Omit<ScreenshotOptions, "url">
  ): Promise<ScreenshotResult[]> {
    const results: ScreenshotResult[] = [];

    for (const url of urls) {
      const result = await this.takeScreenshot({ ...options, url });
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Screenshot-to-vision slot pipeline.
   *
   * Takes a screenshot of the given URL, converts it to base64,
   * and provides a structured result ready for vision model analysis.
   * The analysis field contains a placeholder prompt; in production,
   * this would be fed to a vision-capable model for UI analysis.
   */
  async screenshotToVisionSlot(url: string): Promise<VisionSlotResult> {
    logger.info({ url }, "Starting screenshot-to-vision pipeline");

    const screenshot = await this.takeScreenshot({
      url,
      width: 1280,
      height: 720,
      fullPage: true,
      timeout: 30_000,
    });

    if (!screenshot) {
      throw new Error(
        `Failed to take screenshot of ${url} -- browser may not be available`
      );
    }

    // Build the vision analysis prompt with the screenshot data
    const analysis = [
      "## Vision Analysis Request",
      "",
      `**URL:** ${url}`,
      `**Resolution:** ${screenshot.width}x${screenshot.height}`,
      `**Capture Time:** ${new Date().toISOString()}`,
      "",
      "### Instructions",
      "Analyze this screenshot for:",
      "1. UI layout and component structure",
      "2. Visual errors or broken layouts",
      "3. Accessibility concerns (contrast, text size)",
      "4. Content accuracy and completeness",
      "",
      `Screenshot data: ${screenshot.base64.length} bytes (base64)`,
    ].join("\n");

    logger.info(
      { url, screenshotBytes: screenshot.base64.length },
      "Vision slot prepared"
    );

    return {
      screenshot: screenshot.base64,
      analysis,
    };
  }

  /**
   * Record network activity during page navigation.
   *
   * Opens a page, attaches network listeners, navigates to the URL,
   * and returns all captured network requests with their metadata.
   */
  async recordNetwork(
    sandboxId: string,
    url: string
  ): Promise<NetworkRecording> {
    const pooled = await this.acquireBrowser();
    if (!pooled) {
      throw new Error("Browser not available for network recording");
    }

    logger.info({ sandboxId, url }, "Starting network recording");

    const entries: NetworkEntry[] = [];
    let totalTransferSize = 0;

    try {
      const browser = pooled.browser as PlaywrightBrowser;
      const page = await browser.newPage();

      // Attach network request listener
      page.on("response", (...args: unknown[]) => {
        const response = args[0] as {
          headerValue?: (name: string) => Promise<string | null>;
          request?: () => {
            method?: () => string;
            resourceType?: () => string;
            timing?: () => { responseEnd?: number; startTime?: number };
            url?: () => string;
          };
          status?: () => number;
          url?: () => string;
        };

        try {
          const request = response.request?.();
          const status =
            typeof response.status === "function" ? response.status() : 0;
          const reqUrl =
            typeof response.url === "function" ? response.url() : "";
          const method =
            typeof request?.method === "function" ? request.method() : "GET";
          const resourceType =
            typeof request?.resourceType === "function"
              ? request.resourceType()
              : "other";

          const timing =
            typeof request?.timing === "function" ? request.timing() : null;
          const duration = timing
            ? (timing.responseEnd ?? 0) - (timing.startTime ?? 0)
            : 0;

          entries.push({
            url: reqUrl,
            method,
            status,
            resourceType,
            duration: Math.max(0, duration),
          });
        } catch {
          // Response may have been disposed
        }
      });

      // Navigate and wait for network idle
      await page.goto(url, {
        timeout: 30_000,
        waitUntil: "networkidle",
      });

      await page.close();
      this.releaseBrowser(pooled.id);

      // Calculate total transfer size estimate from entry count
      totalTransferSize = entries.length * 1024; // Rough estimate

      const recording: NetworkRecording = {
        url,
        sandboxId,
        entries,
        totalRequests: entries.length,
        totalTransferSize,
      };

      logger.info(
        {
          sandboxId,
          url,
          totalRequests: entries.length,
        },
        "Network recording completed"
      );

      return recording;
    } catch (err) {
      this.releaseBrowser(pooled.id);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ sandboxId, url, error: msg }, "Network recording failed");
      throw new Error(`Network recording failed for ${url}: ${msg}`);
    }
  }

  /** Get the current browser pool size */
  getPoolSize(): number {
    return this.browserPool.length;
  }

  /** Get the number of browsers currently in use */
  getActiveBrowserCount(): number {
    return this.browserPool.filter((b) => b.inUse).length;
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const pooled of this.browserPool) {
      try {
        const browser = pooled.browser as PlaywrightBrowser;
        await browser.close();
      } catch {
        // Best-effort cleanup
      }
    }

    this.browserPool.length = 0;
    logger.info("Playwright browser pool closed");
  }

  // ─── Browser pool management ────────────────────────────────────────

  /**
   * Acquire a browser from the pool, or create a new one if under capacity.
   */
  private async acquireBrowser(): Promise<PooledBrowser | null> {
    if (!this.pw) {
      return null;
    }

    // Try to find an idle browser in the pool
    for (const pooled of this.browserPool) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.lastUsedAt = new Date();
        return pooled;
      }
    }

    // Create a new browser if under capacity
    if (this.browserPool.length < MAX_BROWSER_POOL_SIZE) {
      try {
        const browser = await this.pw.chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        });

        const pooled: PooledBrowser = {
          id: generateId("browser"),
          browser,
          inUse: true,
          createdAt: new Date(),
          lastUsedAt: new Date(),
        };

        this.browserPool.push(pooled);
        logger.debug(
          { browserId: pooled.id, poolSize: this.browserPool.length },
          "New browser added to pool"
        );

        return pooled;
      } catch (err) {
        logger.warn({ err }, "Failed to launch browser");
        return null;
      }
    }

    // Pool is full and all browsers are in use
    logger.warn(
      { poolSize: this.browserPool.length },
      "Browser pool exhausted, all browsers in use"
    );
    return null;
  }

  /**
   * Release a browser back to the pool.
   */
  private releaseBrowser(browserId: string): void {
    const pooled = this.browserPool.find((b) => b.id === browserId);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsedAt = new Date();
    }
  }

  /**
   * Clean up browsers that have been idle for too long.
   */
  private async cleanupIdleBrowsers(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < this.browserPool.length; i++) {
      const pooled = this.browserPool[i];
      if (!pooled) {
        continue;
      }

      if (
        !pooled.inUse &&
        now - pooled.lastUsedAt.getTime() > BROWSER_IDLE_TTL_MS &&
        this.browserPool.length > 1 // Keep at least one browser warm
      ) {
        toRemove.push(i);
        try {
          const browser = pooled.browser as PlaywrightBrowser;
          await browser.close();
        } catch {
          // Best-effort cleanup
        }
      }
    }

    // Remove in reverse order to preserve indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      if (idx !== undefined) {
        this.browserPool.splice(idx, 1);
      }
    }

    if (toRemove.length > 0) {
      logger.debug(
        { removed: toRemove.length, remaining: this.browserPool.length },
        "Cleaned up idle browsers"
      );
    }
  }
}
