import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import type { FailureAnalysis } from "./failure-analyzer";

const logger = createLogger("orchestrator:ci-loop:five-why");

const ROOT_CAUSE_RE = /ROOT_CAUSE:\s*(.+?)(?=\n|$)/i;
const SUGGESTED_FIX_RE =
  /SUGGESTED_FIX:\s*([\s\S]*?)(?=\nAFFECTED_FILES|CONFIDENCE|$)/i;
const AFFECTED_FILES_RE = /AFFECTED_FILES:\s*(.+?)(?=\n|$)/i;
const CONFIDENCE_VALUE_RE = /CONFIDENCE:\s*([\d.]+)/i;

export interface RootCauseAnalysis {
  affectedFiles: string[];
  confidence: number;
  failure: string;
  rootCause: string;
  suggestedFix: string;
  whyChain: string[];
}

/**
 * FiveWhyDebugger performs root cause analysis on persistent test failures
 * using the 5-Why technique. Triggered after 2+ failed fix attempts.
 */
export class FiveWhyDebugger {
  async analyze(
    agentLoop: AgentLoop,
    failure: FailureAnalysis,
    previousAttempts: string[]
  ): Promise<RootCauseAnalysis> {
    logger.info(
      { testName: failure.testName, attempts: previousAttempts.length },
      "Starting 5-Why root cause analysis"
    );

    const prompt = `Perform a 5-Why root cause analysis on this persistent test failure.

## Test Failure
- Test: ${failure.testName}
- Type: ${failure.failureType}
- Severity: ${failure.severity}
- Error: ${failure.rootCause}
- Affected Files: ${failure.affectedFiles.join(", ")}

## Previous Fix Attempts (all failed)
${previousAttempts.map((a, i) => `Attempt ${i + 1}: ${a}`).join("\n")}

## Instructions
Apply the 5-Why technique:
1. Why did the test fail? → Because X
2. Why did X happen? → Because Y
3. Why did Y happen? → Because Z
4. Why did Z happen? → Because W
5. Why did W happen? → Because [ROOT CAUSE]

After identifying the root cause, suggest a fix that addresses it directly,
not just the symptoms. Read the affected files to understand the code.

Format your response as:
WHY_1: <first why>
WHY_2: <second why>
WHY_3: <third why>
WHY_4: <fourth why>
WHY_5: <fifth why / root cause>
ROOT_CAUSE: <one-line root cause>
SUGGESTED_FIX: <specific fix description>
AFFECTED_FILES: <comma-separated file paths>
CONFIDENCE: <0.0-1.0>`;

    const result = await agentLoop.executeTask(prompt, "ci_loop");

    return this.parseAnalysis(result.output, failure);
  }

  private parseAnalysis(
    output: string,
    failure: FailureAnalysis
  ): RootCauseAnalysis {
    const whyChain: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const match = output.match(
        new RegExp(`WHY_${i}:\\s*(.+?)(?=\\nWHY_|\\nROOT_CAUSE|$)`, "is")
      );
      if (match?.[1]) {
        whyChain.push(match[1].trim());
      }
    }

    const rootCauseMatch = output.match(ROOT_CAUSE_RE);
    const fixMatch = output.match(SUGGESTED_FIX_RE);
    const filesMatch = output.match(AFFECTED_FILES_RE);
    const confMatch = output.match(CONFIDENCE_VALUE_RE);

    return {
      failure: failure.testName,
      whyChain,
      rootCause: rootCauseMatch?.[1]?.trim() ?? "Unknown root cause",
      suggestedFix: fixMatch?.[1]?.trim() ?? failure.suggestedFix,
      confidence: confMatch ? Number.parseFloat(confMatch[1] ?? "0.5") : 0.5,
      affectedFiles: filesMatch
        ? (filesMatch[1]
            ?.split(",")
            .map((f) => f.trim())
            .filter(Boolean) ?? failure.affectedFiles)
        : failure.affectedFiles,
    };
  }
}
