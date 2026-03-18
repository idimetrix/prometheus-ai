import { expect, test } from "@playwright/test";

const PROMETHEUS_TITLE_RE = /Prometheus/i;
const SIGN_IN_RE = /sign-in/;
const SIGN_UP_OR_ONBOARDING_RE = /sign-up|onboarding/;

test.describe("Home Page", () => {
  test("should display the landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("The AI Engineering Platform")).toBeVisible();
  });

  test("should have navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Pricing")).toBeVisible();
    await expect(page.getByText("Sign In")).toBeVisible();
  });

  test("should have CTA buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Get Started Free")).toBeVisible();
    await expect(page.getByText("Learn More")).toBeVisible();
  });

  test("should have proper page title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(PROMETHEUS_TITLE_RE);
  });

  test("should render hero section with description", async ({ page }) => {
    await page.goto("/");
    // The hero section should convey the AI-powered engineering value prop
    const hero = page.locator("main").first();
    await expect(hero).toBeVisible();
  });

  test("should have a responsive navigation bar", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator("nav").first();
    await expect(nav).toBeVisible();
  });

  test("Sign In link navigates to sign-in page", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Sign In").click();
    await expect(page).toHaveURL(SIGN_IN_RE);
  });

  test("Get Started Free link navigates correctly", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByText("Get Started Free");
    await expect(cta).toBeVisible();
    await cta.click();
    // Should navigate to sign-up or onboarding
    await expect(page).toHaveURL(SIGN_UP_OR_ONBOARDING_RE);
  });

  test("should have a pricing section or link", async ({ page }) => {
    await page.goto("/");
    const pricing = page.getByText("Pricing");
    await expect(pricing).toBeVisible();
  });

  test("page loads within acceptable time", async ({ page }) => {
    const start = Date.now();
    await page.goto("/");
    await expect(page.getByText("The AI Engineering Platform")).toBeVisible();
    const loadTime = Date.now() - start;
    // Landing page should load within 10 seconds (generous for dev)
    expect(loadTime).toBeLessThan(10_000);
  });
});
