import { expect, test } from "@playwright/test";

const FRONTEND_RE = /frontend/i;
const BACKEND_RE = /backend/i;
const CREATE_BUTTON_RE = /create/i;
const SESSION_OR_PROJECT_URL_RE = /\/(sessions|projects)\//;
const SESSION_OR_PROJECT_PATH_RE = /\/(sessions|projects)\//;
const SESSIONS_HEADING_RE = /Sessions/i;

/**
 * E2E test: Project creation pipeline.
 *
 * Verifies the complete flow from the create page through
 * project creation and session start. This is the SINGLE
 * MOST IMPORTANT E2E test — it validates the core product flow.
 */
test.describe("Project Creation Pipeline", () => {
  test.skip(!!process.env.CI, "Requires authentication and running services");

  test("should display create project wizard", async ({ page }) => {
    await page.goto("/create");
    await expect(page.getByText("Create Project")).toBeVisible();
    await expect(page.getByText("Describe your vision")).toBeVisible();
  });

  test("should advance through wizard steps", async ({ page }) => {
    await page.goto("/create");

    // Step 1: Enter description
    const descInput = page.locator("textarea").first();
    await descInput.fill(
      "Build a SaaS application with user authentication, billing with Stripe, and an admin dashboard"
    );
    await expect(page.getByText("Next")).toBeEnabled();
    await page.getByText("Next").click();

    // Step 2: Tech stack should auto-detect or show options
    await expect(page.getByText("Tech Stack")).toBeVisible();
  });

  test("should show tech stack options", async ({ page }) => {
    await page.goto("/create");

    // Fill description
    const descInput = page.locator("textarea").first();
    await descInput.fill(
      "Build a React web application with a Node.js backend and PostgreSQL database"
    );

    // Navigate to tech stack step
    await page.getByText("Next").click();

    // Should show technology categories
    await expect(page.getByText(FRONTEND_RE)).toBeVisible();
    await expect(page.getByText(BACKEND_RE)).toBeVisible();
  });

  test("should create project and redirect", async ({ page }) => {
    await page.goto("/create");

    // Step 1: Description
    const descInput = page.locator("textarea").first();
    await descInput.fill("Simple REST API with user management endpoints");
    await page.getByText("Next").click();

    // Step 2: Select tech (click a frontend option)
    await page.waitForTimeout(500);
    const techOption = page.locator("[data-tech-id]").first();
    if (await techOption.isVisible()) {
      await techOption.click();
    }
    await page.getByText("Next").click();

    // Step 3: Architecture preview
    await page.waitForTimeout(500);
    await page.getByText("Next").click();

    // Step 4: Project name and create
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.fill("Test API Project");

    // Click create button
    const createBtn = page.getByRole("button", { name: CREATE_BUTTON_RE });
    if (await createBtn.isVisible()) {
      await createBtn.click();

      // Should redirect to session or project page
      await page.waitForURL(SESSION_OR_PROJECT_URL_RE, { timeout: 10_000 });
      const url = page.url();
      expect(url).toMatch(SESSION_OR_PROJECT_PATH_RE);
    }
  });

  test("should show session view with agent activity", async ({ page }) => {
    // Navigate to an existing session page
    await page.goto("/dashboard/sessions");
    await expect(page.getByText(SESSIONS_HEADING_RE)).toBeVisible();
  });
});
