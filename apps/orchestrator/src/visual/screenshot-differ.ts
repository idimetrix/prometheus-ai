/**
 * Screenshot Differ — Pixel-level diff using image comparison.
 *
 * Compares before/after screenshots to detect visual regressions.
 * Uses simple pixel-level comparison with configurable threshold.
 */

import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:screenshot-differ");

export interface DiffResult {
  baselineUrl: string;
  currentUrl: string;
  diffPercentage: number;
  diffPixels: number;
  height: number;
  passed: boolean;
  totalPixels: number;
  width: number;
}

export interface DiffConfig {
  /** Ignore anti-aliased pixels (default true) */
  ignoreAntialiasing: boolean;
  /** Maximum percentage of different pixels allowed (default 0.1 = 0.1%) */
  threshold: number;
}

const DEFAULT_CONFIG: DiffConfig = {
  threshold: 0.1,
  ignoreAntialiasing: true,
};

export class ScreenshotDiffer {
  private readonly config: DiffConfig;

  constructor(config?: Partial<DiffConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compare two screenshot URLs and return the diff result.
   * This uses the sandbox-manager's screenshot endpoint.
   */
  async compare(baselineUrl: string, currentUrl: string): Promise<DiffResult> {
    const sandboxUrl =
      process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

    try {
      const response = await fetch(`${sandboxUrl}/screenshots/diff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          baseline: baselineUrl,
          current: currentUrl,
          threshold: this.config.threshold,
          ignoreAntialiasing: this.config.ignoreAntialiasing,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`Screenshot diff failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        diffPixels: number;
        totalPixels: number;
        width: number;
        height: number;
      };

      const diffPercentage =
        data.totalPixels > 0 ? (data.diffPixels / data.totalPixels) * 100 : 0;

      const passed = diffPercentage <= this.config.threshold;

      logger.info(
        {
          diffPercentage: diffPercentage.toFixed(3),
          diffPixels: data.diffPixels,
          passed,
        },
        "Screenshot diff completed"
      );

      return {
        baselineUrl,
        currentUrl,
        diffPixels: data.diffPixels,
        totalPixels: data.totalPixels,
        diffPercentage,
        passed,
        width: data.width,
        height: data.height,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Screenshot diff failed");

      return {
        baselineUrl,
        currentUrl,
        diffPixels: -1,
        totalPixels: 0,
        diffPercentage: 100,
        passed: false,
        width: 0,
        height: 0,
      };
    }
  }
}
