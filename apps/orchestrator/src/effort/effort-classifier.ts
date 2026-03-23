/**
 * Effort Classifier — Categorizes task complexity into effort levels
 * that control model selection, token budgets, and iteration limits.
 *
 * Levels:
 * - trivial: 1-line fix, typo correction
 * - simple: Single file change, well-defined scope
 * - medium: Multi-file, moderate complexity
 * - complex: Architectural changes, multi-service
 * - critical: Breaking changes, security-critical, data migrations
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:effort");

export type EffortLevel =
  | "trivial"
  | "simple"
  | "medium"
  | "complex"
  | "critical";

export interface EffortClassification {
  estimatedFiles: number;
  estimatedIterations: number;
  level: EffortLevel;
  maxTokenBudget: number;
  reasoning: string;
  recommendedSlot: string;
  temperature: number;
}

const EFFORT_CONFIGS: Record<
  EffortLevel,
  Omit<EffortClassification, "reasoning" | "level">
> = {
  trivial: {
    recommendedSlot: "fastLoop",
    temperature: 0.1,
    maxTokenBudget: 2000,
    estimatedIterations: 5,
    estimatedFiles: 1,
  },
  simple: {
    recommendedSlot: "default",
    temperature: 0.2,
    maxTokenBudget: 8000,
    estimatedIterations: 10,
    estimatedFiles: 3,
  },
  medium: {
    recommendedSlot: "default",
    temperature: 0.3,
    maxTokenBudget: 16_000,
    estimatedIterations: 25,
    estimatedFiles: 8,
  },
  complex: {
    recommendedSlot: "think",
    temperature: 0.4,
    maxTokenBudget: 32_000,
    estimatedIterations: 40,
    estimatedFiles: 15,
  },
  critical: {
    recommendedSlot: "premium",
    temperature: 0.2,
    maxTokenBudget: 50_000,
    estimatedIterations: 50,
    estimatedFiles: 25,
  },
};

const TRIVIAL_PATTERNS = [
  /\b(typo|rename|fix\s+(?:a\s+)?(?:typo|spelling|name))\b/i,
  /\b(bump\s+version|update\s+(?:version|dep))\b/i,
  /\b(change\s+(?:color|text|label|title|string))\b/i,
];

const SIMPLE_PATTERNS = [
  /\b(add\s+(?:a\s+)?(?:field|column|prop|parameter|import|export))\b/i,
  /\b(fix\s+(?:a\s+)?(?:bug|error|issue|warning))\b/i,
  /\b(update\s+(?:a\s+)?(?:function|method|handler|component))\b/i,
];

const COMPLEX_PATTERNS = [
  /\b(refactor|restructure|redesign|rewrite|overhaul)\b/i,
  /\b(implement\s+(?:new\s+)?(?:feature|system|service|module|pipeline))\b/i,
  /\b(multi[- ]?(?:service|file|step|phase))\b/i,
  /\b(architect|blueprint|infrastructure)\b/i,
];

const CRITICAL_PATTERNS = [
  /\b(migration|schema\s+change|breaking\s+change)\b/i,
  /\b(security|authentication|authorization|encryption)\b/i,
  /\b(data\s+(?:loss|corruption|migration))\b/i,
  /\b(production|deployment|rollback)\b/i,
];

const WHITESPACE_PATTERN = /\s+/;

export function classifyEffort(taskDescription: string): EffortClassification {
  const desc = taskDescription.toLowerCase();
  const wordCount = desc.split(WHITESPACE_PATTERN).length;

  let level: EffortLevel;
  let reasoning: string;

  if (CRITICAL_PATTERNS.some((p) => p.test(desc))) {
    level = "critical";
    reasoning = "Task involves security-critical or breaking changes";
  } else if (COMPLEX_PATTERNS.some((p) => p.test(desc))) {
    level = "complex";
    reasoning = "Task requires architectural or multi-service changes";
  } else if (TRIVIAL_PATTERNS.some((p) => p.test(desc))) {
    level = "trivial";
    reasoning = "Task is a simple text/config change";
  } else if (SIMPLE_PATTERNS.some((p) => p.test(desc))) {
    level = "simple";
    reasoning = "Task involves a focused, single-file change";
  } else if (wordCount > 100) {
    level = "complex";
    reasoning = "Long task description suggests complex requirements";
  } else if (wordCount > 30) {
    level = "medium";
    reasoning = "Moderate description length suggests medium complexity";
  } else {
    level = "medium";
    reasoning = "Default classification for ambiguous tasks";
  }

  const config = EFFORT_CONFIGS[level];
  logger.info({ level, reasoning, wordCount }, "Task effort classified");

  return { level, reasoning, ...config };
}

export function getEffortConfig(
  level: EffortLevel
): Omit<EffortClassification, "reasoning" | "level"> {
  return EFFORT_CONFIGS[level];
}
