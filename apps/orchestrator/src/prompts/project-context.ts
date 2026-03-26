/**
 * Loads project-specific context (.prometheus.md rules and DB project rules)
 * and formats them for injection into agent system prompts.
 */

import { db, projectRules } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq } from "drizzle-orm";

const logger = createLogger("project-context");

interface ProjectRuleRow {
  enabled: boolean;
  id: string;
  rule: string;
  source: string;
  type: string;
}

const SECTION_LABELS: Record<string, string> = {
  code_style: "Code Style",
  architecture: "Architecture",
  testing: "Testing",
  review: "Code Review",
  prompt: "Instructions",
  security: "Security",
};

/**
 * Fetches project rules from the database, groups them by type,
 * and formats them as system prompt instructions.
 */
export async function loadProjectContext(projectId: string): Promise<string> {
  try {
    const rules = await fetchProjectRules(projectId);
    if (rules.length === 0) {
      return "";
    }

    return formatRulesAsPrompt(rules);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(
      { projectId, error: msg },
      "Failed to load project context rules"
    );
    return "";
  }
}

/**
 * Fetch enabled project rules from the database.
 */
async function fetchProjectRules(projectId: string): Promise<ProjectRuleRow[]> {
  const rows = await db.query.projectRules.findMany({
    where: and(
      eq(projectRules.projectId, projectId),
      eq(projectRules.enabled, true)
    ),
    orderBy: (table, { asc }) => [asc(table.type)],
  });

  return rows;
}

/**
 * Formats a list of rules into a system prompt block grouped by type.
 */
function formatRulesAsPrompt(rules: ProjectRuleRow[]): string {
  const grouped = new Map<string, string[]>();

  for (const rule of rules) {
    const existing = grouped.get(rule.type) ?? [];
    existing.push(rule.rule);
    grouped.set(rule.type, existing);
  }

  const sections: string[] = [];

  for (const [type, ruleTexts] of grouped) {
    const label = SECTION_LABELS[type] ?? type;
    const items = ruleTexts.map((r) => `- ${r}`).join("\n");
    sections.push(`### ${label}\n${items}`);
  }

  return `\n## Project Rules (.prometheus.md)\n\nThe following rules are configured for this project. You MUST follow them.\n\n${sections.join("\n\n")}\n`;
}
