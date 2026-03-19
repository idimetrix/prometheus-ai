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
];
