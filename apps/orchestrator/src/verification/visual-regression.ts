import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { ScreenshotComparator } from "./screenshot-comparator";

const logger = createLogger("orchestrator:visual-regression");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Viewport {
  height: number;
  width: number;
}

export interface ScreenshotCapture {
  base64: string;
  timestamp: string;
  url: string;
  viewport: Viewport;
}

export interface VisualComparison {
  baseline: ScreenshotCapture;
  changedRegions: ChangedRegion[];
  current: ScreenshotCapture;
  diffScore: number;
}

export interface ChangedRegion {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface VisualReport {
  comparisons: VisualReportEntry[];
  generatedAt: string;
  overallPassRate: number;
  totalComparisons: number;
}

export interface VisualReportEntry {
  diffScore: number;
  passed: boolean;
  url: string;
  viewport: Viewport;
}

/** Key used to store/retrieve baselines in the storage backend. */
export interface BaselineKey {
  projectId: string;
  url: string;
  viewport: Viewport;
}

// ---------------------------------------------------------------------------
// VisualRegressionTester
// ---------------------------------------------------------------------------

/**
 * Captures screenshots and compares them to detect visual regressions.
 * Communicates with a sandbox browser instance for rendering and
 * stores baselines in MinIO/S3 via the sandbox-manager storage API.
 *
 * Uses {@link ScreenshotComparator} for grid-based pixel-diff region
 * detection instead of naive full-viewport reports.
 */
export class VisualRegressionTester {
  private readonly threshold: number;
  private readonly comparator: ScreenshotComparator;
  private readonly sandboxManagerUrl: string;

  constructor(threshold = 0.98) {
    this.threshold = threshold;
    this.comparator = new ScreenshotComparator();
    this.sandboxManagerUrl =
      process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";
  }

  /**
   * Capture a screenshot of the given URL at the specified viewport.
   * Delegates rendering to the sandbox browser service.
   */
  async captureScreenshot(
    url: string,
    viewport: Viewport
  ): Promise<ScreenshotCapture> {
    logger.info(`Capturing screenshot: ${url}`);

    const base64 = await this.renderInSandbox({
      url,
      viewport,
      format: "png" as const,
      fullPage: true,
    });

    return {
      base64,
      timestamp: new Date().toISOString(),
      url,
      viewport,
    };
  }

  /**
   * Compare two screenshots and return a visual comparison result.
   * Delegates pixel-level comparison to {@link ScreenshotComparator}
   * for grid-based changed region detection.
   */
  compareScreenshots(
    baseline: ScreenshotCapture,
    current: ScreenshotCapture
  ): VisualComparison {
    logger.info(`Comparing screenshots: ${baseline.url} vs ${current.url}`);

    const compResult = this.comparator.compare(baseline.base64, current.base64);

    return {
      baseline,
      current,
      diffScore: compResult.diffScore,
      changedRegions: compResult.changedRegions,
    };
  }

  /**
   * Calculate a similarity score between two base64-encoded images.
   * Returns a value between 0 (completely different) and 1 (identical).
   */
  getVisualDiffScore(baseline: string, current: string): number {
    return this.comparator.compare(baseline, current).diffScore;
  }

  /**
   * Generate a visual regression report from a set of comparisons.
   */
  generateVisualReport(comparisons: VisualComparison[]): VisualReport {
    const entries: VisualReportEntry[] = comparisons.map((c) => ({
      url: c.current.url,
      viewport: c.current.viewport,
      diffScore: c.diffScore,
      passed: c.diffScore >= this.threshold,
    }));

    const passedCount = entries.filter((e) => e.passed).length;

    const report: VisualReport = {
      totalComparisons: comparisons.length,
      overallPassRate:
        comparisons.length > 0 ? passedCount / comparisons.length : 1.0,
      comparisons: entries,
      generatedAt: new Date().toISOString(),
    };

    logger.info(
      `Visual regression report generated: ${report.totalComparisons} comparisons, pass rate ${report.overallPassRate}`
    );

    return report;
  }

