import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:guardian");

const RULE_BLOCK_SPLIT_RE = /\nRULE:\s*/i;
const BLOCK_NAME_RE = /^(.+?)(?=\n)/;
const DESCRIPTION_RE = /DESCRIPTION:\s*(.+?)(?=\n)/i;
const CONDITION_RE = /CONDITION:\s*(.+?)(?=\n)/i;
const SEVERITY_RE = /SEVERITY:\s*(error|warning)/i;
const CATEGORY_RE = /CATEGORY:\s*(\w+)/i;
const VIOLATION_BLOCK_SPLIT_RE = /\nVIOLATION:\s*/i;
const VIOLATION_DESC_RE = /DESCRIPTION:\s*(.+?)(?=\n|$)/i;
const SUGGESTION_RE = /SUGGESTION:\s*(.+?)(?=\n|$)/i;

export interface DomainRule {
  category: string;
  condition: string;
  description: string;
  id: string;
  name: string;
  severity: "error" | "warning";
}

export interface GuardianViolation {
  description: string;
  filePath: string;
  ruleId: string;
  ruleName: string;
  severity: "error" | "warning";
  suggestion: string;
}

/**
 * BusinessLogicGuardian validates file changes against domain rules
 * extracted from the SRS during discovery. Hooks into the AgentLoop
 * after blueprint enforcement.
 */
export class BusinessLogicGuardian {
  private rules: DomainRule[] = [];

  /**
   * Extract domain rules from SRS content.
   */
  async extractRules(
    agentLoop: AgentLoop,
    srsContent: string
  ): Promise<DomainRule[]> {
    logger.info("Extracting domain rules from SRS");

    const result = await agentLoop.executeTask(
      `Extract business domain rules from this SRS that should be enforced in code.

SRS:
${srsContent}

For each rule, output in this format:
RULE: <rule name>
DESCRIPTION: <what must be true>
CONDITION: <code-level condition to check, e.g. "all API endpoints must validate orgId">
SEVERITY: <error|warning>
CATEGORY: <auth|data|business|validation>

Focus on rules that:
- Enforce data integrity constraints
- Ensure authorization is consistent
- Validate business invariants
- Protect against logical errors`,
      "discovery"
    );

    this.rules = this.parseRules(result.output);
    logger.info({ ruleCount: this.rules.length }, "Domain rules extracted");
    return this.rules;
  }

  /**
   * Validate a file change against domain rules.
   */
  async validateChange(
    agentLoop: AgentLoop,
    filePath: string,
    content: string
  ): Promise<GuardianViolation[]> {
    if (this.rules.length === 0) {
      return [];
    }

    const relevantRules = this.rules.filter((rule) => {
      // Quick relevance check based on file path and rule category
      const path = filePath.toLowerCase();
      if (
        rule.category === "auth" &&
        (path.includes("auth") ||
          path.includes("middleware") ||
          path.includes("router"))
      ) {
        return true;
      }
      if (
        rule.category === "data" &&
        (path.includes("schema") ||
          path.includes("service") ||
          path.includes("query"))
      ) {
        return true;
      }
      if (
        rule.category === "validation" &&
        (path.includes("validator") ||
          path.includes("router") ||
          path.includes("input"))
      ) {
        return true;
      }
      if (rule.category === "business") {
        return true; // Always check business rules
      }
      return false;
    });

    if (relevantRules.length === 0) {
      return [];
    }

    const prompt = `Check this file against these business domain rules.

File: ${filePath}
Content:
\`\`\`
${content.slice(0, 5000)}
\`\`\`

Rules to check:
${relevantRules.map((r) => `- [${r.severity}] ${r.name}: ${r.condition}`).join("\n")}

For each violation found, output:
VIOLATION: <rule name>
DESCRIPTION: <what's wrong>
SUGGESTION: <how to fix>

If no violations, output: NO_VIOLATIONS`;

    const result = await agentLoop.executeTask(prompt, "security_auditor");
    return this.parseViolations(result.output, filePath);
  }

  /**
   * Get all loaded rules.
   */
  getRules(): DomainRule[] {
    return [...this.rules];
  }

  /**
   * Manually add a domain rule.
   */
  addRule(rule: DomainRule): void {
    this.rules.push(rule);
  }

  private parseRules(output: string): DomainRule[] {
    const rules: DomainRule[] = [];
    const blocks = output.split(RULE_BLOCK_SPLIT_RE).slice(1);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] ?? "";
      const nameMatch = block.match(BLOCK_NAME_RE);
      const descMatch = block.match(DESCRIPTION_RE);
      const condMatch = block.match(CONDITION_RE);
      const sevMatch = block.match(SEVERITY_RE);
      const catMatch = block.match(CATEGORY_RE);

      if (nameMatch?.[1]) {
        rules.push({
          id: `rule_${i + 1}`,
          name: nameMatch[1].trim(),
          description: descMatch?.[1]?.trim() ?? "",
          condition: condMatch?.[1]?.trim() ?? "",
          severity: (sevMatch?.[1]?.toLowerCase() ?? "warning") as
            | "error"
            | "warning",
          category: catMatch?.[1]?.toLowerCase() ?? "business",
        });
      }
    }

    return rules;
  }

  private parseViolations(
    output: string,
    filePath: string
  ): GuardianViolation[] {
    if (output.includes("NO_VIOLATIONS")) {
      return [];
    }

    const violations: GuardianViolation[] = [];
    const blocks = output.split(VIOLATION_BLOCK_SPLIT_RE).slice(1);

    for (const block of blocks) {
      const nameMatch = block.match(BLOCK_NAME_RE);
      const descMatch = block.match(VIOLATION_DESC_RE);
      const sugMatch = block.match(SUGGESTION_RE);

      if (nameMatch?.[1]) {
        const ruleName = nameMatch[1].trim();
        const rule = this.rules.find((r) => r.name === ruleName);

        violations.push({
          ruleId: rule?.id ?? "unknown",
          ruleName,
          description: descMatch?.[1]?.trim() ?? "",
          severity: rule?.severity ?? "warning",
          filePath,
          suggestion: sugMatch?.[1]?.trim() ?? "",
        });
      }
    }

    return violations;
  }
}
