import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:ambiguity-resolver");

export interface ClarifyingQuestion {
  context: string;
  impact: "high" | "medium" | "low";
  options: string[];
  question: string;
}

export interface AmbiguityAnalysis {
  assumptions: string[];
  confidence: number;
  interpretation: string;
  isAmbiguous: boolean;
  questions: ClarifyingQuestion[];
}

const CONFIDENCE_RE = /CONFIDENCE:\s*([\d.]+)/i;
const INTERPRETATION_RE = /INTERPRETATION:\s*([\s\S]*?)(?=\nASSUMPTIONS:|$)/i;
const ASSUMPTIONS_SECTION_RE = /ASSUMPTIONS:\s*([\s\S]*?)(?=\nQUESTIONS:|$)/i;
const LIST_ITEM_PREFIX_RE = /^\s*[-*]\s*/;
const QUESTION_BLOCKS_RE = /Q\d+:\s*(.+?)(?=\nQ\d+:|$)/gis;
const QUESTION_LINE_RE = /Q\d+:\s*(.+?)(?=\n)/;
const OPTIONS_RE = /OPTIONS:\s*(.+?)(?=\n)/i;
const CONTEXT_RE = /CONTEXT:\s*(.+?)(?=\n|$)/i;
const IMPACT_RE = /IMPACT:\s*(high|medium|low)/i;

/**
 * AmbiguityResolver detects ambiguous task descriptions and generates
 * 2-3 clarifying questions with structured options. Used in the
 * discovery phase to ensure requirements are clear before proceeding.
 */
export class AmbiguityResolver {
  private readonly eventPublisher = new EventPublisher();

  /**
   * Analyze a task description for ambiguity.
   * Returns structured questions if confidence is below 0.6.
   */
  async analyze(
    agentLoop: AgentLoop,
    taskDescription: string
  ): Promise<AmbiguityAnalysis> {
    logger.info("Analyzing task for ambiguity");

    const prompt = `Analyze this task description for ambiguity. Identify any areas where the requirements are unclear, missing, or could be interpreted multiple ways.

Task Description:
${taskDescription}

Respond in this exact format:

CONFIDENCE: <0.0-1.0 how confident you are in understanding the full requirements>

INTERPRETATION: <your best interpretation of what the user wants>

ASSUMPTIONS:
- <assumption 1>
- <assumption 2>

QUESTIONS:
Q1: <clarifying question>
OPTIONS: <option A> | <option B> | <option C>
CONTEXT: <why this matters>
IMPACT: <high|medium|low>

Q2: <clarifying question>
OPTIONS: <option A> | <option B>
CONTEXT: <why this matters>
IMPACT: <high|medium|low>

Rules:
- Generate 0-3 questions (0 if the task is perfectly clear)
- Each question should have 2-4 options
- Focus on questions that would significantly change the implementation
- Mark impact as "high" if the answer changes architecture, "medium" if it changes features, "low" if cosmetic`;

    const result = await agentLoop.executeTask(prompt, "discovery");
    const analysis = this.parseAnalysis(result.output);

    if (analysis.isAmbiguous && analysis.questions.length > 0) {
      // Publish clarification event
      await this.eventPublisher.publishSessionEvent(agentLoop.getSessionId(), {
        type: QueueEvents.CHECKPOINT,
        data: {
          event: "clarification_needed",
          confidence: analysis.confidence,
          questions: analysis.questions,
          interpretation: analysis.interpretation,
          assumptions: analysis.assumptions,
        },
        timestamp: new Date().toISOString(),
      });
    }

    return analysis;
  }

  private parseAnalysis(output: string): AmbiguityAnalysis {
    const confMatch = output.match(CONFIDENCE_RE);
    const confidence = confMatch
      ? Math.min(1, Math.max(0, Number.parseFloat(confMatch[1] ?? "0.5")))
      : 0.5;

    // Parse interpretation
    const interpMatch = output.match(INTERPRETATION_RE);
    const interpretation = interpMatch?.[1]?.trim() ?? "";

    // Parse assumptions
    const assumptionsSection = output.match(ASSUMPTIONS_SECTION_RE);
    const assumptions: string[] = [];
    if (assumptionsSection?.[1]) {
      for (const line of assumptionsSection[1].split("\n")) {
        const cleaned = line.replace(LIST_ITEM_PREFIX_RE, "").trim();
        if (cleaned.length > 0) {
          assumptions.push(cleaned);
        }
      }
    }

    // Parse questions
    const questions: ClarifyingQuestion[] = [];
    QUESTION_BLOCKS_RE.lastIndex = 0;
    const questionBlocks = output.matchAll(QUESTION_BLOCKS_RE);
    for (const block of questionBlocks) {
      const text = block[0] ?? "";
      const qMatch = text.match(QUESTION_LINE_RE);
      const optMatch = text.match(OPTIONS_RE);
      const ctxMatch = text.match(CONTEXT_RE);
      const impMatch = text.match(IMPACT_RE);

      if (qMatch?.[1]) {
        questions.push({
          question: qMatch[1].trim(),
          options:
            optMatch?.[1]
              ?.split("|")
              .map((o) => o.trim())
              .filter(Boolean) ?? [],
          context: ctxMatch?.[1]?.trim() ?? "",
          impact: (impMatch?.[1]?.toLowerCase() ?? "medium") as
            | "high"
            | "medium"
            | "low",
        });
      }
    }

    return {
      confidence,
      isAmbiguous: confidence < 0.6,
      questions,
      assumptions,
      interpretation,
    };
  }
}
