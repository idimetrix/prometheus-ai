import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("should redirect to sign-in when accessing dashboard unauthenticated", async ({ page }) => {
    await page.goto("/dashboard");
    // Clerk should redirect to sign-in
    await expect(page).toHaveURL(/sign-in/);
  });

  test("should display sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("should display sign-up page", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page).toHaveURL(/sign-up/);
  });
});
