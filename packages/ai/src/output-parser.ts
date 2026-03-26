// ---------------------------------------------------------------------------
// StructuredOutputParser — robust parsing of LLM responses
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedToolCall {
  arguments: Record<string, unknown>;
  name: string;
}

export interface ParsedCodeBlock {
  code: string;
  filename?: string;
  language: string;
}

// ---------------------------------------------------------------------------
// Top-level regex patterns
// ---------------------------------------------------------------------------

const TOOL_CALL_RE = /<tool_call>\s*\{[\s\S]*?\}\s*<\/tool_call>/g;

const TOOL_CALL_JSON_RE = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/;

const FUNCTION_CALL_RE =
  /```(?:json)?\s*\{\s*"(?:function|tool|name)"[\s\S]*?\}\s*```/g;

const CODE_BLOCK_RE = /```(\w*)?(?:\s+([^\n]+))?\n([\s\S]*?)```/g;

const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)```/;

const SECTION_RE = /^#{1,6}\s+(.+)$/gm;

const TRAILING_COMMA_RE = /,\s*([}\]])/g;
const SINGLE_QUOTE_KEY_RE = /'([^']+)'\s*:/g;
const UNQUOTED_KEY_RE = /(?<=\{|,)\s*([a-zA-Z_]\w*)\s*:/g;
const NEWLINE_IN_STRING_RE = /(?<="[^"]*)\n(?=[^"]*")/g;

// ---------------------------------------------------------------------------
// StructuredOutputParser
// ---------------------------------------------------------------------------

export class StructuredOutputParser {
  /**
   * Parse tool calls from various LLM formats:
   * - <tool_call>{ "name": "...", "arguments": {...} }</tool_call>
   * - JSON in code blocks with function/tool/name keys
   */
  parseToolCalls(response: string): ParsedToolCall[] {
    const results: ParsedToolCall[] = [];

    // Format 1: <tool_call> XML-style tags
    const xmlMatches = response.match(TOOL_CALL_RE) ?? [];
    for (const match of xmlMatches) {
      const jsonMatch = TOOL_CALL_JSON_RE.exec(match);
      if (!jsonMatch?.[1]) {
        continue;
      }
      const parsed = this.safeParseJson(jsonMatch[1]);
      if (parsed && typeof parsed === "object" && "name" in parsed) {
        const obj = parsed as Record<string, unknown>;
        results.push({
          name: String(obj.name ?? ""),
          arguments: (obj.arguments ?? obj.parameters ?? {}) as Record<
            string,
            unknown
          >,
        });
      }
    }

    // Format 2: JSON code blocks with function/tool/name keys
    if (results.length === 0) {
      const fnMatches = response.match(FUNCTION_CALL_RE) ?? [];
      for (const block of fnMatches) {
        const json = this.parseJsonBlock(block);
        if (
          json &&
          typeof json === "object" &&
          "name" in (json as Record<string, unknown>)
        ) {
          const obj = json as Record<string, unknown>;
          results.push({
            name: String(obj.name ?? obj.function ?? ""),
            arguments: (obj.arguments ?? obj.parameters ?? {}) as Record<
              string,
              unknown
            >,
          });
        }
      }
    }

    return results;
  }

  /**
   * Parse JSON from the first markdown ```json code block in the response.
   * Returns null if no valid JSON block is found.
   */
  parseJsonBlock(response: string): unknown {
    const match = JSON_BLOCK_RE.exec(response);
    if (!match?.[1]) {
      return null;
    }
    return this.safeParseJson(match[1].trim());
  }

  /**
   * Parse structured sections from markdown-formatted LLM output.
   * Returns a map of heading text -> content under that heading.
   */
  parseSections(response: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const headingPositions: Array<{ title: string; start: number }> = [];

    let sectionMatch: RegExpExecArray | null = SECTION_RE.exec(response);
    while (sectionMatch !== null) {
      headingPositions.push({
        title: (sectionMatch[1] ?? "").trim(),
        start: sectionMatch.index + sectionMatch[0].length,
      });
      sectionMatch = SECTION_RE.exec(response);
    }

    for (let i = 0; i < headingPositions.length; i++) {
      const current = headingPositions[i];
      if (!current) {
        continue;
      }
      const next = headingPositions[i + 1];
      const end = next ? next.start - (next.title.length + 3) : response.length;
      const content = response.slice(current.start, end).trim();
      sections[current.title] = content;
    }

    return sections;
  }

  /**
   * Attempt to repair malformed JSON by fixing common LLM mistakes:
   * - Trailing commas
   * - Single-quoted keys
   * - Unquoted keys
   * - Newlines inside strings
   */
  repairJson(malformed: string): string {
    let repaired = malformed.trim();

    // Remove trailing commas before } or ]
    repaired = repaired.replace(TRAILING_COMMA_RE, "$1");

    // Convert single-quoted keys to double-quoted
    repaired = repaired.replace(SINGLE_QUOTE_KEY_RE, '"$1":');

    // Quote unquoted keys
    repaired = repaired.replace(UNQUOTED_KEY_RE, ' "$1":');

    // Replace literal newlines inside strings
    repaired = repaired.replace(NEWLINE_IN_STRING_RE, "\\n");

    return repaired;
  }

  /**
   * Extract all code blocks with their language tags and optional filenames.
   * Supports syntax like: ```ts filename.ts
   */
  parseCodeBlocks(response: string): ParsedCodeBlock[] {
    const blocks: ParsedCodeBlock[] = [];
    let blockMatch: RegExpExecArray | null = CODE_BLOCK_RE.exec(response);

    while (blockMatch !== null) {
      blocks.push({
        language: blockMatch[1] ?? "text",
        filename: blockMatch[2]?.trim() || undefined,
        code: blockMatch[3]?.trim() ?? "",
      });
      blockMatch = CODE_BLOCK_RE.exec(response);
    }

    return blocks;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Attempt to parse JSON, trying repair if the first attempt fails.
   */
  private safeParseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      // Try repairing common issues and parse again
      try {
        const repaired = this.repairJson(raw);
        return JSON.parse(repaired);
      } catch {
        return null;
      }
    }
  }
}
