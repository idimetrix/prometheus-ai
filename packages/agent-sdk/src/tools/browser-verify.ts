/**
 * Browser Verification Tool — GAP-034
 *
 * Provides the agent with a tool to verify web pages work correctly.
 * Navigates to a URL, takes a screenshot, checks for errors, and
 * verifies expected elements/text are present.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:browser-verify");

export interface BrowserVerifyParams {
  /** CSS selectors that should be present on the page */
  expectedElements?: string[];
  /** Text content that should appear on the page */
  expectedText?: string[];
  /** URL to navigate to and verify */
  url: string;
  /** Wait for this many milliseconds before checking (default 2000) */
  waitMs?: number;
}

export interface VerificationResult {
  /** Console errors found on the page */
  consoleErrors: string[];
  /** Elements that were expected but not found */
  missingElements: string[];
  /** Text that was expected but not found */
  missingText: string[];
  /** Page title */
  pageTitle: string;
  /** Whether the page loaded successfully (HTTP 200 + no JS errors) */
  passed: boolean;
  /** Base64 screenshot (if available) */
  screenshot?: string;
  /** Summary of verification results */
  summary: string;
}

/**
 * Tool definition for the browser verification tool.
 * The agent calls this to verify a web page works correctly.
 */
export const browserVerifyTool = {
  name: "browser_verify",
  description:
    "Navigate to a URL, take a screenshot, and verify the page loads correctly. Checks for expected elements, expected text, and console errors.",
  parameters: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "URL to verify" },
      expectedElements: {
        type: "array",
        items: { type: "string" },
        description: "CSS selectors that should be present",
      },
      expectedText: {
        type: "array",
        items: { type: "string" },
        description: "Text content that should appear",
      },
      waitMs: {
        type: "number",
        description: "Milliseconds to wait before checking (default 2000)",
      },
    },
    required: ["url"],
  },

  async execute(
    params: BrowserVerifyParams,
    sandboxManagerUrl: string
  ): Promise<VerificationResult> {
    const {
      url,
      expectedElements = [],
      expectedText = [],
      waitMs = 2000,
    } = params;

    logger.info({ url, expectedElements, expectedText }, "Verifying page");

    try {
      // Call the sandbox manager's browser verification endpoint
      const response = await fetch(`${sandboxManagerUrl}/browser/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, expectedElements, expectedText, waitMs }),
      });

      if (!response.ok) {
        return {
          passed: false,
          pageTitle: "",
          consoleErrors: [`HTTP ${response.status}: ${response.statusText}`],
          missingElements: expectedElements,
          missingText: expectedText,
          summary: `Failed to load page: HTTP ${response.status}`,
        };
      }

      const result = (await response.json()) as VerificationResult;

      logger.info(
        {
          url,
          passed: result.passed,
          consoleErrors: result.consoleErrors.length,
          missingElements: result.missingElements.length,
        },
        "Verification complete"
      );

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ url, error: msg }, "Browser verification failed");

      return {
        passed: false,
        pageTitle: "",
        consoleErrors: [msg],
        missingElements: expectedElements,
        missingText: expectedText,
        summary: `Verification failed: ${msg}`,
      };
    }
  },
};
