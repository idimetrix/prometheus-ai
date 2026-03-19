/**
 * StreamAnalyzer detects tool call JSON patterns in accumulating tokens.
 * Emits PredictionSignal when confidence exceeds threshold.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:stream-analyzer");

const TOOL_NAME_RE = /"name"\s*:\s*"([a-z_]+)"/;
const TOOL_ARGS_RE = /"arguments"\s*:\s*"(\{[^"]*)"/;

export interface PredictionSignal {
  confidence: number;
  predictedArgs: Record<string, unknown>;
  predictedTool: string;
}

/** Regex patterns to detect tool call starts in streaming tokens */
const TOOL_CALL_PATTERNS = [
  /file_read|file_list|search_files|search_content|search_semantic/,
  /git_status|git_diff|read_blueprint|read_brain/,
];

const READ_ONLY_TOOLS = new Set([
  "file_read",
  "file_list",
  "search_files",
  "search_content",
  "search_semantic",
  "git_status",
  "git_diff",
  "read_blueprint",
  "read_brain",
  "browser_open",
]);

export class StreamAnalyzer {
  private buffer = "";
  private lastAnalyzedLength = 0;
  private readonly minConfidence: number;

  constructor(minConfidence = 0.6) {
    this.minConfidence = minConfidence;
  }

  /**
   * Feed new tokens into the analyzer.
   * Returns a prediction signal if a tool call is detected with sufficient confidence.
   */
  analyze(newTokens: string): PredictionSignal | null {
    this.buffer += newTokens;

    // Only analyze when we have enough new content
    if (this.buffer.length - this.lastAnalyzedLength < 20) {
      return null;
    }
    this.lastAnalyzedLength = this.buffer.length;

    // Look for tool call JSON patterns
    // OpenAI format: {"name": "tool_name", "arguments": ...}
    const toolNameMatch = this.buffer.match(TOOL_NAME_RE);
    if (!toolNameMatch) {
      return null;
    }

    const toolName = toolNameMatch[1] as string;

    // Only predict for read-only tools (safe to pre-execute)
    if (!READ_ONLY_TOOLS.has(toolName)) {
      return null;
    }

    // Check if we can see enough of the arguments
    const argsMatch = this.buffer.match(TOOL_ARGS_RE);
    if (!argsMatch) {
      return null;
    }

    // Estimate confidence based on how complete the args look
    const partialArgs = argsMatch[1] as string;
    let confidence = 0.5;

    // Higher confidence for patterns matching known tools
    if (TOOL_CALL_PATTERNS.some((p) => p.test(toolName))) {
      confidence += 0.2;
    }

    // Try to parse partial args
    try {
      // Attempt to close the JSON and parse
      const closedJson = this.closeJson(partialArgs);
      const args = JSON.parse(closedJson);

      // If we got a file path, higher confidence
      if (args.path || args.filePath || args.query) {
        confidence += 0.15;
      }

      if (confidence >= this.minConfidence) {
        logger.debug(
          { toolName, confidence: confidence.toFixed(2) },
          "Prediction signal emitted"
        );
        return {
          predictedTool: toolName,
          predictedArgs: args,
          confidence,
        };
      }
    } catch {
      // Args not parseable yet
    }

    return null;
  }

