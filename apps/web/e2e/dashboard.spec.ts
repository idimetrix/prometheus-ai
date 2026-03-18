import { test, expect } from "@playwright/test";

// These tests require authentication - skipped in CI without auth setup
test.describe("Dashboard", () => {
  test.skip(!!process.env.CI, "Requires authentication setup");

  test("should display dashboard widgets", async ({ page }) => {
    // TODO: Set up authenticated session
    await page.goto("/dashboard");
    await expect(page.getByText("Dashboard")).toBeVisible();
    await expect(page.getByText("Active Agents")).toBeVisible();
    await expect(page.getByText("Credits")).toBeVisible();
    await expect(page.getByText("Projects")).toBeVisible();
  });

  test("should navigate to projects page", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await expect(page.getByText("Projects")).toBeVisible();
    await expect(page.getByText("New Project")).toBeVisible();
  });

  test("should navigate to fleet page", async ({ page }) => {
    await page.goto("/dashboard/fleet");
    await expect(page.getByText("Fleet Manager")).toBeVisible();
  });

  test("should navigate to analytics page", async ({ page }) => {
    await page.goto("/dashboard/analytics");
    await expect(page.getByText("Analytics")).toBeVisible();
  });

  test("should navigate to settings page", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByText("Settings")).toBeVisible();
  });
});
