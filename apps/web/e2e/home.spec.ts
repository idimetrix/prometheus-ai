import { test, expect } from "@playwright/test";

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
});
