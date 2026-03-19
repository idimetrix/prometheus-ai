import { expect, test } from "@playwright/test";

/**
 * Visual regression tests for key pages.
 *
 * These tests capture full-page screenshots and compare them against
 * baseline snapshots. On first run, baselines are created automatically.
 * Subsequent runs detect visual regressions beyond the allowed threshold.
 *
 * Run with: npx playwright test visual-regression.spec.ts
 * Update baselines: npx playwright test visual-regression.spec.ts --update-snapshots
 */

test.describe("Visual Regression", () => {
  test.skip(!!process.env.CI, "Requires baseline snapshots and auth setup");

  test("dashboard page matches snapshot", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("dashboard.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("projects page matches snapshot", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("projects.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("fleet manager page matches snapshot", async ({ page }) => {
    await page.goto("/dashboard/fleet");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("fleet-manager.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("analytics page matches snapshot", async ({ page }) => {
    await page.goto("/dashboard/analytics");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("analytics.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("settings page matches snapshot", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("settings.png", {
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });
});