  /**
   * Attempt to close incomplete JSON by adding missing brackets/braces.
   */
  private closeJson(partial: string): string {
    let result = partial;
    const openBraces = (result.match(/\{/g) || []).length;
    const closeBraces = (result.match(/\}/g) || []).length;
    const openBrackets = (result.match(/\[/g) || []).length;
    const closeBrackets = (result.match(/\]/g) || []).length;

    // Close any open strings
    const quotes = (result.match(/"/g) || []).length;
    if (quotes % 2 !== 0) {
      result += '"';
    }

    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      result += "]";
    }
    for (let i = 0; i < openBraces - closeBraces; i++) {
      result += "}";
    }

    return result;
  }

  reset(): void {
    this.buffer = "";
    this.lastAnalyzedLength = 0;
  }

  // -------------------------------------------------------------------------
  // Pattern-Based Prediction
  // -------------------------------------------------------------------------

  /**
   * Predict the next likely tool call based on patterns in the LLM output text.
   *
   * Unlike `analyze()` which looks at raw JSON tool call structures, this method
   * examines natural language patterns in the assistant's reasoning to predict
   * what tool it will invoke next. This enables earlier prefetching.
   *
   * @param text - The accumulated assistant text output (not tool call JSON)
   * @returns A prediction signal if a pattern match is found, null otherwise
   */
  predictFromPatterns(text: string): PredictionSignal | null {
    // Only analyze the last 500 chars for performance
    const window = text.slice(-500);

    for (const pattern of PATTERN_PREDICTIONS) {
      if (pattern.regex.test(window)) {
        // Extract arguments from the text using the arg extractor
        const args = pattern.argExtractor ? pattern.argExtractor(window) : {};

        // Only predict read-only tools for safety
        if (!READ_ONLY_TOOLS.has(pattern.predictedTool)) {
          continue;
        }

        logger.debug(
          {
            pattern: pattern.name,
            predictedTool: pattern.predictedTool,
            confidence: pattern.confidence.toFixed(2),
          },
          "Pattern-based prediction"
        );

        return {
          predictedTool: pattern.predictedTool,
          predictedArgs: args,
          confidence: pattern.confidence,
        };
      }
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Pattern definitions for predictFromPatterns()
// ---------------------------------------------------------------------------

interface PatternPrediction {
  /** Extracts likely arguments from the surrounding text */
  argExtractor?: (text: string) => Record<string, unknown>;
  /** Confidence level for this pattern (0-1) */
  confidence: number;
  /** Human-readable name for logging */
  name: string;
  /** The tool likely to be called */
  predictedTool: string;
  /** Regex that triggers this prediction */
  regex: RegExp;
}

const FILE_PATH_REGEX = /(?:['"`])([./][\w./\-@]+\.\w+)(?:['"`])/;
const BACKTICK_PATH_REGEX = /`([./][\w./\-@]+\.\w+)`/;
const SEARCH_QUERY_REGEX =
  /(?:search|find|look\s+for|grep)\s+(?:for\s+)?['"`]([^'"`]+)['"`]/i;

/** Extract a file path from surrounding text. */
function extractFilePath(text: string): Record<string, unknown> {
  // Match common file path patterns
  const pathMatch = text.match(FILE_PATH_REGEX);
  if (pathMatch?.[1]) {
    return { path: pathMatch[1] };
  }
  // Match backtick-wrapped paths
  const backtickMatch = text.match(BACKTICK_PATH_REGEX);
  if (backtickMatch?.[1]) {
    return { path: backtickMatch[1] };
  }
  return {};
}

/** Extract a search query from surrounding text. */
function extractSearchQuery(text: string): Record<string, unknown> {
  // Look for quoted strings near search-related words
  const queryMatch = text.match(SEARCH_QUERY_REGEX);
  if (queryMatch?.[1]) {
    return { query: queryMatch[1] };
  }
  return {};
}

const PATTERN_PREDICTIONS: PatternPrediction[] = [
  {
    name: "read_file_intent",
    regex:
      /(?:let me (?:read|look at|check|examine|open)|i(?:'ll| will| need to) (?:read|look at|check|examine|open|review))\s+(?:the\s+)?(?:file|contents)/i,
    predictedTool: "file_read",
    confidence: 0.75,
    argExtractor: extractFilePath,
  },
  {
    name: "read_specific_file",
    regex:
      /(?:read|open|check|look at|examine|review)\s+['"`]?[./][\w./\-@]+\.\w+['"`]?/i,
    predictedTool: "file_read",
    confidence: 0.8,
    argExtractor: extractFilePath,
  },
  {
    name: "list_directory_intent",
    regex:
      /(?:let me (?:list|see|check)|i(?:'ll| will| need to) (?:list|see|check))\s+(?:the\s+)?(?:files|directory|folder|contents of)/i,
    predictedTool: "file_list",
    confidence: 0.7,
    argExtractor: extractFilePath,
  },
  {
    name: "search_intent",
    regex:
      /(?:let me (?:search|find|look|grep)|i(?:'ll| will| need to) (?:search|find|look|grep))\s+(?:for\s+)?/i,
    predictedTool: "search_content",
    confidence: 0.65,
    argExtractor: extractSearchQuery,
  },
  {
    name: "git_status_intent",
    regex:
      /(?:check|see|look at|review)\s+(?:the\s+)?(?:git\s+)?(?:status|changes|diff|modifications)/i,
    predictedTool: "git_status",
    confidence: 0.7,
  },
  {
    name: "git_diff_intent",
    regex: /(?:check|see|look at|review|compare)\s+(?:the\s+)?(?:git\s+)?diff/i,
    predictedTool: "git_diff",
    confidence: 0.75,
  },
  {
    name: "blueprint_intent",
    regex:
      /(?:check|read|review|look at)\s+(?:the\s+)?(?:blueprint|project\s+plan|architecture)/i,
    predictedTool: "read_blueprint",
    confidence: 0.65,
  },
  {
    name: "semantic_search_intent",
    regex: /(?:semantic(?:ally)?|meaning|concept)\s+(?:search|find|look)/i,
    predictedTool: "search_semantic",
    confidence: 0.6,
  },
];
