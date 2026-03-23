import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:discovery");

const CONFIDENCE_SCORE_RE = /CONFIDENCE_SCORE:\s*([\d.]+)/i;
const CONFIDENCE_FALLBACK_RE =
  /confidence[:\s]+(?:is\s+)?(?:approximately\s+)?([\d.]+)/i;
const REQ_HEADER_RE = /REQ-(\d+):\s*(.+?)(?:\n|$)/g;
const REQ_DESCRIPTION_RE =
  /Description:\s*(.+?)(?=\n\s*-|\n\s*Priority|\n\s*Acceptance|$)/is;
const REQ_PRIORITY_RE = /Priority:\s*(critical|high|medium|low)/i;
const REQ_ACCEPTANCE_RE = /Acceptance Criteria:([\s\S]*?)(?=\n\s*REQ-|\n##|$)/i;
const LIST_BULLET_PREFIX_RE = /^\s*[-*]\s*/;

export interface DiscoveryResult {
  clarificationsNeeded: string[];
  confidenceScore: number;
  outOfScope: string[];
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    priority: "critical" | "high" | "medium" | "low";
    acceptanceCriteria: string[];
  }>;
  risks: string[];
  srs: string;
}

/**
 * DiscoveryPhase runs the Discovery agent using the 5-question framework
 * to generate a complete Software Requirements Specification. If the
 * confidence score is below 0.8, it iterates up to 3 times, each time
 * requesting additional clarification from the model.
 */
export class DiscoveryPhase {
  private readonly maxAttempts = 3;
  private readonly confidenceThreshold = 0.8;

  private readonly questions = [
    "WHO are the users? What roles and permissions exist?",
    "WHAT features and functionality are needed?",
    "What is explicitly NOT in scope?",
    "What are the acceptance criteria? How do we know each feature is DONE?",
    "What are the RISKS, constraints, and technical challenges?",
  ];

