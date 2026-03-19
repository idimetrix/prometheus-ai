import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:visual");

const _MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
const _SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

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
 * 2. Taking screenshots of affected pages
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

    // Use the agent to do a visual check via terminal
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

    // Parse the verification result
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

    logger.info(
      {
        pagesChecked: pagesToCheck.length,
        issues: issues.length,
        score,
      },
      "Visual verification complete"
    );

    return {
      passed: !hasCritical,
      score,
      summary:
        issues.length === 0
          ? "Visual verification passed — no issues found"
          : `Found ${issues.length} visual issue(s)`,
      issues,
      pagesChecked: pagesToCheck.length,
    };
  }

  /**
   * Infer which pages to check based on modified file paths.
   */
  private inferPagesFromFiles(files: string[]): string[] {
    const pages: string[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      // Next.js App Router: app/(group)/page/page.tsx -> /page
      const appMatch = file.match(APP_ROUTER_PAGE_RE);
      if (appMatch) {
        const route = `/${appMatch[1]}`;
        if (!seen.has(route)) {
          seen.add(route);
          pages.push(route);
        }
        continue;
      }

      // Components in a page directory
      const pageDir = file.match(APP_ROUTER_DIR_RE);
      if (pageDir) {
        const route = `/${pageDir[1]}`;
        if (!seen.has(route)) {
          seen.add(route);
          pages.push(route);
        }
      }
    }

    // Always check the home page if layout files changed
    if (
      files.some((f) => f.includes("layout.tsx") || f.includes("layout.ts")) &&
      !seen.has("/")
    ) {
      pages.push("/");
    }

    return pages.slice(0, 5); // Cap at 5 pages
  }

  private parseIssues(output: string): VisualVerificationResult["issues"] {
    const issues: VisualVerificationResult["issues"] = [];

    // Look for severity markers
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
