import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:e2e-test-generator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratedE2ETest {
  content: string;
  fileName: string;
  framework: "playwright";
}

export interface UserFlowStep {
  action: "navigate" | "click" | "fill" | "assert" | "wait";
  selector?: string;
  url?: string;
  value?: string;
}

export interface RouteSpec {
  expectedElements: string[];
  expectedStatus: number;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
}

export interface PageSpec {
  name: string;
  url: string;
}

// ---------------------------------------------------------------------------
// E2ETestGenerator
// ---------------------------------------------------------------------------

/**
 * Generates Playwright E2E tests from user flow descriptions,
 * route definitions, and page specs for accessibility testing.
 */
export class E2ETestGenerator {
  /**
   * Generate a Playwright test from a user flow description.
   */
  generateFromUserFlow(
    flowDescription: string,
    steps: UserFlowStep[]
  ): GeneratedE2ETest {
    logger.info({ flowDescription }, "Generating E2E test from user flow");

    const testSteps = steps.map((step) => this.stepToPlaywright(step));
    const testName = this.slugify(flowDescription);

    const content = `import { test, expect } from "@playwright/test";

test.describe("${this.escapeString(flowDescription)}", () => {
  test("should complete the user flow", async ({ page }) => {
${testSteps.map((s) => `    ${s}`).join("\n")}
  });
});
`;

    return {
      fileName: `${testName}.spec.ts`,
      content,
      framework: "playwright",
    };
  }

  /**
   * Generate route-level tests to verify that all routes respond correctly.
   */
  generateFromRoutes(routes: RouteSpec[]): GeneratedE2ETest {
    logger.info(
      { routeCount: routes.length },
      "Generating E2E tests from routes"
    );

    const tests = routes.map(
      (
        route
      ) => `  test("${route.method} ${route.path} responds with ${route.expectedStatus}", async ({ request }) => {
    const response = await request.${route.method.toLowerCase()}("${route.path}");
    expect(response.status()).toBe(${route.expectedStatus});
  });`
    );

    const content = `import { test, expect } from "@playwright/test";

test.describe("Route tests", () => {
${tests.join("\n\n")}
});
`;

    return {
      fileName: "routes.spec.ts",
      content,
      framework: "playwright",
    };
  }

  /**
   * Generate accessibility tests for a list of pages.
   */
  generateAccessibilityTests(pages: PageSpec[]): GeneratedE2ETest {
    logger.info({ pageCount: pages.length }, "Generating accessibility tests");

    const tests = pages.map(
      (
        page
      ) => `  test("${this.escapeString(page.name)} should be accessible", async ({ page: browserPage }) => {
    await browserPage.goto("${page.url}");

    // Check for alt text on images
    const images = browserPage.locator("img");
    const imageCount = await images.count();
    for (let i = 0; i < imageCount; i++) {
      const alt = await images.nth(i).getAttribute("alt");
      expect(alt, \`Image \${i} missing alt text\`).toBeTruthy();
    }

    // Check for form labels
    const inputs = browserPage.locator("input:not([type='hidden'])");
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i);
      const id = await input.getAttribute("id");
      const ariaLabel = await input.getAttribute("aria-label");
      const ariaLabelledBy = await input.getAttribute("aria-labelledby");

      if (id) {
        const label = browserPage.locator(\`label[for="\${id}"]\`);
        const hasLabel = (await label.count()) > 0;
        expect(
          hasLabel || !!ariaLabel || !!ariaLabelledBy,
          \`Input \${i} (\${id}) missing label\`
        ).toBeTruthy();
      }
    }

    // Check heading hierarchy
    const headings = browserPage.locator("h1, h2, h3, h4, h5, h6");
    const headingCount = await headings.count();
    let lastLevel = 0;
    for (let i = 0; i < headingCount; i++) {
      const tag = await headings.nth(i).evaluate((el) => el.tagName);
      const level = Number.parseInt(tag.replace("H", ""), 10);
      expect(level, \`Heading level skipped from h\${lastLevel} to h\${level}\`).toBeLessThanOrEqual(lastLevel + 2);
      lastLevel = level;
    }
  });`
    );

    const content = `import { test, expect } from "@playwright/test";

test.describe("Accessibility tests", () => {
${tests.join("\n\n")}
});
`;

    return {
      fileName: "accessibility.spec.ts",
      content,
      framework: "playwright",
    };
  }

  // ---- Private helpers ----

  private stepToPlaywright(step: UserFlowStep): string {
    switch (step.action) {
      case "navigate":
        return `await page.goto("${step.url ?? "/"}");`;
      case "click":
        return `await page.click("${step.selector ?? "body"}");`;
      case "fill":
        return `await page.fill("${step.selector ?? "input"}", "${step.value ?? ""}");`;
      case "assert":
        return `await expect(page.locator("${step.selector ?? "body"}")).toBeVisible();`;
      case "wait":
        return `await page.waitForSelector("${step.selector ?? "body"}");`;
      default:
        return `// Unknown action: ${step.action}`;
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private escapeString(text: string): string {
    return text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  }
}
