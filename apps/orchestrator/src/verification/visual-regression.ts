import { createLogger } from "@prometheus/logger";

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

// ---------------------------------------------------------------------------
// VisualRegressionTester
// ---------------------------------------------------------------------------

/**
 * Captures screenshots and compares them to detect visual regressions.
 * Communicates with a sandbox browser instance for rendering.
 */
export class VisualRegressionTester {
  private readonly threshold: number;

  constructor(threshold = 0.98) {
    this.threshold = threshold;
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
   */
  compareScreenshots(
    baseline: ScreenshotCapture,
    current: ScreenshotCapture
  ): VisualComparison {
    logger.info(`Comparing screenshots: ${baseline.url} vs ${current.url}`);

    const diffScore = this.getVisualDiffScore(baseline.base64, current.base64);
    const changedRegions = this.detectChangedRegions(
      baseline.base64,
      current.base64
    );

    return {
      baseline,
      current,
      diffScore,
      changedRegions,
    };
  }

  /**
   * Calculate a similarity score between two base64-encoded images.
   * Returns a value between 0 (completely different) and 1 (identical).
   */
  getVisualDiffScore(baseline: string, current: string): number {
    if (baseline === current) {
      return 1.0;
    }

    // Simple byte-level comparison for similarity estimation.
    // Production would use pixel-level diffing (e.g., pixelmatch).
    const baselineBytes = Buffer.from(baseline, "base64");
    const currentBytes = Buffer.from(current, "base64");

    const minLength = Math.min(baselineBytes.length, currentBytes.length);
    const maxLength = Math.max(baselineBytes.length, currentBytes.length);

    if (maxLength === 0) {
      return 1.0;
    }

    let matchingBytes = 0;
    for (let i = 0; i < minLength; i++) {
      if (baselineBytes[i] === currentBytes[i]) {
        matchingBytes++;
      }
    }

    return matchingBytes / maxLength;
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

  // ---- Private helpers ----

  private detectChangedRegions(
    baseline: string,
    current: string
  ): ChangedRegion[] {
    // Simple pixel comparison: compare base64 encoded images by chunks
    // to identify approximate changed regions. For production, integrate
    // a proper pixel-diff library like pixelmatch.
    if (baseline === current) {
      return [];
    }

    // If images differ, report the full viewport as changed
    // (fine-grained region detection requires pixelmatch/sharp integration)
    return [{ x: 0, y: 0, width: 1920, height: 1080 }];
  }

  private async renderInSandbox(request: {
    format: "png";
    fullPage: boolean;
    url: string;
    viewport: Viewport;
  }): Promise<string> {
    const sandboxManagerUrl =
      process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

    try {
      const res = await fetch(`${sandboxManagerUrl}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
