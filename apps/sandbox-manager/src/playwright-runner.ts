import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox:playwright");

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

/**
 * PlaywrightRunner manages browser lifecycle for taking screenshots
 * of pages in sandboxed dev server environments.
 */
export class PlaywrightRunner {
  private browser: unknown = null;

  async initialize(): Promise<void> {
    try {
      // Dynamic import — playwright is optional and may not be installed
      const pw = (await import("playwright" as string)) as {
        chromium: {
          launch: (opts: Record<string, unknown>) => Promise<unknown>;
        };
      };
      this.browser = await pw.chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-gpu"],
      });
      logger.info("Playwright browser initialized");
    } catch (err) {
      logger.warn(
        { err },
        "Playwright not available — screenshots will be skipped"
      );
    }
  }

  async takeScreenshot(
    options: ScreenshotOptions
  ): Promise<ScreenshotResult | null> {
    if (!this.browser) {
      return null;
    }

    const width = options.width ?? 1280;
    const height = options.height ?? 720;
    const timeout = options.timeout ?? 30_000;

    try {
      const browser = this.browser as {
        newPage: () => Promise<{
          setViewportSize: (size: {
            width: number;
            height: number;
          }) => Promise<void>;
          goto: (
            url: string,
            opts: { timeout: number; waitUntil: string }
          ) => Promise<void>;
          screenshot: (opts: { fullPage: boolean }) => Promise<Buffer>;
          close: () => Promise<void>;
        }>;
      };

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

      return {
        url: options.url,
        base64: buffer.toString("base64"),
        width,
        height,
      };
    } catch (err) {
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

  async shutdown(): Promise<void> {
    if (this.browser) {
      const browser = this.browser as { close: () => Promise<void> };
      await browser.close();
      this.browser = null;
      logger.info("Playwright browser closed");
    }
  }
}
