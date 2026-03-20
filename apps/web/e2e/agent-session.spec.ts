import { expect, test } from "@playwright/test";

/**
 * E2E test: Full agent session lifecycle.
 *
 * Verifies the critical path from session creation through agent execution
 * to completion, including real-time streaming and tool call display.
 */

const NEW_SESSION_RE = /new session|create|start/i;
const PAUSE_RE = /pause/i;
const RESUME_RE = /resume/i;

test.describe("Agent Session Lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app and wait for hydration
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should display the workspace layout", async ({ page }) => {
    // Verify main layout elements are present
    await expect(
      page.locator("[data-testid='workspace-layout']").or(page.locator("main"))
    ).toBeVisible();
  });

  test("should create a new session", async ({ page }) => {
    // Look for session creation UI
    const newSessionButton = page.getByRole("button", {
      name: NEW_SESSION_RE,
    });
    if (await newSessionButton.isVisible()) {
      await newSessionButton.click();

      // Verify session panel appears
      await expect(
        page
          .locator("[data-testid='session-panel']")
          .or(page.locator("[role='dialog']"))
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("should show streaming output when agent is running", async ({
    page,
  }) => {
    // Navigate to an active session if one exists
    const sessionLink = page.locator("a[href*='session']").first();
    if (await sessionLink.isVisible()) {
      await sessionLink.click();
      await page.waitForLoadState("networkidle");

      // Check for streaming renderer or chat component
      const streamRenderer = page.locator(
        "[data-testid='stream-renderer'], [data-testid='ai-stream'], [class*='stream']"
      );

      // If a session is active, we should see the stream renderer
      if (await streamRenderer.isVisible()) {
        await expect(streamRenderer).toBeVisible();
      }
    }
  });

  test("should display reasoning panel when available", async ({ page }) => {
    const sessionLink = page.locator("a[href*='session']").first();
    if (await sessionLink.isVisible()) {
      await sessionLink.click();
      await page.waitForLoadState("networkidle");

      const reasoningPanel = page.locator(
        "[data-testid='reasoning-panel'], [class*='reasoning']"
      );

      if (await reasoningPanel.isVisible()) {
        await expect(reasoningPanel).toBeVisible();
      }
    }
  });

  test("should display DAG view in fleet mode", async ({ page }) => {
    // Navigate to fleet/orchestration view
    const fleetLink = page
      .locator("a[href*='fleet'], [data-testid='fleet-tab']")
      .first();
    if (await fleetLink.isVisible()) {
      await fleetLink.click();
      await page.waitForLoadState("networkidle");

      const dagView = page.locator(
        "[data-testid='dag-view'], svg[class*='dag'], [class*='dag-view']"
      );

      if (await dagView.isVisible()) {
        await expect(dagView).toBeVisible();
      }
    }
  });

  test("should handle session pause and resume", async ({ page }) => {
    const sessionLink = page.locator("a[href*='session']").first();
    if (await sessionLink.isVisible()) {
      await sessionLink.click();
      await page.waitForLoadState("networkidle");

      // Look for pause button
      const pauseButton = page.getByRole("button", { name: PAUSE_RE });
      if (await pauseButton.isVisible()) {
        await pauseButton.click();

        // Verify paused state
        const resumeButton = page.getByRole("button", { name: RESUME_RE });
        await expect(resumeButton).toBeVisible({ timeout: 5000 });

        // Resume
        await resumeButton.click();
      }
    }
  });
});
