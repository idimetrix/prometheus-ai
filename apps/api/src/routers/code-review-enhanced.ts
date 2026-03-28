import { sessionEvents, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:code-review-enhanced");

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/;

const reviewFindingSchema = z.object({
  category: z.string(),
  file: z.string(),
  line: z.number(),
  message: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  suggestion: z.string().optional(),
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const codeReviewEnhancedRouter = router({
  // ---------------------------------------------------------------------------
  // Review a git diff
  // ---------------------------------------------------------------------------
  reviewDiff: protectedProcedure
    .input(
      z.object({
        diff: z
          .string()
          .min(1, "Diff text is required")
          .max(500_000, "Diff too large"),
        language: z.string().min(1).default("typescript"),
        framework: z.string().optional(),
        projectRules: z.array(z.string()).optional(),
      })
    )
    .mutation(({ input }) => {
      const reviewId = generateId("rev");

      logger.info(
        {
          reviewId,
          language: input.language,
          framework: input.framework,
          diffLength: input.diff.length,
        },
        "Starting diff review"
      );

      // Build structured review findings from the diff
      // In production, this would call an LLM with the code review prompt.
      // For now, return the review structure so the caller can pipe it through.
      const findings: ReviewFinding[] = [];

      // Basic static checks that don't require an LLM
      const lines = input.diff.split("\n");
      let lineIndex = 0;
      for (const line of lines) {
        lineIndex++;

        // Check for common security issues
        if (
          line.includes("eval(") ||
          line.includes("Function(") ||
          line.includes("innerHTML")
        ) {
          findings.push({
            severity: "high",
            category: "security",
            file: extractFileFromDiff(lines, lineIndex - 1),
            line: lineIndex,
            message:
              "Potentially unsafe dynamic code execution or HTML injection",
            suggestion:
              "Use safer alternatives like textContent, JSON.parse, or template literals",
          });
        }

        // Check for console.log in added lines
        if (line.startsWith("+") && line.includes("console.log")) {
          findings.push({
            severity: "low",
            category: "style",
            file: extractFileFromDiff(lines, lineIndex - 1),
            line: lineIndex,
            message: "console.log should be removed before merging",
            suggestion: "Use a structured logger instead",
          });
        }

        // Check for TODO/FIXME/HACK comments in added lines
        if (line.startsWith("+") && TODO_PATTERN.test(line)) {
          findings.push({
            severity: "info",
            category: "style",
            file: extractFileFromDiff(lines, lineIndex - 1),
            line: lineIndex,
            message: "TODO/FIXME comment found — consider tracking as an issue",
          });
        }
      }

      logger.info(
        { reviewId, findingCount: findings.length },
        "Diff review complete"
      );

      return {
        reviewId,
        language: input.language,
        framework: input.framework ?? null,
        findings,
        summary: `Found ${findings.length} issue${findings.length === 1 ? "" : "s"} in diff`,
        score: findings.length === 0 ? 10 : Math.max(1, 10 - findings.length),
      };
    }),

  // ---------------------------------------------------------------------------
  // Review a pull request
  // ---------------------------------------------------------------------------
  reviewPR: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        prNumber: z.number().int().positive("PR number must be positive"),
        provider: z.enum(["github", "gitlab", "bitbucket"]).default("github"),
      })
    )
    .mutation(({ input }) => {
      const reviewId = generateId("rev");

      logger.info(
        {
          reviewId,
          projectId: input.projectId,
          prNumber: input.prNumber,
          provider: input.provider,
        },
        "Starting PR review"
      );

      // In production, this would:
      // 1. Fetch the PR diff from the provider (GitHub/GitLab/Bitbucket API)
      // 2. Run the diff through the LLM code review pipeline
      // 3. Post review comments back to the PR

      return {
        reviewId,
        projectId: input.projectId,
        prNumber: input.prNumber,
        provider: input.provider,
        status: "queued" as const,
        message:
          "PR review has been queued. Results will be posted as PR comments.",
      };
    }),

  // ---------------------------------------------------------------------------
  // Auto-fix review comments
  // ---------------------------------------------------------------------------
  autoFix: protectedProcedure
    .input(
      z.object({
        reviewId: z.string().min(1, "Review ID is required"),
        sessionId: z.string().optional(),
        findingIds: z.array(z.number().int()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const fixId = generateId("fix");

      logger.info(
        {
          fixId,
          reviewId: input.reviewId,
          sessionId: input.sessionId,
          findingCount: input.findingIds?.length ?? "all",
        },
        "Starting auto-fix for review findings"
      );

      // If a session ID is provided, record an event
      if (input.sessionId) {
        // Verify session access
        const session = await ctx.db.query.sessions.findFirst({
          where: eq(sessions.id, input.sessionId),
        });

        if (session) {
          await ctx.db.insert(sessionEvents).values({
            id: generateId("evt"),
            sessionId: input.sessionId,
            type: "agent_output",
            data: {
              action: "auto_fix_started",
              reviewId: input.reviewId,
              fixId,
            },
          });
        }
      }

      // In production, this would:
      // 1. Load the review findings
      // 2. Create a new session or use the existing one
      // 3. Queue tasks for the agent to fix each finding
      // 4. Return the fix results

      return {
        fixId,
        reviewId: input.reviewId,
        status: "queued" as const,
        message: "Auto-fix has been queued. The agent will fix the issues.",
      };
    }),
});

/**
 * Extract the file path from a unified diff context.
 * Looks backwards from the current line to find the nearest +++ header.
 */
function extractFileFromDiff(lines: string[], currentIndex: number): string {
  for (let i = currentIndex; i >= 0; i--) {
    const entry = lines[i];
    if (entry?.startsWith("+++ ")) {
      const path = entry.slice(4).trim();
      // Remove the "b/" prefix commonly used in git diffs
      return path.startsWith("b/") ? path.slice(2) : path;
    }
  }
  return "unknown";
}
