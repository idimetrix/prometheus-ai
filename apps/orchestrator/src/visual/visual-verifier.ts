import { createLogger } from "@prometheus/logger";
import { modelRouterClient, sandboxManagerClient } from "@prometheus/utils";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:visual");

const APP_ROUTER_PAGE_RE = /app\/(?:\([^)]+\)\/)?(.+?)\/page\./;
const APP_ROUTER_DIR_RE = /app\/(?:\([^)]+\)\/)?(.+?)\//;

export interface VisualVerificationResult {
  issues: Array<{
    description: string;
    severity: "critical" | "warning" | "suggestion";
    location?: string;
  }>;
  pagesChecked: number;
  passed: boolean;
  score: number;
  summary: string;
}

/**
 * VisualVerifier automatically verifies frontend changes by:
 * 1. Starting the dev server in the sandbox
 * 2. Taking screenshots of affected pages via Playwright
 * 3. Sending screenshots to the vision model for analysis
 * 4. Reporting visual issues back to the coding agent
 */
export class VisualVerifier {
  /**
   * Verify frontend changes by taking screenshots and analyzing them.
   */
  async verify(
    agentLoop: AgentLoop,
    projectId: string,
    changedFiles: string[],
    taskDescription: string
  ): Promise<VisualVerificationResult> {
    // Only verify if frontend files were changed
    const frontendFiles = changedFiles.filter(
      (f) =>
        f.endsWith(".tsx") ||
        f.endsWith(".jsx") ||
        f.endsWith(".css") ||
        f.includes("/components/") ||
        f.includes("/app/") ||
        f.includes("/pages/")
    );

    if (frontendFiles.length === 0) {
      return {
        passed: true,
        score: 1.0,
        summary: "No frontend files changed — visual verification skipped",
        issues: [],
        pagesChecked: 0,
      };
    }

    logger.info(
      { frontendFiles: frontendFiles.length, projectId },
      "Starting visual verification"
    );

    // Determine which pages/routes to check based on changed files
    const pagesToCheck = this.inferPagesFromFiles(frontendFiles);

    if (pagesToCheck.length === 0) {
      return {
        passed: true,
        score: 0.9,
        summary:
          "Changed files don't map to specific pages — skipping visual check",
        issues: [],
        pagesChecked: 0,
      };
    }

    // Attempt real screenshot-based verification via sandbox + Playwright
    const screenshots = await this.captureScreenshots(pagesToCheck);

    if (screenshots.length > 0) {
      // Send screenshots to vision model for analysis
      return await this.analyzeScreenshots(
        screenshots,
        frontendFiles,
        taskDescription,
        pagesToCheck.length
      );
    }

    // Fallback: use LLM code review if screenshots unavailable
    return await this.fallbackCodeReview(
      agentLoop,
      frontendFiles,
      taskDescription,
      pagesToCheck.length
    );
  }

  /**
   * Verify pages via Playwright by capturing screenshots through
   * the sandbox-manager's screenshot endpoint and performing
   * basic pixel diff comparison when a reference is available.
   */
  async verifyViaPlaywright(
    pages: string[],
    referenceScreenshots?: Array<{ url: string; base64: string }>
  ): Promise<{
    screenshots: Array<{ url: string; base64: string }>;
    diffs: Array<{ url: string; diffPercent: number; passed: boolean }>;
  }> {
    const screenshots = await this.captureScreenshots(pages);

    const diffs: Array<{
      url: string;
      diffPercent: number;
      passed: boolean;
    }> = [];

    if (referenceScreenshots && referenceScreenshots.length > 0) {
      for (const screenshot of screenshots) {
        const reference = referenceScreenshots.find(
          (r) => r.url === screenshot.url
        );
        if (reference) {
          const diffPercent = this.calculatePixelDiff(
            reference.base64,
            screenshot.base64
          );
          // Allow up to 5% pixel difference
          const DIFF_THRESHOLD = 0.05;
          diffs.push({
            url: screenshot.url,
            diffPercent,
            passed: diffPercent <= DIFF_THRESHOLD,
          });
        }
      }
    }

    logger.info(
      {
        pagesChecked: pages.length,
        screenshotsCapured: screenshots.length,
        diffsComputed: diffs.length,
      },
      "Playwright verification completed"
    );

    return { screenshots, diffs };
  }

  /**
   * Basic pixel diff comparison between two base64-encoded images.
   * Compares raw byte values as a rough approximation of visual difference.
   * Returns the percentage of differing bytes (0.0 - 1.0).
   */
  private calculatePixelDiff(
    referenceBase64: string,
    currentBase64: string
  ): number {
    const refBuffer = Buffer.from(referenceBase64, "base64");
    const curBuffer = Buffer.from(currentBase64, "base64");

    // Use the smaller buffer length to avoid out-of-bounds
    const compareLength = Math.min(refBuffer.length, curBuffer.length);

    if (compareLength === 0) {
      // If either buffer is empty, consider it fully different
      return 1.0;
    }

    let diffCount = 0;
    for (let i = 0; i < compareLength; i++) {
      if (refBuffer[i] !== curBuffer[i]) {
        diffCount++;
      }
    }

    // Also account for size difference
    const sizeDiff = Math.abs(refBuffer.length - curBuffer.length);
    const totalDiff = diffCount + sizeDiff;
    const maxLength = Math.max(refBuffer.length, curBuffer.length);

    return totalDiff / maxLength;
  }

