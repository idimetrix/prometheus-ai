/**
 * Project Context Loader — GAP-119
 *
 * Scans a project's repository root for context instruction files
 * (PROMETHEUS.md, CLAUDE.md, AGENTS.md, .cursorrules, .github/copilot-instructions.md),
 * parses them, merges with DB-stored project rules, and returns a unified
 * context string for system prompt injection.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:project-context-loader");

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ContextFileInfo {
  /** Raw content of the file */
  content: string;
  /** File name (e.g. "PROMETHEUS.md") */
  fileName: string;
  /** Absolute path of the detected file */
  filePath: string;
  /** Priority rank (lower = higher priority) */
  priority: number;
}

export interface ParsedProjectContext {
  /** All detected context files in priority order */
  detectedFiles: ContextFileInfo[];
  /** Merged plain-text context string ready for prompt injection */
  mergedContext: string;
  /** Rules extracted from context files, grouped by type */
  rules: Record<string, string[]>;
}

export interface DbProjectRule {
  enabled: boolean;
  rule: string;
  source: string;
  type: string;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Context files to scan, in priority order.
 * The first file found takes the highest precedence.
 */
const CONTEXT_FILE_CANDIDATES = [
  { fileName: "PROMETHEUS.md", relativePath: "PROMETHEUS.md", priority: 1 },
  { fileName: "CLAUDE.md", relativePath: "CLAUDE.md", priority: 2 },
  { fileName: "AGENTS.md", relativePath: "AGENTS.md", priority: 3 },
  { fileName: ".cursorrules", relativePath: ".cursorrules", priority: 4 },
  {
    fileName: "copilot-instructions.md",
    relativePath: ".github/copilot-instructions.md",
    priority: 5,
  },
] as const;

/* -------------------------------------------------------------------------- */
/*  Markdown Parser (inlined from @prometheus/cli/prometheus-md)                */
/* -------------------------------------------------------------------------- */

const SECTION_TYPE_MAP: Record<string, string> = {
  "code style": "code_style",
  "coding style": "code_style",
  style: "code_style",
  formatting: "code_style",
  lint: "code_style",
  linting: "code_style",
  architecture: "architecture",
  "project structure": "architecture",
  structure: "architecture",
  patterns: "architecture",
  "design patterns": "architecture",
  dependencies: "architecture",
  testing: "testing",
  tests: "testing",
  "test guidelines": "testing",
  "test patterns": "testing",
  coverage: "testing",
  review: "review",
  "code review": "review",
  security: "security",
  forbidden: "security",
  "do not": "security",
  secrets: "security",
  permissions: "security",
  auth: "security",
  prompt: "prompt",
  instructions: "prompt",
  general: "prompt",
  rules: "prompt",
  "project rules": "prompt",
  custom: "prompt",
  "custom instructions": "prompt",
  conventions: "prompt",
  guidelines: "prompt",
};

const HEADING_REGEX = /^#{1,3}\s+(.+)$/;
const LIST_ITEM_REGEX = /^[-*]\s+(.+)$/;

function resolveType(heading: string): string {
  const lower = heading.toLowerCase().trim();
  for (const [key, value] of Object.entries(SECTION_TYPE_MAP)) {
    if (lower.includes(key)) {
      return value;
    }
  }
  return "prompt";
}

/**
 * Parse a markdown context file into structured rules.
 */
function parseContextMarkdown(
  content: string
): Array<{ type: string; rule: string }> {
  const rules: Array<{ type: string; rule: string }> = [];
  const lines = content.split("\n");

  let currentType = "prompt";
  let currentRuleLines: string[] = [];

  const flushRule = (): void => {
    const text = currentRuleLines.join("\n").trim();
    if (text) {
      rules.push({ type: currentType, rule: text });
    }
    currentRuleLines = [];
  };

  for (const line of lines) {
    const headingMatch = HEADING_REGEX.exec(line);
    if (headingMatch) {
      flushRule();
      currentType = resolveType(headingMatch[1] ?? "");
      continue;
    }

    const listMatch = LIST_ITEM_REGEX.exec(line);
    if (listMatch) {
      if (currentRuleLines.length > 0) {
        flushRule();
      }
      rules.push({ type: currentType, rule: (listMatch[1] ?? "").trim() });
      continue;
    }

    if (line.trim()) {
      currentRuleLines.push(line.trim());
    } else if (currentRuleLines.length > 0) {
      flushRule();
    }
  }

  flushRule();
  return rules;
}

/* -------------------------------------------------------------------------- */
/*  Core Functions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Detect all context files present in a project root directory.
 * Returns them sorted by priority (highest first).
 */
export function detectContextFiles(projectRoot: string): ContextFileInfo[] {
  const detected: ContextFileInfo[] = [];

  for (const candidate of CONTEXT_FILE_CANDIDATES) {
    const fullPath = join(projectRoot, candidate.relativePath);
    try {
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, "utf-8");
        detected.push({
          filePath: fullPath,
          fileName: candidate.fileName,
          priority: candidate.priority,
          content,
        });
        logger.debug(
          { file: candidate.fileName, path: fullPath },
          "Detected context file"
        );
      }
    } catch {
      // File unreadable — skip silently
      logger.debug(
        { file: candidate.fileName, path: fullPath },
        "Context file unreadable, skipping"
      );
    }
  }

  return detected;
}

