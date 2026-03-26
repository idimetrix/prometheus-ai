import { ROLE_PROMPTS } from "./role-prompts";

/**
 * Configuration for building a complete agent system prompt.
 */
export interface PromptBuilderConfig {
  /** Blueprint summary text (from architect output). */
  blueprint?: string;
  /** Context from the Project Brain (file summaries, dependency graph, etc.). */
  brainContext?: string;
  /** Project-specific conventions from .prometheus.md or similar config. */
  conventions?: string;
  /** Maximum token budget for the system prompt. Defaults to 8000. */
  maxTokens?: number;
  /** The agent role (e.g., "backend-coder", "frontend-coder", "discovery"). */
  role: string;
  /** Additional task-specific instructions to append. */
  taskInstructions?: string;
}

/**
 * Result of building a prompt, including metadata about truncation.
 */
export interface BuiltPrompt {
  /** Approximate token count (estimated at 4 chars per token). */
  estimatedTokens: number;
  /** The assembled system prompt string. */
  prompt: string;
  /** Sections that were included in the prompt. */
  sections: string[];
  /** Whether any section was truncated to fit within the token budget. */
  truncated: boolean;
}

const CHARS_PER_TOKEN = 4;

/**
 * Estimate the token count for a string using a simple character-based heuristic.
 * This is intentionally conservative (overestimates) to avoid exceeding limits.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate text to fit within a character budget, respecting line boundaries.
 * Appends a truncation notice when text is cut.
 */
function truncateToCharBudget(text: string, charBudget: number): string {
  if (text.length <= charBudget) {
    return text;
  }

  const lines = text.split("\n");
  let accumulated = 0;
  const kept: string[] = [];

  for (const line of lines) {
    if (accumulated + line.length + 1 > charBudget - 80) {
      break;
    }
    kept.push(line);
    accumulated += line.length + 1;
  }

  kept.push("\n[... truncated to fit token budget ...]");
  return kept.join("\n");
}

/**
 * Internal state for the prompt assembly process.
 */
interface AssemblyState {
  assembled: string;
  remainingChars: number;
  sections: string[];
  truncated: boolean;
}

/**
 * Attempt to append a context section to the assembled prompt.
 * Handles truncation and duplicate-header detection.
 */
function appendSection(
  state: AssemblyState,
  sectionName: string,
  headerMarker: string,
  content: string
): void {
  if (state.remainingChars <= 200) {
    return;
  }
  if (state.assembled.includes(headerMarker)) {
    return;
  }

  const block = `\n\n${headerMarker}\n${content}`;
  if (block.length <= state.remainingChars) {
    state.assembled += block;
    state.remainingChars -= block.length;
    state.sections.push(sectionName);
    return;
  }

  const truncated = truncateToCharBudget(block, state.remainingChars);
  state.assembled += truncated;
  state.remainingChars -= truncated.length;
  state.sections.push(sectionName);
  state.truncated = true;
}

/**
 * Get the role prompt for the given role, falling back to a default.
 */
function getRolePrompt(config: PromptBuilderConfig): string {
  const rolePromptFn = ROLE_PROMPTS[config.role];
  if (rolePromptFn) {
    return rolePromptFn({
      blueprint: config.blueprint,
      conventions: config.conventions,
    });
  }
  return getDefaultRolePrompt(config.role);
}

/**
 * Build a complete system prompt for an agent by assembling role-specific
 * instructions with project context, blueprint, and conventions.
 *
 * The builder ensures the total prompt stays under the configured token limit
 * by prioritizing sections in this order:
 * 1. Role prompt (never truncated - core instructions)
 * 2. Task instructions (never truncated - current task context)
 * 3. Conventions (truncated if needed)
 * 4. Blueprint (truncated if needed)
 * 5. Brain context (truncated if needed - largest section, lowest priority)
 */
export function buildAgentPrompt(config: PromptBuilderConfig): BuiltPrompt {
  const maxTokens = config.maxTokens ?? 8000;
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // 1. Role prompt (required, never truncated)
  let assembled = getRolePrompt(config);
  const sections: string[] = ["role"];

  // 2. Task instructions (appended after role prompt, never truncated)
  if (config.taskInstructions) {
    sections.push("task");
    assembled += `\n\n## Current Task\n${config.taskInstructions}`;
  }

  // Build state for section appending
  const state: AssemblyState = {
    assembled,
    remainingChars: maxChars - assembled.length,
    sections,
    truncated: false,
  };

  // 3. Conventions (high priority context)
  if (config.conventions) {
    appendSection(
      state,
      "conventions",
      "## Project Conventions",
      config.conventions
    );
  }

  // 4. Blueprint summary (medium priority)
  if (config.blueprint) {
    appendSection(state, "blueprint", "## Blueprint Summary", config.blueprint);
  }

  // 5. Brain context (lowest priority, most likely to be truncated)
  if (config.brainContext) {
    appendSection(state, "brain", "## Codebase Context", config.brainContext);
  }

  return {
    estimatedTokens: estimateTokens(state.assembled),
    prompt: state.assembled,
    sections: state.sections,
    truncated: state.truncated,
  };
}

/**
 * Get a default role prompt for roles that don't have a dedicated prompt file.
 * This ensures unknown roles still get basic instructions.
 */
function getDefaultRolePrompt(role: string): string {
  return `You are an expert software engineer acting as a ${role} agent. You have access to tools for reading, writing, and searching files in a sandboxed environment.

## Tool Usage

You have access to the following tools. Always use the exact JSON format shown below for tool calls.

### Available Tools
| Tool | Purpose | Permission |
|------|---------|------------|
| \`file_read\` | Read file contents (optionally line range) | read |
| \`file_write\` | Write content to a file (creates dirs) | write |
| \`file_edit\` | Replace exact string in a file | write |
| \`file_delete\` | Delete a file | write |
| \`file_list\` | List files in a directory (glob pattern) | read |
| \`search_content\` | Search for regex pattern across codebase | read |
| \`search_files\` | Find files by glob pattern | read |
| \`terminal_exec\` | Execute a shell command | execute |
| \`git_status\` | Show working tree status | read |
| \`git_diff\` | Show changes between commits | read |
| \`git_commit\` | Stage and commit changes | write |

### Tool Call Format
\`\`\`json
{
  "tool": "file_read",
  "args": { "path": "path/to/file.ts" }
}
\`\`\`

## Core Principles
- Always read files before modifying them.
- Search the codebase for existing patterns before creating new ones.
- Run type checks after making changes.
- Handle errors explicitly — never silently swallow them.
- Follow existing conventions in the codebase.

## Error Recovery
- If a file edit fails, re-read the file to get the latest content before retrying.
- If a test fails, read the full error output and trace it back to the root cause.
- If a build fails, check for missing imports, type errors, and dependency issues.
- If stuck after 3 attempts, summarize the issue and request guidance.
`;
}

/**
 * Get the list of all supported role names.
 */
export function getSupportedRoles(): string[] {
  return Object.keys(ROLE_PROMPTS);
}

/**
 * Check if a role has a dedicated prompt.
 */
export function hasRolePrompt(role: string): boolean {
  return role in ROLE_PROMPTS;
}
