import type { AgentToolDefinition } from "./types";
import { execInSandbox } from "./sandbox";

export const browserTools: AgentToolDefinition[] = [
  {
    name: "browser_open",
    description: "Open a URL in a headless browser (Playwright) and return the page content or a screenshot. Useful for testing web applications, checking rendered output, and verifying deployments.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open (e.g., http://localhost:3000)" },
        screenshot: { type: "boolean", description: "Take a screenshot instead of returning HTML (default: false)" },
        waitFor: { type: "string", description: "CSS selector to wait for before capturing (optional)" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 15000)" },
      },
      required: ["url"],
    },
    permissionLevel: "read",
    creditCost: 5,
    execute: async (input, ctx) => {
      const url = input.url as string;
      const takeScreenshot = input.screenshot as boolean | undefined;
      const waitFor = input.waitFor as string | undefined;
      const timeout = (input.timeout as number) || 15_000;

      // Construct a node script that uses playwright to load the page
      const screenshotPath = `/tmp/prometheus-screenshot-${ctx.sandboxId}-${Date.now()}.png`;

      const waitForClause = waitFor
        ? `await page.waitForSelector('${waitFor.replace(/'/g, "\\'")}', { timeout: ${timeout} });`
        : `await page.waitForLoadState('networkidle', { timeout: ${timeout} }).catch(() => {});`;

      const captureClause = takeScreenshot
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
    await page.goto('${url.replace(/'/g, "\\'")}', { timeout: ${timeout}, waitUntil: 'domcontentloaded' });
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

      if (result.success && takeScreenshot) {
        return {
          success: true,
          output: `Screenshot captured at ${screenshotPath}`,
          metadata: { screenshotPath, url },
        };
      }
      return result;
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of a specific element on a page. Returns the path to the saved screenshot file.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open" },
        selector: { type: "string", description: "CSS selector of the element to screenshot" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 15000)" },
      },
      required: ["url", "selector"],
    },
    permissionLevel: "read",
    creditCost: 5,
    execute: async (input, ctx) => {
      const url = input.url as string;
      const selector = input.selector as string;
      const timeout = (input.timeout as number) || 15_000;
      const screenshotPath = `/tmp/prometheus-element-${ctx.sandboxId}-${Date.now()}.png`;

      const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('${url.replace(/'/g, "\\'")}', { timeout: ${timeout}, waitUntil: 'domcontentloaded' });
    const element = await page.waitForSelector('${selector.replace(/'/g, "\\'")}', { timeout: ${timeout} });
    if (!element) { console.error('Element not found: ${selector}'); process.exit(1); }
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
          metadata: { screenshotPath, url, selector },
        };
      }
      return result;
    },
  },
];
