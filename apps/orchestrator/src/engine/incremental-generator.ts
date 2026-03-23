/**
 * Incremental Generator — Breaks large generation tasks into small,
 * focused increments and applies them one at a time to minimize risk.
 */

import { createLogger } from "@prometheus/logger";
import { generateId, modelRouterClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:incremental-generator");

const INCREMENT_DESC_RE = /INCREMENT:\s*(.+)/i;
const DEPENDS_RE = /DEPENDS:\s*(.+)/i;
const CODE_BLOCK_RE = /```[\w]*\n([\s\S]*?)```/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Increment {
  changes: string;
  code: string;
  dependencies: string[];
  description: string;
  id: string;
  order: number;
  status: "pending" | "applied" | "validated" | "failed";
}

export interface IncrementPlan {
  estimatedTokens: number;
  id: string;
  increments: Increment[];
  taskDescription: string;
}

export interface IncrementalResult {
  appliedIncrements: number;
  failedIncrements: number;
  finalCode: string;
  planId: string;
  totalIncrements: number;
}

export interface IncrementValidation {
  errors: string[];
  incrementId: string;
  valid: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// IncrementalGenerator
// ---------------------------------------------------------------------------

export class IncrementalGenerator {
  /**
   * Break a task into ordered increments based on existing code.
   */
  async planIncrements(
    task: string,
    existingCode: string
  ): Promise<IncrementPlan> {
    const planId = generateId("inc-plan");
    logger.info({ planId, task }, "Planning increments");

    const prompt = [
      "Break the following task into small, focused code increments.",
      "Each increment should make exactly one logical change.",
      "",
      "## Task",
      task,
      "",
      "## Existing Code",
      "```",
      existingCode,
      "```",
      "",
      "## Output Format",
      "For each increment, output:",
      "INCREMENT: <description>",
      "DEPENDS: <comma-separated increment numbers or 'none'>",
      "---",
    ].join("\n");

    const parsed = await this.callModelForPlan(prompt);

    const increments: Increment[] = parsed.map((item, index) => ({
      id: generateId("inc"),
      order: index,
      description: item.description,
      dependencies: item.dependencies,
      code: "",
      changes: "",
      status: "pending" as const,
    }));

    return {
      id: planId,
      taskDescription: task,
      increments,
      estimatedTokens: increments.length * 2000,
    };
  }

  /**
   * Generate code for a single increment.
   */
  async generateIncrement(
    increment: Increment,
    context: { existingCode: string; priorIncrements: Increment[] }
  ): Promise<Increment> {
    logger.info(
      { incrementId: increment.id, description: increment.description },
      "Generating increment"
    );

    const priorChanges = context.priorIncrements
      .filter((i) => i.status === "validated" || i.status === "applied")
      .map((i) => `// Increment ${i.order}: ${i.description}\n${i.changes}`)
      .join("\n\n");

    const prompt = [
      "Generate a focused code change for the following increment:",
      "",
      `## Increment: ${increment.description}`,
      "",
      "## Current Code",
      "```",
      context.existingCode,
      "```",
      priorChanges
        ? `\n## Prior Changes Applied\n\`\`\`\n${priorChanges}\n\`\`\``
        : "",
      "",
      "## Output",
      "Return ONLY the modified code. Make the minimal change needed.",
    ].join("\n");

    const response = await this.callModelForCode(prompt);

    return {
      ...increment,
      code: response.code,
      changes: response.diff,
      status: "applied",
    };
  }

  /**
   * Validate an increment does not introduce regressions.
   */
  validateIncrement(
    increment: Increment,
    _codebase: string
  ): IncrementValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!increment.code || increment.code.trim().length === 0) {
      errors.push("Increment produced empty code");
    }

    if (increment.code.includes("TODO") || increment.code.includes("FIXME")) {
      warnings.push("Increment contains TODO/FIXME markers");
    }

    if (increment.code.includes("as any")) {
      warnings.push("Increment introduces `as any` type assertion");
    }

    const openBraces = (increment.code.match(/\{/g) ?? []).length;
    const closeBraces = (increment.code.match(/\}/g) ?? []).length;
    if (openBraces !== closeBraces) {
      errors.push(
        `Mismatched braces: ${openBraces} open vs ${closeBraces} close`
      );
    }

    const openParens = (increment.code.match(/\(/g) ?? []).length;
    const closeParens = (increment.code.match(/\)/g) ?? []).length;
    if (openParens !== closeParens) {
      errors.push(
        `Mismatched parentheses: ${openParens} open vs ${closeParens} close`
      );
    }

    return {
      incrementId: increment.id,
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Merge validated increments into a final result.
   */
  mergeIncrements(increments: Increment[]): IncrementalResult {
    const applied = increments.filter(
      (i) => i.status === "validated" || i.status === "applied"
    );
    const failed = increments.filter((i) => i.status === "failed");

    const finalCode = applied.length > 0 ? (applied.at(-1)?.code ?? "") : "";

    logger.info(
      {
        total: increments.length,
        applied: applied.length,
        failed: failed.length,
      },
      "Merged increments"
    );

    return {
      planId: increments[0]?.id ?? "unknown",
      finalCode,
      totalIncrements: increments.length,
      appliedIncrements: applied.length,
      failedIncrements: failed.length,
    };
  }

  // ---- Private helpers ------------------------------------------------------

  private async callModelForPlan(
    prompt: string
  ): Promise<Array<{ dependencies: string[]; description: string }>> {
    try {
      const response = await modelRouterClient.post("/chat/completions", {
        model: "claude-3-5-haiku-latest",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
      });

      const body = response.data as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = body.choices[0]?.message.content ?? "";
      return this.parsePlanResponse(content);
    } catch (error) {
      logger.warn({ error }, "Failed to generate plan");
      return [{ description: "Full implementation", dependencies: [] }];
    }
  }

  private parsePlanResponse(
    content: string
  ): Array<{ dependencies: string[]; description: string }> {
    const blocks = content.split("---").filter((b) => b.trim());
    const results: Array<{ dependencies: string[]; description: string }> = [];

    for (const block of blocks) {
      const descMatch = INCREMENT_DESC_RE.exec(block);
      const depsMatch = DEPENDS_RE.exec(block);

      if (descMatch) {
        const deps =
          depsMatch && depsMatch[1]?.trim().toLowerCase() !== "none"
            ? (depsMatch[1] ?? "").split(",").map((d) => d.trim())
            : [];
        results.push({
          description: (descMatch[1] ?? "").trim(),
          dependencies: deps,
        });
      }
    }

    return results.length > 0
      ? results
      : [{ description: "Full implementation", dependencies: [] }];
  }

  private async callModelForCode(
    prompt: string
  ): Promise<{ code: string; diff: string }> {
    try {
      const response = await modelRouterClient.post("/chat/completions", {
        model: "claude-3-5-haiku-latest",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8192,
      });

      const body = response.data as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = body.choices[0]?.message.content ?? "";
      const codeMatch = CODE_BLOCK_RE.exec(content);
      CODE_BLOCK_RE.lastIndex = 0;
      const code = codeMatch ? (codeMatch[1] ?? "").trim() : content;

      return { code, diff: code };
    } catch (error) {
      logger.warn({ error }, "Failed to generate increment code");
      return { code: "", diff: "" };
    }
  }
}
