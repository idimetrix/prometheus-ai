/**
 * Codebase Q&A — Natural language question answering about a codebase.
 *
 * Supports questions like "Where is X defined?", "How does Y work?",
 * "What calls Z?" by searching and assembling relevant context.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:codebase-qa");

const PUNCTUATION_RE = /[?.,!]/g;
const WHITESPACE_SPLIT_RE = /\s+/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QAResult {
  answer: string;
  confidence: number;
  question: string;
  sources: QASource[];
}

export interface QASource {
  filePath: string;
  relevance: number;
  snippet: string;
}

export interface CodeContext {
  filePath: string;
  matchType: "definition" | "usage" | "reference" | "semantic";
  snippet: string;
}

export type QuestionType =
  | "definition"
  | "explanation"
  | "usage"
  | "dependency"
  | "general";

// ---------------------------------------------------------------------------
// CodebaseQA
// ---------------------------------------------------------------------------

export class CodebaseQA {
  private readonly projectBrainUrl: string;

  constructor() {
    this.projectBrainUrl =
      process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
  }

  /**
   * Answer a natural language question about the codebase.
   */
  async ask(question: string, projectId: string): Promise<QAResult> {
    logger.info({ question, projectId }, "Processing codebase question");

    const questionType = this.classifyQuestion(question);
    const relevantCode = await this.findRelevantCode(
      question,
      projectId,
      questionType
    );
    const answer = this.generateAnswer(question, relevantCode, questionType);

    return {
      question,
      answer: answer.text,
      confidence: answer.confidence,
      sources: relevantCode.map((ctx) => ({
        filePath: ctx.filePath,
        snippet: ctx.snippet,
        relevance: 0.8,
      })),
    };
  }

  /**
   * Find code relevant to answering a question.
   */
  async findRelevantCode(
    question: string,
    projectId: string,
    questionType?: QuestionType
  ): Promise<CodeContext[]> {
    const type = questionType ?? this.classifyQuestion(question);
    const searchTerms = this.extractSearchTerms(question);
    const contexts: CodeContext[] = [];

    logger.debug(
      { searchTerms, questionType: type },
      "Searching for relevant code"
    );

    // Search via semantic search endpoint
    try {
      const response = await fetch(`${this.projectBrainUrl}/search/semantic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          query: question,
          limit: 10,
        }),
      });

      if (response.ok) {
        const body = (await response.json()) as {
          results: Array<{
            content: string;
            filePath: string;
            score: number;
          }>;
        };

        for (const result of body.results) {
          contexts.push({
            filePath: result.filePath,
            snippet: result.content.slice(0, 500),
            matchType: this.inferMatchType(type),
          });
        }
      }
    } catch (error) {
      logger.warn({ error }, "Semantic search failed — using term search");
    }

    // Search via symbol store for definition questions
    if (type === "definition" && searchTerms.length > 0) {
      try {
        const response = await fetch(`${this.projectBrainUrl}/symbols/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            query: searchTerms[0],
          }),
        });

        if (response.ok) {
          const body = (await response.json()) as {
            results: Array<{
              filePath: string;
              name: string;
              snippet?: string;
            }>;
          };

          for (const result of body.results) {
            contexts.push({
              filePath: result.filePath,
              snippet:
                result.snippet ??
                `Symbol: ${result.name} in ${result.filePath}`,
              matchType: "definition",
            });
          }
        }
      } catch (error) {
        logger.warn({ error }, "Symbol search failed");
      }
    }

    // Deduplicate by file path
    const seen = new Set<string>();
    return contexts.filter((ctx) => {
      if (seen.has(ctx.filePath)) {
        return false;
      }
      seen.add(ctx.filePath);
      return true;
    });
  }

  /**
   * Generate an answer from question and context.
   */
  generateAnswer(
    question: string,
    context: CodeContext[],
    questionType?: QuestionType
  ): { confidence: number; text: string } {
    const type = questionType ?? this.classifyQuestion(question);

    if (context.length === 0) {
      return {
        text: "I could not find relevant code to answer this question. Try rephrasing or providing more specific terms.",
        confidence: 0.1,
      };
    }

    const searchTerms = this.extractSearchTerms(question);
    const primarySource = context[0];

    switch (type) {
      case "definition":
        return {
          text: this.formatDefinitionAnswer(searchTerms, context),
          confidence: context.length > 0 ? 0.85 : 0.3,
        };

      case "explanation":
        return {
          text: this.formatExplanationAnswer(searchTerms, context),
          confidence: context.length >= 2 ? 0.75 : 0.5,
        };

      case "usage":
        return {
          text: this.formatUsageAnswer(searchTerms, context),
          confidence: context.length >= 2 ? 0.8 : 0.4,
        };

      case "dependency":
        return {
          text: this.formatDependencyAnswer(searchTerms, context),
          confidence: context.length > 0 ? 0.7 : 0.3,
        };

      default:
        return {
          text: `Based on the codebase, here is what I found:\n\n${primarySource?.snippet ?? ""}\n\nSource: \`${primarySource?.filePath ?? "unknown"}\``,
          confidence: 0.5,
        };
    }
  }

  // ---- Private helpers ------------------------------------------------------

  private classifyQuestion(question: string): QuestionType {
    const lower = question.toLowerCase();

    if (
      lower.includes("where is") ||
      lower.includes("defined") ||
      lower.includes("find the") ||
      lower.includes("locate")
    ) {
      return "definition";
    }

    if (
      lower.includes("how does") ||
      lower.includes("how is") ||
      lower.includes("explain") ||
      lower.includes("what does")
    ) {
      return "explanation";
    }

    if (
      lower.includes("what calls") ||
      lower.includes("who uses") ||
      lower.includes("usage") ||
      lower.includes("used by")
    ) {
      return "usage";
    }

    if (
      lower.includes("depend") ||
      lower.includes("import") ||
      lower.includes("require")
    ) {
      return "dependency";
    }

    return "general";
  }

  private extractSearchTerms(question: string): string[] {
    // Remove common stop words and extract meaningful terms
    const stopWords = new Set([
      "where",
      "is",
      "the",
      "how",
      "does",
      "what",
      "calls",
      "who",
      "uses",
      "a",
      "an",
      "in",
      "of",
      "to",
      "for",
      "and",
      "or",
      "defined",
      "find",
      "locate",
      "explain",
      "work",
      "works",
    ]);

    return question
      .replace(PUNCTUATION_RE, "")
      .split(WHITESPACE_SPLIT_RE)
      .filter((word) => !stopWords.has(word.toLowerCase()) && word.length > 1)
      .slice(0, 5);
  }

  private inferMatchType(questionType: QuestionType): CodeContext["matchType"] {
    switch (questionType) {
      case "definition":
        return "definition";
      case "usage":
        return "usage";
      case "dependency":
        return "reference";
      default:
        return "semantic";
    }
  }

  private formatDefinitionAnswer(
    terms: string[],
    context: CodeContext[]
  ): string {
    const target = terms.join(" ");
    const definitions = context.filter((c) => c.matchType === "definition");
    const primary = definitions.length > 0 ? definitions[0] : context[0];

    const lines: string[] = [];
    lines.push(
      `**${target}** is defined in \`${primary?.filePath ?? "unknown"}\`:`
    );
    lines.push("");
    lines.push("```");
    lines.push(primary?.snippet ?? "");
    lines.push("```");

    if (context.length > 1) {
      lines.push("");
      lines.push("Also referenced in:");
      for (const ctx of context.slice(1, 4)) {
        lines.push(`- \`${ctx.filePath}\``);
      }
    }

    return lines.join("\n");
  }

  private formatExplanationAnswer(
    terms: string[],
    context: CodeContext[]
  ): string {
    const target = terms.join(" ");
    const lines: string[] = [];
    lines.push(`Here is how **${target}** works:`);
    lines.push("");

    for (const ctx of context.slice(0, 3)) {
      lines.push(`### \`${ctx.filePath}\``);
      lines.push("```");
      lines.push(ctx.snippet);
      lines.push("```");
      lines.push("");
    }

    return lines.join("\n");
  }

  private formatUsageAnswer(terms: string[], context: CodeContext[]): string {
    const target = terms.join(" ");
    const lines: string[] = [];
    lines.push(`**${target}** is used in the following locations:`);
    lines.push("");

    for (const ctx of context) {
      lines.push(`- \`${ctx.filePath}\`: ${ctx.snippet.slice(0, 100)}`);
    }

    return lines.join("\n");
  }

  private formatDependencyAnswer(
    terms: string[],
    context: CodeContext[]
  ): string {
    const target = terms.join(" ");
    const lines: string[] = [];
    lines.push(`Dependencies related to **${target}**:`);
    lines.push("");

    for (const ctx of context) {
      lines.push(`- \`${ctx.filePath}\` (${ctx.matchType})`);
    }

    return lines.join("\n");
  }
}
