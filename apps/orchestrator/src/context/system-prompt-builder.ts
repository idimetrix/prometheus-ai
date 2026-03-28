/**
 * System Prompt Builder — GAP-119
 *
 * Takes project context from the ProjectContextLoader and formats it
 * into a structured section suitable for system prompt injection.
 */

import { createLogger } from "@prometheus/logger";
import type { ParsedProjectContext } from "./project-context-loader";

const logger = createLogger("orchestrator:system-prompt-builder");

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface SystemPromptSection {
  /** The formatted system prompt section text */
  content: string;
  /** Approximate token count (chars / 4) */
  estimatedTokens: number;
  /** Whether any project context was found */
  hasContext: boolean;
  /** List of source files that contributed context */
  sources: string[];
}

export interface BuildOptions {
  /** Agent role for role-specific context filtering */
  agentRole?: string;
  /** Whether to include source file attribution (default: true) */
  includeAttribution?: boolean;
  /** Maximum character length for the context section (default: 12000) */
  maxLength?: number;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_LENGTH = 12_000;
const CHARS_PER_TOKEN = 4;

const SECTION_HEADER = `<project-context>
The following project-specific rules and conventions MUST be followed.
They take precedence over general instructions when there is a conflict.`;

const SECTION_FOOTER = "</project-context>";

/* -------------------------------------------------------------------------- */
/*  Core Function                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a formatted system prompt section from parsed project context.
 *
 * @param context - The parsed project context from loadProjectContext()
 * @param options - Formatting and length options
 * @returns A structured system prompt section
 */
export function buildSystemPromptSection(
  context: ParsedProjectContext,
  options: BuildOptions = {}
): SystemPromptSection {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const includeAttribution = options.includeAttribution ?? true;

  // No context found — return empty section
  if (!context.mergedContext) {
    return {
      content: "",
      estimatedTokens: 0,
      hasContext: false,
      sources: [],
    };
  }

  const sources = context.detectedFiles.map((f) => f.fileName);
  const parts: string[] = [SECTION_HEADER];

  // Add source attribution
  if (includeAttribution && sources.length > 0) {
    parts.push(`\nSources: ${sources.join(", ")}`);
  }

  // Add the merged context
  parts.push("");
  parts.push(context.mergedContext);

  // Close section
  parts.push("");
  parts.push(SECTION_FOOTER);

  let content = parts.join("\n");

  // Truncate if exceeding max length, preserving the closing tag
  if (content.length > maxLength) {
    const truncationNotice = "\n\n[... context truncated due to length ...]\n";
    const available =
      maxLength - SECTION_FOOTER.length - truncationNotice.length;
    content = content.slice(0, available) + truncationNotice + SECTION_FOOTER;
    logger.warn(
      { originalLength: parts.join("\n").length, truncatedTo: maxLength },
      "Project context truncated to fit token budget"
    );
  }

  const estimatedTokens = Math.ceil(content.length / CHARS_PER_TOKEN);

  logger.debug(
    { estimatedTokens, sources, contentLength: content.length },
    "System prompt section built"
  );

  return {
    content,
    estimatedTokens,
    hasContext: true,
    sources,
  };
}

/**
 * Convenience function: given a raw merged context string (without
 * the full ParsedProjectContext), wrap it in the standard prompt tags.
 * Useful when context has already been assembled elsewhere.
 */
export function wrapContextForPrompt(
  rawContext: string,
  maxLength?: number
): string {
  if (!rawContext.trim()) {
    return "";
  }

  const content = `${SECTION_HEADER}\n\n${rawContext}\n\n${SECTION_FOOTER}`;

  if (maxLength && content.length > maxLength) {
    const truncationNotice = "\n\n[... context truncated due to length ...]\n";
    const available =
      maxLength - SECTION_FOOTER.length - truncationNotice.length;
    return content.slice(0, available) + truncationNotice + SECTION_FOOTER;
  }

  return content;
}
