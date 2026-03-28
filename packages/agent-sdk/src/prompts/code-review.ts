/**
 * Code Review Prompts — GAP-035
 *
 * Structured prompts for AI-powered code review that checks security,
 * performance, style, logic, error handling, and test coverage.
 */

export const CODE_REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer with deep knowledge of software engineering best practices. You review code changes with a focus on:

1. **Security**: SQL injection, XSS, CSRF, secrets in code, insecure dependencies
2. **Performance**: N+1 queries, unnecessary allocations, missing indexes, O(n²) algorithms
3. **Logic**: Off-by-one errors, race conditions, null handling, edge cases
4. **Style**: Naming conventions, code organization, dead code, complexity
5. **Error Handling**: Missing try/catch, swallowed errors, unhelpful error messages
6. **Testing**: Missing tests for critical paths, untested edge cases

For each issue found, provide:
- **Severity**: critical, high, medium, low, info
- **Line**: The approximate line number in the diff
- **Category**: security, performance, logic, style, error_handling, testing
- **Message**: A clear description of the issue
- **Suggestion**: How to fix it (with code if applicable)

Respond in JSON format:
{
  "summary": "Brief overall assessment",
  "score": 1-10,
  "issues": [{ "severity": "...", "line": 0, "category": "...", "message": "...", "suggestion": "..." }],
  "positives": ["Things done well"]
}`;

export interface ReviewContext {
  /** Framework being used (e.g., "Next.js", "Express", "Django") */
  framework?: string;
  /** Primary language of the diff */
  language: string;
  /** Project-specific rules to enforce */
  projectRules?: string[];
}

/**
 * Build a complete code review prompt from a diff and context.
 */
export function buildReviewPrompt(
  diff: string,
  context: ReviewContext
): string {
  const sections: string[] = [];

  sections.push("## Code Review Request");
  sections.push(`**Language:** ${context.language}`);

  if (context.framework) {
    sections.push(`**Framework:** ${context.framework}`);
  }

  if (context.projectRules && context.projectRules.length > 0) {
    sections.push("\n### Project-Specific Rules");
    for (const rule of context.projectRules) {
      sections.push(`- ${rule}`);
    }
  }

  sections.push("\n### Diff to Review");
  sections.push("```diff");
  sections.push(diff);
  sections.push("```");

  sections.push(
    "\nReview this diff thoroughly. Focus on issues that could cause bugs, security vulnerabilities, or performance problems in production. Ignore cosmetic issues unless they significantly impact readability."
  );

  return sections.join("\n");
}

export interface ReviewIssue {
  category:
    | "security"
    | "performance"
    | "logic"
    | "style"
    | "error_handling"
    | "testing";
  line: number;
  message: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  suggestion: string;
}

export interface ReviewResult {
  issues: ReviewIssue[];
  positives: string[];
  score: number;
  summary: string;
}

const JSON_EXTRACT_RE = /\{[\s\S]*\}/;

/**
 * Parse the LLM's review response into a structured ReviewResult.
 */
export function parseReviewResponse(raw: string): ReviewResult {
  try {
    const match = raw.match(JSON_EXTRACT_RE);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        summary: parsed.summary ?? "",
        score: parsed.score ?? 5,
        issues: (parsed.issues ?? []).map(
          (i: Record<string, unknown>): ReviewIssue => ({
            severity: (i.severity as ReviewIssue["severity"]) ?? "medium",
            line: (i.line as number) ?? 0,
            category: (i.category as ReviewIssue["category"]) ?? "logic",
            message: (i.message as string) ?? "",
            suggestion: (i.suggestion as string) ?? "",
          })
        ),
        positives: parsed.positives ?? [],
      };
    }
  } catch {
    // fallthrough
  }

  return {
    summary: raw.slice(0, 500),
    score: 5,
    issues: [],
    positives: [],
  };
}
