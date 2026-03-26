import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface ParsedRule {
  rule: string;
  type: string;
}

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

/**
 * Resolve the section type from a markdown heading.
 */
function resolveType(heading: string): string {
  const lower = heading.toLowerCase().trim();
  for (const [key, value] of Object.entries(SECTION_TYPE_MAP)) {
    if (lower.includes(key)) {
      return value;
    }
  }
  return "prompt";
}

const HEADING_REGEX = /^#{1,3}\s+(.+)$/;
const LIST_ITEM_REGEX = /^[-*]\s+(.+)$/;

/**
 * Parse a .prometheus.md or .prometheus/rules.md file into structured rules.
 */
export function parsePrometheusMarkdown(content: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
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
    // Detect section headings (## or #)
    const headingMatch = HEADING_REGEX.exec(line);
    if (headingMatch) {
      flushRule();
      currentType = resolveType(headingMatch[1] ?? "");
      continue;
    }

    // Detect list items as individual rules
    const listMatch = LIST_ITEM_REGEX.exec(line);
    if (listMatch) {
      // Each list item is a separate rule
      if (currentRuleLines.length > 0) {
        flushRule();
      }
      rules.push({ type: currentType, rule: (listMatch[1] ?? "").trim() });
      continue;
    }

    // Accumulate non-empty lines as paragraph rules
    if (line.trim()) {
      currentRuleLines.push(line.trim());
    } else if (currentRuleLines.length > 0) {
      flushRule();
    }
  }

  flushRule();
  return rules;
}

/**
 * Parse .prometheus.md rules from a project directory.
 * Checks: .prometheus.md, .prometheus/rules.md
 */
export function parsePrometheusRules(directory: string): ParsedRule[] {
  const paths = [
    join(directory, ".prometheus.md"),
    join(directory, ".prometheus", "rules.md"),
  ];

  for (const filePath of paths) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        return parsePrometheusMarkdown(content);
      } catch {
        // Skip unreadable files
      }
    }
  }

  return [];
}

/**
 * Template for a new .prometheus.md file.
 */
export const PROMETHEUS_MD_TEMPLATE = `# Project Rules

## Code Style
- Follow the project's existing code style
- Use TypeScript strict mode where applicable

## Architecture
- Keep components focused and single-responsibility
- Prefer composition over inheritance

## Testing
- Every new function should have a corresponding test
- Test edge cases and error paths

## Security
- Never commit secrets or API keys
- Validate all user input
- Use parameterized queries for database access

## Forbidden
- No console.log in production code
- No any types without justification
`;

export type { ParsedRule };
