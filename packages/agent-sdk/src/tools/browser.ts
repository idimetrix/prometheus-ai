import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type { AgentToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const browserOpenSchema = z
  .object({
    url: z.string().url().describe("URL to open (e.g., http://localhost:3000)"),
    screenshot: z
      .boolean()
      .optional()
      .describe("Take a screenshot instead of returning HTML (default: false)"),
    waitFor: z
      .string()
      .optional()
      .describe("CSS selector to wait for before capturing"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in milliseconds (default: 15000)"),
  })
  .strict();

export const browserScreenshotSchema = z
  .object({
    url: z.string().url().describe("URL to open"),
    selector: z.string().describe("CSS selector of the element to screenshot"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in milliseconds (default: 15000)"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const browserTools: AgentToolDefinition[] = [
  {
    name: "browser_open",
    description:
      "Open a URL in a headless browser (Playwright) and return the page content or a screenshot. Useful for testing web applications, checking rendered output, and verifying deployments.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to open (e.g., http://localhost:3000)",
        },
        screenshot: {
          type: "boolean",
          description:
            "Take a screenshot instead of returning HTML (default: false)",
        },
        waitFor: {
          type: "string",
          description: "CSS selector to wait for before capturing (optional)",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 15000)",
        },
      },
      required: ["url"],
    },
    zodSchema: browserOpenSchema,
    permissionLevel: "read",
    creditCost: 5,
    execute: async (input, ctx) => {
      const parsed = browserOpenSchema.parse(input);
      const timeout = parsed.timeout || 15_000;
      const screenshotPath = `/tmp/prometheus-screenshot-${ctx.sandboxId}-${Date.now()}.png`;

      const waitForClause = parsed.waitFor
        ? `await page.waitForSelector('${parsed.waitFor.replace(/'/g, "\\'")}', { timeout: ${timeout} });`
        : `await page.waitForLoadState('networkidle', { timeout: ${timeout} }).catch(() => {});`;

      const captureClause = parsed.screenshot
        ? `await page.screenshot({ path: '${screenshotPath}', fullPage: true });
           console.log('Screenshot saved to: ${screenshotPath}');`
        : `const content = await page.content();
           // Truncate to avoid overwhelming output
           const truncated = content.length > 50000 ? content.slice(0, 50000) + '\\n... (truncated)' : content;
           console.log(truncated);`;

      const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('${parsed.url.replace(/'/g, "\\'")}', { timeout: ${timeout}, waitUntil: 'domcontentloaded' });
    ${waitForClause}
    ${captureClause}
  } catch (err) {
    console.error('Browser error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
      `.trim();

      const command = `node -e '${script.replace(/'/g, "'\\''")}'`;
      const result = await execInSandbox(command, ctx, timeout + 10_000);

      if (result.success && parsed.screenshot) {
        return {
          success: true,
          output: `Screenshot captured at ${screenshotPath}`,
          metadata: { screenshotPath, url: parsed.url },
        };
      }
      return result;
    },
  },
  {
    name: "browser_screenshot",
    description:
      "Take a screenshot of a specific element on a page. Returns the path to the saved screenshot file.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open" },
        selector: {
          type: "string",
          description: "CSS selector of the element to screenshot",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 15000)",
        },
      },
      required: ["url", "selector"],
    },
    zodSchema: browserScreenshotSchema,
    permissionLevel: "read",
    creditCost: 5,
    execute: async (input, ctx) => {
      const parsed = browserScreenshotSchema.parse(input);
      const timeout = parsed.timeout || 15_000;
      const screenshotPath = `/tmp/prometheus-element-${ctx.sandboxId}-${Date.now()}.png`;

      const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('${parsed.url.replace(/'/g, "\\'")}', { timeout: ${timeout}, waitUntil: 'domcontentloaded' });
    const element = await page.waitForSelector('${parsed.selector.replace(/'/g, "\\'")}', { timeout: ${timeout} });
    if (!element) { console.error('Element not found: ${parsed.selector}'); process.exit(1); }
    await element.screenshot({ path: '${screenshotPath}' });
    console.log('Element screenshot saved to: ${screenshotPath}');
  } catch (err) {
    console.error('Browser error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
      `.trim();

      const command = `node -e '${script.replace(/'/g, "'\\''")}'`;
      const result = await execInSandbox(command, ctx, timeout + 10_000);

      if (result.success) {
        return {
          success: true,
          output: `Element screenshot captured at ${screenshotPath}`,
          metadata: {
            screenshotPath,
            url: parsed.url,
            selector: parsed.selector,
          },
        };
      }
      return result;
    },
  },
];