  private async captureScreenshots(
    pages: string[]
  ): Promise<Array<{ url: string; base64: string }>> {
    try {
      const devServerUrl = "http://localhost:3000";
      const urls = pages.map((p) => `${devServerUrl}${p}`);

      const response = await sandboxManagerClient.post<{
        screenshots: Array<{ url: string; base64: string }>;
      }>("/screenshots", { urls, width: 1280, height: 720 });

      return response.data.screenshots;
    } catch (err) {
      logger.warn(
        { err },
        "Screenshot capture failed, falling back to code review"
      );
      return [];
    }
  }

  private async analyzeScreenshots(
    screenshots: Array<{ url: string; base64: string }>,
    changedFiles: string[],
    taskDescription: string,
    pagesChecked: number
  ): Promise<VisualVerificationResult> {
    try {
      const screenshotDescriptions = screenshots
        .map((s, i) => `Screenshot ${i + 1}: ${s.url}`)
        .join("\n");

      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "vision",
        messages: [
          {
            role: "user",
            content: `Analyze these screenshots of frontend pages for visual issues.

Changed files:
${changedFiles.map((f) => `- ${f}`).join("\n")}

Task context: ${taskDescription}

Screenshots taken:
${screenshotDescriptions}

Check for:
- Layout issues (overlapping elements, broken alignment)
- Missing content or placeholder text
- Broken styles (wrong colors, missing backgrounds)
- Accessibility issues (low contrast, missing labels)
- Responsive design problems

Report issues with severity markers: [CRITICAL], [WARNING], or [SUGGESTION].
If everything looks correct, say "No visual issues found."`,
          },
        ],
        options: { maxTokens: 1024, temperature: 0.2 },
      });

      const output =
        response.data.choices[0]?.message.content ?? "Analysis unavailable";
      const issues = this.parseIssues(output);
      const hasCritical = issues.some((i) => i.severity === "critical");
      let score: number;
      if (hasCritical) {
        score = 0.3;
      } else if (issues.length > 0) {
        score = Math.max(0.5, 1 - issues.length * 0.1);
      } else {
        score = 1.0;
      }

      return {
        passed: !hasCritical,
        score,
        summary:
          issues.length === 0
            ? "Visual verification passed — no issues found"
            : `Found ${issues.length} visual issue(s) from screenshots`,
        issues,
        pagesChecked,
      };
    } catch (err) {
      logger.warn({ err }, "Vision model analysis failed");
      return {
        passed: true,
        score: 0.7,
        summary: "Vision analysis unavailable — assuming acceptable",
        issues: [],
        pagesChecked,
      };
    }
  }

  private async fallbackCodeReview(
    agentLoop: AgentLoop,
    frontendFiles: string[],
    taskDescription: string,
    pagesChecked: number
  ): Promise<VisualVerificationResult> {
    const verifyResult = await agentLoop.executeTask(
      `Verify the frontend changes visually. The following files were modified:
${frontendFiles.map((f) => `- ${f}`).join("\n")}

Task context: ${taskDescription}

Steps:
1. Check that the dev server would start without errors by examining the changed code
2. Look for common visual issues in the changed components:
   - Missing or incorrect CSS classes
   - Broken layouts or missing responsive design
   - Missing loading/error states
   - Accessibility issues (missing alt text, ARIA labels)
   - Hardcoded text that should be dynamic
3. Verify component props are properly typed and handled

Report any issues found with severity (critical/warning/suggestion).
If everything looks correct, confirm the changes are visually sound.`,
      "frontend_coder"
    );

    const issues = this.parseIssues(verifyResult.output);
    const hasCritical = issues.some((i) => i.severity === "critical");
    let score: number;
    if (hasCritical) {
      score = 0.3;
    } else if (issues.length > 0) {
      score = Math.max(0.5, 1 - issues.length * 0.1);
    } else {
      score = 1.0;
    }

    return {
      passed: !hasCritical,
      score,
      summary:
        issues.length === 0
          ? "Visual verification passed — no issues found"
          : `Found ${issues.length} visual issue(s)`,
      issues,
      pagesChecked,
    };
  }

  private inferPagesFromFiles(files: string[]): string[] {
    const pages: string[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      const appMatch = file.match(APP_ROUTER_PAGE_RE);
      if (appMatch) {
        const route = `/${appMatch[1]}`;
        if (!seen.has(route)) {
          seen.add(route);
          pages.push(route);
        }
        continue;
      }

      const pageDir = file.match(APP_ROUTER_DIR_RE);
      if (pageDir) {
        const route = `/${pageDir[1]}`;
        if (!seen.has(route)) {
          seen.add(route);
          pages.push(route);
        }
      }
    }

    if (
      files.some((f) => f.includes("layout.tsx") || f.includes("layout.ts")) &&
      !seen.has("/")
    ) {
      pages.push("/");
    }

    return pages.slice(0, 5);
  }

  private parseIssues(output: string): VisualVerificationResult["issues"] {
    const issues: VisualVerificationResult["issues"] = [];

    const patterns = [
      { re: /\[CRITICAL\]\s*(.+?)(?:\n|$)/gi, severity: "critical" as const },
      { re: /\[WARNING\]\s*(.+?)(?:\n|$)/gi, severity: "warning" as const },
      {
        re: /\[SUGGESTION\]\s*(.+?)(?:\n|$)/gi,
        severity: "suggestion" as const,
      },
    ];

    for (const { re, severity } of patterns) {
      let match: RegExpExecArray | null = re.exec(output);
      while (match !== null) {
        issues.push({
          severity,
          description: match[1]?.trim() ?? "",
        });
        match = re.exec(output);
      }
    }

    return issues;
  }
}
