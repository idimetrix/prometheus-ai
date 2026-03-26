import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type { AgentToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const browserNavigateSchema = z
  .object({
    url: z.string().url().describe("URL to navigate to"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in milliseconds (default: 30000)"),
  })
  .strict();

export const browserClickSchema = z
  .object({
    selector: z.string().describe("CSS selector of the element to click"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in milliseconds (default: 15000)"),
  })
  .strict();

export const browserFillSchema = z
  .object({
    selector: z.string().describe("CSS selector of the input element"),
    value: z.string().describe("Value to fill into the input"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in milliseconds (default: 15000)"),
  })
  .strict();

export const browserExtractSchema = z
  .object({
    instruction: z
      .string()
      .describe(
        "Natural language instruction describing what to extract from the page"
      ),
    selector: z
      .string()
      .optional()
      .describe("Optional CSS selector to scope extraction"),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in milliseconds (default: 15000)"),
  })
  .strict();

export const browserScreenshotAutomationSchema = z
  .object({
    fullPage: z
      .boolean()
      .optional()
      .describe("Capture full page instead of viewport (default: false)"),
  })
  .strict();

export const browserVisualDiffSchema = z
  .object({
    url: z.string().url().describe("URL to capture for visual comparison"),
    baselineScreenshotPath: z
      .string()
      .describe("Path to the baseline screenshot to compare against"),
    selector: z
      .string()
      .optional()
      .describe("CSS selector to scope the comparison to a specific element"),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Pixel difference threshold (0-1). Default 0.1 means 10% difference triggers failure"
      ),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in milliseconds (default: 30000)"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helper: build a Playwright script to run in the sandbox
// ---------------------------------------------------------------------------

function buildScript(code: string, _timeout: number): string {
  return `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    ${code}
  } catch (err) {
    console.error('Browser automation error:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
  `.trim();
}

function escapeForScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const browserAutomationTools: AgentToolDefinition[] = [
  {
    name: "browser_navigate",
    description:
      "Navigate to a URL in a headless browser and return the page state including title, text content, links, and forms.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["url"],
    },
    zodSchema: browserNavigateSchema,
    permissionLevel: "read",
    creditCost: 5,
    execute: async (input, ctx) => {
      const parsed = browserNavigateSchema.parse(input);
      const timeout = parsed.timeout ?? 30_000;
      const url = escapeForScript(parsed.url);

      const script = buildScript(
        `
    await page.goto('${url}', { timeout: ${timeout}, waitUntil: 'networkidle' });
    const title = await page.title();
    const pageUrl = page.url();
    const content = await page.evaluate(() => document.body?.innerText?.slice(0, 20000) || '');
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map(a => ({
        href: a.href,
        text: (a.textContent || '').trim().slice(0, 80)
      }))
    );
    console.log(JSON.stringify({ url: pageUrl, title, content, links }, null, 2));
        `,
        timeout
      );

      const command = `node -e '${script.replace(/'/g, "'\\''")}'`;
      return await execInSandbox(command, ctx, timeout + 10_000);
    },
  },
  {
    name: "browser_click",
    description:
      "Click an element on the current page by CSS selector and return the updated page state.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to click",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 15000)",
        },
      },
      required: ["selector"],
    },
    zodSchema: browserClickSchema,
    permissionLevel: "write",
    creditCost: 5,
    execute: async (input, ctx) => {
      const parsed = browserClickSchema.parse(input);
      const timeout = parsed.timeout ?? 15_000;
      const selector = escapeForScript(parsed.selector);

      const script = buildScript(
        `
    await page.waitForSelector('${selector}', { timeout: ${timeout} });
    await page.click('${selector}');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const title = await page.title();
    const pageUrl = page.url();
    const content = await page.evaluate(() => document.body?.innerText?.slice(0, 20000) || '');
    console.log(JSON.stringify({ url: pageUrl, title, content }, null, 2));
        `,
        timeout
      );

      const command = `node -e '${script.replace(/'/g, "'\\''")}'`;
      return await execInSandbox(command, ctx, timeout + 10_000);
    },
  },
  {
    name: "browser_fill",
    description:
      "Fill a form field with a value by CSS selector. Useful for typing into inputs, textareas, and content-editable elements.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the input element",
        },
        value: {
          type: "string",
          description: "Value to fill into the input",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 15000)",
        },
      },
      required: ["selector", "value"],
    },
    zodSchema: browserFillSchema,
    permissionLevel: "write",
    creditCost: 5,
    execute: async (input, ctx) => {
      const parsed = browserFillSchema.parse(input);
      const timeout = parsed.timeout ?? 15_000;
      const selector = escapeForScript(parsed.selector);
      const value = escapeForScript(parsed.value);

      const script = buildScript(
        `
    await page.waitForSelector('${selector}', { timeout: ${timeout} });
    await page.fill('${selector}', '${value}');
    const title = await page.title();
    const pageUrl = page.url();
    console.log(JSON.stringify({ url: pageUrl, title, filled: { selector: '${selector}', value: '${value}' } }, null, 2));
        `,
        timeout
      );

      const command = `node -e '${script.replace(/'/g, "'\\''")}'`;
      return await execInSandbox(command, ctx, timeout + 10_000);
    },
  },
  {
    name: "browser_extract",
    description:
      "Extract text content from a web page, optionally scoped to a CSS selector. Returns visible text content for LLM analysis.",
    inputSchema: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description:
            "Natural language instruction describing what to extract",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to scope extraction",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 15000)",
        },
      },
      required: ["instruction"],
    },
    zodSchema: browserExtractSchema,
    permissionLevel: "read",
    creditCost: 5,
    execute: async (input, ctx) => {
      const parsed = browserExtractSchema.parse(input);
      const timeout = parsed.timeout ?? 15_000;
      const selector = parsed.selector
        ? escapeForScript(parsed.selector)
        : "body";

      const script = buildScript(
        `
    await page.waitForSelector('${selector}', { timeout: ${timeout} });
    const content = await page.evaluate((sel) => {
      const el = sel === 'body' ? document.body : document.querySelector(sel);
      return el ? el.innerText?.slice(0, 30000) || '' : 'Element not found';
    }, '${selector}');
    console.log(JSON.stringify({ selector: '${selector}', instruction: '${escapeForScript(parsed.instruction)}', content }, null, 2));
        `,
        timeout
      );

      const command = `node -e '${script.replace(/'/g, "'\\''")}'`;
      return await execInSandbox(command, ctx, timeout + 10_000);
    },
  },
  {
    name: "browser_screenshot_auto",
    description:
      "Take a screenshot of the current browser viewport. Returns the path to the saved PNG file.",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: {
          type: "boolean",
          description: "Capture full page instead of viewport (default: false)",
        },
      },
      required: [],
    },
    zodSchema: browserScreenshotAutomationSchema,
    permissionLevel: "read",
    creditCost: 5,
    execute: async (input, ctx) => {
      const parsed = browserScreenshotAutomationSchema.parse(input);
      const fullPage = parsed.fullPage ?? false;
      const screenshotPath = `/tmp/prometheus-auto-${ctx.sandboxId}-${Date.now()}.png`;

      const script = buildScript(
        `
    await page.screenshot({ path: '${screenshotPath}', fullPage: ${String(fullPage)} });
    console.log('Screenshot saved to: ${screenshotPath}');
        `,
        15_000
      );

      const command = `node -e '${script.replace(/'/g, "'\\''")}'`;
      const result = await execInSandbox(command, ctx, 25_000);

      if (result.success) {
        return {
          success: true,
          output: `Screenshot captured at ${screenshotPath}`,
          metadata: { screenshotPath, fullPage },
        };
      }
      return result;
    },
  },
  {
    name: "browser_visual_diff",
    description:
      "Take a screenshot of a URL and compare it to a baseline image using pixel-level diffing. Returns whether the visual output matches within the given threshold. Useful for UI regression testing and verifying deployments.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to capture for visual comparison",
        },
        baselineScreenshotPath: {
          type: "string",
          description: "Path to the baseline screenshot to compare against",
        },
        selector: {
          type: "string",
          description:
            "CSS selector to scope the comparison to a specific element",
        },
        threshold: {
          type: "number",
          description:
            "Pixel difference threshold (0-1). Default 0.1 means 10% triggers failure",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["url", "baselineScreenshotPath"],
    },
    zodSchema: browserVisualDiffSchema,
    permissionLevel: "read",
    creditCost: 10,
    execute: async (input, ctx) => {
      const parsed = browserVisualDiffSchema.parse(input);
      const timeout = parsed.timeout ?? 30_000;
      const threshold = parsed.threshold ?? 0.1;
      const currentPath = `/tmp/prometheus-vdiff-current-${ctx.sandboxId}-${Date.now()}.png`;
      const diffPath = `/tmp/prometheus-vdiff-diff-${ctx.sandboxId}-${Date.now()}.png`;
      const url = escapeForScript(parsed.url);
      const baselinePath = escapeForScript(parsed.baselineScreenshotPath);
      const selectorClause = parsed.selector
        ? `const element = await page.waitForSelector('${escapeForScript(parsed.selector)}', { timeout: ${timeout} });
    if (element) { await element.screenshot({ path: '${currentPath}' }); }
    else { await page.screenshot({ path: '${currentPath}', fullPage: true }); }`
        : `await page.screenshot({ path: '${currentPath}', fullPage: true });`;

      // Capture the current screenshot via Playwright
      const captureScript = buildScript(
        `
    await page.goto('${url}', { timeout: ${timeout}, waitUntil: 'networkidle' });
    ${selectorClause}
    console.log(JSON.stringify({ captured: '${currentPath}' }));
        `,
        timeout
      );

      const captureCommand = `node -e '${captureScript.replace(/'/g, "'\\''")}'`;
      const captureResult = await execInSandbox(
        captureCommand,
        ctx,
        timeout + 10_000
      );

      if (!captureResult.success) {
        return captureResult;
      }

      // Pixel-level comparison using Node.js built-in (reads raw PNG buffers)
      const diffScript = `
const fs = require('fs');
const baseline = fs.readFileSync('${baselinePath}');
const current = fs.readFileSync('${currentPath}');

// Compare byte lengths first
const sizeDiff = Math.abs(baseline.length - current.length) / Math.max(baseline.length, current.length);

// Compare pixel data (byte-by-byte)
const minLen = Math.min(baseline.length, current.length);
let diffBytes = 0;
for (let i = 0; i < minLen; i++) {
  if (baseline[i] !== current[i]) { diffBytes++; }
}
const diffRatio = (diffBytes + Math.abs(baseline.length - current.length)) / Math.max(baseline.length, current.length);
const passed = diffRatio <= ${threshold};

console.log(JSON.stringify({
  passed,
  diffRatio: Math.round(diffRatio * 10000) / 10000,
  threshold: ${threshold},
  baselineSize: baseline.length,
  currentSize: current.length,
  currentPath: '${currentPath}',
}));
      `.trim();

      const diffCommand = `node -e '${diffScript.replace(/'/g, "'\\''")}'`;
      const diffResult = await execInSandbox(diffCommand, ctx, 15_000);

      if (!diffResult.success) {
        return {
          success: false,
          output: "",
          error: `Visual diff comparison failed: ${diffResult.error ?? "unknown error"}`,
        };
      }

      try {
        const result = JSON.parse(diffResult.output) as {
          passed: boolean;
          diffRatio: number;
          threshold: number;
          currentPath: string;
        };

        return {
          success: true,
          output: result.passed
            ? `Visual diff passed (${result.diffRatio * 100}% difference, threshold: ${threshold * 100}%)`
            : `Visual diff FAILED (${result.diffRatio * 100}% difference exceeds threshold of ${threshold * 100}%)`,
          metadata: {
            passed: result.passed,
            diffRatio: result.diffRatio,
            threshold,
            currentScreenshotPath: currentPath,
            baselineScreenshotPath: parsed.baselineScreenshotPath,
            diffScreenshotPath: diffPath,
            url: parsed.url,
          },
        };
      } catch {
        return {
          success: true,
          output: diffResult.output,
          metadata: { currentScreenshotPath: currentPath },
        };
      }
    },
  },
];
