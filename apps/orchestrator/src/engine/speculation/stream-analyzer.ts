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
}