  // ---- Baseline storage via MinIO/S3 through sandbox-manager ----

  /**
   * Run a full visual regression test for a set of URLs.
   *
   * 1. Capture current screenshots for each URL + viewport combination.
   * 2. Load baseline screenshots from MinIO/S3 (via sandbox-manager).
   * 3. Compare current vs baseline using pixel-diff.
   * 4. Optionally update baselines when no baseline exists yet.
   * 5. Return a {@link VisualReport} summarising all comparisons.
   */
  async runRegressionTest(
    projectId: string,
    urls: string[],
    viewport: Viewport = { width: 1280, height: 720 }
  ): Promise<VisualReport> {
    const comparisons: VisualComparison[] = [];

    for (const url of urls) {
      const current = await this.captureScreenshot(url, viewport);

      if (current.base64.length === 0) {
        logger.warn(
          { url },
          "Skipping URL — screenshot capture returned empty"
        );
        continue;
      }

      const baselineKey: BaselineKey = { projectId, url, viewport };
      const baselineBase64 = await this.loadBaseline(baselineKey);

      if (baselineBase64.length === 0) {
        // No baseline yet — store current as the baseline and skip comparison
        await this.storeBaseline(baselineKey, current.base64);
        logger.info({ url }, "Stored new baseline (no prior baseline found)");
        continue;
      }

      const baseline: ScreenshotCapture = {
        base64: baselineBase64,
        timestamp: "",
        url,
        viewport,
      };

      comparisons.push(this.compareScreenshots(baseline, current));
    }

    return this.generateVisualReport(comparisons);
  }

  /**
   * Store a baseline screenshot in MinIO/S3 via sandbox-manager.
   */
  async storeBaseline(key: BaselineKey, base64: string): Promise<void> {
    try {
      const res = await fetch(`${this.sandboxManagerUrl}/baselines`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          key: this.baselineKeyToString(key),
          data: base64,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        logger.warn(
          { key: this.baselineKeyToString(key), status: res.status },
          "Failed to store baseline"
        );
      }
    } catch (err) {
      logger.warn({ err }, "Baseline storage request failed");
    }
  }

  /**
   * Load a baseline screenshot from MinIO/S3 via sandbox-manager.
   * Returns an empty string if no baseline exists.
   */
  async loadBaseline(key: BaselineKey): Promise<string> {
    try {
      const encoded = encodeURIComponent(this.baselineKeyToString(key));
      const res = await fetch(
        `${this.sandboxManagerUrl}/baselines/${encoded}`,
        {
          method: "GET",
          headers: getInternalAuthHeaders(),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (res.ok) {
        const data = (await res.json()) as { data?: string };
        return data.data ?? "";
      }
    } catch (err) {
      logger.warn({ err }, "Baseline load request failed");
    }
    return "";
  }

  /**
   * Update the baseline for a specific key with a new screenshot.
   * Useful after a visual change has been manually approved.
   */
  async updateBaseline(key: BaselineKey, base64: string): Promise<void> {
    await this.storeBaseline(key, base64);
    logger.info({ key: this.baselineKeyToString(key) }, "Baseline updated");
  }

  // ---- Private helpers ----

  private baselineKeyToString(key: BaselineKey): string {
    return `${key.projectId}/${encodeURIComponent(key.url)}/${key.viewport.width}x${key.viewport.height}`;
  }

  private async renderInSandbox(request: {
    format: "png";
    fullPage: boolean;
    url: string;
    viewport: Viewport;
  }): Promise<string> {
    try {
      const res = await fetch(`${this.sandboxManagerUrl}/screenshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          url: request.url,
          viewport: request.viewport,
          fullPage: request.fullPage,
          format: request.format,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const result = (await res.json()) as { screenshot?: string };
        return result.screenshot ?? "";
      }

      logger.warn(
        { url: request.url, status: res.status },
        "Screenshot capture returned non-OK status"
      );
    } catch (err) {
      logger.warn(
        { url: request.url, error: err },
        "Failed to capture screenshot via sandbox-manager"
      );
    }
    return "";
  }
}