/**
 * Parse a single context file into categorized rules using the
 * existing prometheus-md parser. For non-markdown files (.cursorrules),
 * the entire content is treated as a "prompt" rule.
 */
function parseContextFile(
  fileInfo: ContextFileInfo
): Array<{ type: string; rule: string }> {
  const isMarkdown =
    fileInfo.fileName.endsWith(".md") || fileInfo.fileName === "AGENTS.md";

  if (isMarkdown) {
    return parseContextMarkdown(fileInfo.content);
  }

  // .cursorrules and other plain text files: treat as a single prompt rule
  const trimmed = fileInfo.content.trim();
  if (trimmed) {
    return [{ type: "prompt", rule: trimmed }];
  }
  return [];
}

/**
 * Group rules by type, deduplicating identical rule text.
 */
function groupRulesByType(
  rules: Array<{ type: string; rule: string }>
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  const seen = new Set<string>();

  for (const { type, rule } of rules) {
    const key = `${type}::${rule}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type].push(rule);
  }

  return grouped;
}

/**
 * Load and merge project context from filesystem context files
 * and database-stored project rules.
 *
 * @param projectRoot - Absolute path to the project's working directory
 * @param dbRules - Rules stored in the project_rules DB table (optional)
 * @returns Parsed and merged project context
 */
export function loadProjectContext(
  projectRoot: string,
  dbRules: DbProjectRule[] = []
): ParsedProjectContext {
  // 1. Detect and parse context files
  const detectedFiles = detectContextFiles(projectRoot);

  const allRules: Array<{ type: string; rule: string }> = [];

  // Parse context files in priority order (highest priority first)
  for (const fileInfo of detectedFiles) {
    const parsed = parseContextFile(fileInfo);
    allRules.push(...parsed);
  }

  // 2. Merge with DB rules (enabled only)
  for (const dbRule of dbRules) {
    if (dbRule.enabled) {
      allRules.push({ type: dbRule.type, rule: dbRule.rule });
    }
  }

  // 3. Group by type
  const rules = groupRulesByType(allRules);

  // 4. Build merged context string
  const mergedContext = buildMergedContextString(rules);

  logger.info(
    {
      detectedFileCount: detectedFiles.length,
      detectedFiles: detectedFiles.map((f) => f.fileName),
      dbRuleCount: dbRules.filter((r) => r.enabled).length,
      totalRuleCount: allRules.length,
    },
    "Project context loaded"
  );

  return { detectedFiles, rules, mergedContext };
}

/**
 * Build a formatted context string from grouped rules.
 */
function buildMergedContextString(rules: Record<string, string[]>): string {
  const sections: string[] = [];

  const sectionOrder: Array<{ key: string; heading: string }> = [
    { key: "prompt", heading: "Project Rules" },
    { key: "code_style", heading: "Coding Conventions" },
    { key: "architecture", heading: "Architecture Notes" },
    { key: "testing", heading: "Testing Requirements" },
    { key: "security", heading: "Security Guidelines" },
    { key: "review", heading: "Code Review Standards" },
  ];

  for (const { key, heading } of sectionOrder) {
    const entries = rules[key];
    if (entries && entries.length > 0) {
      const body = entries.map((r) => `- ${r}`).join("\n");
      sections.push(`## ${heading}\n${body}`);
    }
  }

  // Include any remaining types not in the predefined order
  const knownKeys = new Set(sectionOrder.map((s) => s.key));
  for (const [key, entries] of Object.entries(rules)) {
    if (knownKeys.has(key) || entries.length === 0) {
      continue;
    }
    const heading =
      key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
    const body = entries.map((r) => `- ${r}`).join("\n");
    sections.push(`## ${heading}\n${body}`);
  }

  if (sections.length === 0) {
    return "";
  }

  return sections.join("\n\n");
}
