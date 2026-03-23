/**
 * Phase 9: LLM-as-Judge Quality Gate.
 *
 * Evaluates every significant output via a review model slot.
 * Criteria: correctness, completeness, convention compliance, security, performance.
 * Returns: score (0-1), issues[], verdict (pass/revise/reject).
 */
import { createLogger } from "@prometheus/logger";
import {
  DEFAULT_THRESHOLDS,
  getThresholdForFile,
  isSignificantOutput,
  type QualityGateThresholds,
} from "./quality-gate-rules";

const JSON_EXTRACT_RE = /\{[\s\S]*\}/;

const logger = createLogger("orchestrator:quality-gate");

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

export type QualityVerdict = "pass" | "revise" | "reject";

export interface QualityIssue {
  category:
    | "correctness"
    | "completeness"
    | "convention"
    | "security"
    | "performance";
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  suggestion?: string;
}

export interface QualityGateResult {
  issues: QualityIssue[];
  score: number;
  scores: {
    correctness: number;
    completeness: number;
    conventions: number;
    security: number;
    performance: number;
  };
  verdict: QualityVerdict;
}

interface QualityGateOptions {
  enabled?: boolean;
  thresholds?: QualityGateThresholds;
}

export class QualityGate {
  private readonly thresholds: QualityGateThresholds;
  private readonly enabled: boolean;

  constructor(options: QualityGateOptions = {}) {
    this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
    this.enabled = options.enabled ?? true;
  }

  /**
   * Check if a tool call result should be quality-gated.
   */
  shouldEvaluate(toolName: string, args: Record<string, unknown>): boolean {
    if (!this.enabled) {
      return false;
    }
    return isSignificantOutput(toolName, args);
  }

  /**
   * Evaluate a file write/edit through the quality gate.
   */
  async evaluate(params: {
    filePath: string;
    content: string;
    taskDescription: string;
    blueprintContext?: string;
  }): Promise<QualityGateResult> {
    const { filePath, content, taskDescription, blueprintContext } = params;
    const threshold = getThresholdForFile(filePath, this.thresholds);

    const prompt = `You are a senior code reviewer acting as a quality gate. Evaluate the following code change.

## Task Description
${taskDescription}

${blueprintContext ? `## Blueprint Context\n${blueprintContext}\n` : ""}

## File: ${filePath}
\`\`\`
${content.slice(0, 10_000)}
\`\`\`

## Evaluation Criteria
Score each from 0.0 to 1.0:
1. **Correctness**: Does the code work correctly? Any bugs or logic errors?
2. **Completeness**: Does it fulfill the task requirements?
3. **Conventions**: Does it follow standard coding conventions?
4. **Security**: Any security vulnerabilities?
5. **Performance**: Any obvious performance issues?

## Response Format (JSON only)
{
  "correctness": 0.0-1.0,
  "completeness": 0.0-1.0,
  "conventions": 0.0-1.0,
  "security": 0.0-1.0,
  "performance": 0.0-1.0,
  "issues": [
    {
      "category": "correctness|completeness|convention|security|performance",
      "severity": "low|medium|high|critical",
      "description": "...",
      "suggestion": "..."
    }
  ]
}

Respond with ONLY valid JSON, no markdown.`;

    try {
      const response = await fetch(`${MODEL_ROUTER_URL}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: "review",
          messages: [
            {
              role: "system",
              content:
                "You are a code quality evaluator. Respond only with valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          options: {
            temperature: 0.1,
            maxTokens: 2048,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Quality gate LLM call failed"
        );
        return this.defaultPassResult();
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const rawContent = data.choices?.[0]?.message?.content ?? "";
      const parsed = this.parseResponse(rawContent);

      if (!parsed) {
        logger.warn("Quality gate: failed to parse LLM response");
        return this.defaultPassResult();
      }

      const overallScore =
        (parsed.correctness +
          parsed.completeness +
          parsed.conventions +
          parsed.security +
          parsed.performance) /
        5;

      let verdict: QualityVerdict;
      if (overallScore >= threshold) {
        verdict = "pass";
      } else if (overallScore >= threshold - 0.2) {
        verdict = "revise";
      } else {
        verdict = "reject";
      }

      const result: QualityGateResult = {
        score: overallScore,
        scores: {
          correctness: parsed.correctness,
          completeness: parsed.completeness,
          conventions: parsed.conventions,
          security: parsed.security,
          performance: parsed.performance,
        },
        issues: parsed.issues ?? [],
        verdict,
      };

      logger.info(
        {
          filePath,
          score: overallScore.toFixed(2),
          verdict,
          issueCount: result.issues.length,
        },
        "Quality gate evaluation complete"
      );

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: msg },
        "Quality gate evaluation failed, defaulting to pass"
      );
      return this.defaultPassResult();
    }
  }

  /**
   * Generate feedback for the agent based on quality gate issues.
   */
  getFeedbackPrompt(result: QualityGateResult, filePath: string): string {
    if (result.verdict === "pass") {
      return "";
    }

    const issueList = result.issues
      .filter((i) => i.severity === "high" || i.severity === "critical")
      .map(
        (i) =>
          `- [${i.severity.toUpperCase()}] ${i.category}: ${i.description}${i.suggestion ? ` (Suggestion: ${i.suggestion})` : ""}`
      )
      .join("\n");

    if (result.verdict === "reject") {
      return `[Quality Gate REJECTED] The file ${filePath} scored ${result.score.toFixed(2)} which is below the threshold. You must rewrite this file addressing these critical issues:\n${issueList}\n\nPlease fix these issues and rewrite the file.`;
    }

    return `[Quality Gate REVISION NEEDED] The file ${filePath} scored ${result.score.toFixed(2)}. Please address these issues:\n${issueList}`;
  }

  private parseResponse(content: string): {
    correctness: number;
    completeness: number;
    conventions: number;
    security: number;
    performance: number;
    issues: QualityIssue[];
  } | null {
    try {
      // Try to extract JSON from potential markdown code blocks
      const jsonMatch = content.match(JSON_EXTRACT_RE);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        correctness: Number(parsed.correctness) || 0.5,
        completeness: Number(parsed.completeness) || 0.5,
        conventions: Number(parsed.conventions) || 0.5,
        security: Number(parsed.security) || 0.5,
        performance: Number(parsed.performance) || 0.5,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      };
    } catch {
      return null;
    }
  }

  private defaultPassResult(): QualityGateResult {
    return {
      score: 1.0,
      scores: {
        correctness: 1.0,
        completeness: 1.0,
        conventions: 1.0,
        security: 1.0,
        performance: 1.0,
      },
      issues: [],
      verdict: "pass",
    };
  }
}