  async execute(
    agentLoop: AgentLoop,
    initialPrompt: string
  ): Promise<DiscoveryResult> {
    logger.info("Starting Discovery phase");

    let lastResult: DiscoveryResult | null = null;
    let attempt = 0;
    let accumulatedContext = "";

    while (attempt < this.maxAttempts) {
      attempt++;
      logger.info(
        { attempt, maxAttempts: this.maxAttempts },
        "Discovery iteration"
      );

      const prompt = this.buildDiscoveryPrompt(
        initialPrompt,
        lastResult,
        accumulatedContext,
        attempt
      );

      const result = await agentLoop.executeTask(prompt, "discovery");

      // Parse the SRS from the agent output
      const parsed = this.parseSRS(result.output);

      logger.info(
        {
          attempt,
          confidence: parsed.confidenceScore,
          requirementsCount: parsed.requirements.length,
          risksCount: parsed.risks.length,
        },
        "Discovery iteration complete"
      );

      // Check confidence threshold
      if (this.shouldProceed(parsed)) {
        logger.info(
          { confidence: parsed.confidenceScore },
          "Discovery confidence met, proceeding"
        );
        return parsed;
      }

      // Not confident enough, accumulate context for next iteration
      lastResult = parsed;
      if (parsed.clarificationsNeeded.length > 0) {
        accumulatedContext += `\n\nPrevious attempt identified these gaps:\n${parsed.clarificationsNeeded.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
      }

      logger.info(
        {
          confidence: parsed.confidenceScore,
          threshold: this.confidenceThreshold,
          clarifications: parsed.clarificationsNeeded.length,
        },
        "Discovery confidence below threshold, iterating"
      );
    }

    // After max attempts, return the best result we have
    logger.warn(
      {
        attempts: attempt,
        finalConfidence: lastResult?.confidenceScore ?? 0,
      },
      "Discovery reached max attempts, returning best result"
    );

    return (
      lastResult ?? {
        srs: "",
        confidenceScore: 0,
        requirements: [],
        outOfScope: [],
        risks: [],
        clarificationsNeeded: ["Could not generate SRS after max attempts"],
      }
    );
  }

  private buildDiscoveryPrompt(
    initialPrompt: string,
    previousResult: DiscoveryResult | null,
    accumulatedContext: string,
    attempt: number
  ): string {
    let prompt = `Analyze the following project request and generate a complete Software Requirements Specification (SRS).

Use the 5-Question Framework:
${this.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Project Request:
${initialPrompt}`;

    if (previousResult && attempt > 1) {
      prompt += `

--- Previous Analysis (attempt ${attempt - 1}) ---
The previous analysis had a confidence score of ${previousResult.confidenceScore}.
${previousResult.clarificationsNeeded.length > 0 ? `\nGaps identified:\n${previousResult.clarificationsNeeded.map((c) => `- ${c}`).join("\n")}` : ""}

Please address these gaps and improve the SRS. Use your best judgment to fill in missing details based on common patterns and best practices.`;
    }

    if (accumulatedContext) {
      prompt += `\n\nAdditional Context:${accumulatedContext}`;
    }

    prompt += `

IMPORTANT: Your output MUST include these clearly labeled sections:

## CONFIDENCE_SCORE: <number between 0.0 and 1.0>

## REQUIREMENTS
For each requirement:
- REQ-<number>: <title>
  - Description: <description>
  - Priority: <critical|high|medium|low>
  - Acceptance Criteria:
    - <criterion 1>
    - <criterion 2>

## OUT_OF_SCOPE
- <item 1>
- <item 2>

## RISKS
- <risk 1>
- <risk 2>

## CLARIFICATIONS_NEEDED
- <question 1> (leave empty if confidence >= 0.8)

Generate the most complete SRS possible. If you are uncertain about specific details, state your assumptions clearly and assign a confidence score reflecting your certainty.`;

    return prompt;
  }

  /**
   * Parse the agent's output into a structured DiscoveryResult.
   * Uses section headers and regex patterns to extract data.
   */
  private parseSRS(output: string): DiscoveryResult {
    const confidenceScore = this.extractConfidence(output);
    const requirements = this.extractRequirements(output);
    const outOfScope = this.extractListSection(output, "OUT_OF_SCOPE");
    const risks = this.extractListSection(output, "RISKS");
    const clarificationsNeeded = this.extractListSection(
      output,
      "CLARIFICATIONS_NEEDED"
    );

    return {
      srs: output,
      confidenceScore,
      requirements,
      outOfScope,
      risks,
      clarificationsNeeded,
    };
  }

  private extractConfidence(output: string): number {
    // Look for CONFIDENCE_SCORE: X.X pattern
    const match = output.match(CONFIDENCE_SCORE_RE);
    if (match?.[1]) {
      const score = Number.parseFloat(match[1]);
      if (!Number.isNaN(score) && score >= 0 && score <= 1) {
        return score;
      }
    }

    // Fallback: look for "confidence" mentions with numbers
    const fallback = output.match(CONFIDENCE_FALLBACK_RE);
    if (fallback?.[1]) {
      const score = Number.parseFloat(fallback[1]);
      if (!Number.isNaN(score) && score >= 0 && score <= 1) {
        return score;
      }
    }

    // Heuristic: if the output is substantial and has requirements, give it 0.7
    if (output.length > 500 && output.includes("REQ-")) {
      return 0.7;
    }
    if (output.length > 200) {
      return 0.5;
    }
    return 0.3;
  }

  private extractRequirements(output: string): DiscoveryResult["requirements"] {
    const requirements: DiscoveryResult["requirements"] = [];
    // Match REQ-N: Title pattern
    REQ_HEADER_RE.lastIndex = 0;
    let match: RegExpExecArray | null = REQ_HEADER_RE.exec(output);
    let _currentIndex = 0;

    while (match !== null) {
      const id = `REQ-${match[1]}`;
      const title = match[2]?.trim() ?? "";

      // Extract description between this requirement and the next one or section
      const startPos = match.index + match[0].length;
      const nextReq = output.indexOf("REQ-", startPos);
      const nextSection = output.indexOf("## ", startPos);
      const endPos = Math.min(
        nextReq > -1 ? nextReq : output.length,
        nextSection > -1 ? nextSection : output.length
      );
      const block = output.slice(startPos, endPos);

      // Extract description
      const descMatch = block.match(REQ_DESCRIPTION_RE);
      const description = descMatch?.[1]?.trim() ?? title;

      // Extract priority
      const prioMatch = block.match(REQ_PRIORITY_RE);
      const priority = (prioMatch?.[1]?.toLowerCase() ?? "medium") as
        | "critical"
        | "high"
        | "medium"
        | "low";

      // Extract acceptance criteria
      const acSection = block.match(REQ_ACCEPTANCE_RE);
      const acceptanceCriteria: string[] = [];
      if (acSection?.[1]) {
        const lines = acSection[1].split("\n");
        for (const line of lines) {
          const criterion = line.replace(LIST_BULLET_PREFIX_RE, "").trim();
          if (criterion.length > 0) {
            acceptanceCriteria.push(criterion);
          }
        }
      }

      requirements.push({
        id,
        title,
        description,
        priority,
        acceptanceCriteria,
      });
      _currentIndex++;
      match = REQ_HEADER_RE.exec(output);
    }

    return requirements;
  }

  private extractListSection(output: string, sectionName: string): string[] {
    const items: string[] = [];
    const sectionRegex = new RegExp(
      `##\\s*${sectionName}[\\s\\S]*?(?=##|$)`,
      "i"
    );
    const sectionMatch = output.match(sectionRegex);

    if (sectionMatch?.[0]) {
      const lines = sectionMatch[0].split("\n").slice(1); // skip header
      for (const line of lines) {
        const item = line.replace(LIST_BULLET_PREFIX_RE, "").trim();
        if (item.length > 0 && !item.startsWith("##")) {
          items.push(item);
        }
      }
    }

    return items;
  }

  shouldProceed(result: DiscoveryResult): boolean {
    return result.confidenceScore >= this.confidenceThreshold;
  }
}
