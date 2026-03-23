"use client";

/**
 * Recognized voice command types.
 */
export type VoiceCommandType =
  | "close_file"
  | "create_file"
  | "go_to_line"
  | "open_file"
  | "run_build"
  | "run_test"
  | "search"
  | "show_help"
  | "toggle_terminal"
  | "undo"
  | "unknown";

/**
 * A parsed voice command with its action type and extracted parameters.
 */
export interface VoiceCommand {
  /** Original transcript that was parsed */
  originalTranscript: string;
  /** Extracted parameters from the command */
  params: Record<string, string>;
  /** The raw matched portion of the transcript */
  rawMatch: string;
  /** The type of action to perform */
  type: VoiceCommandType;
}

interface CommandPattern {
  extract: (match: RegExpMatchArray) => Record<string, string>;
  pattern: RegExp;
  type: VoiceCommandType;
}

const COMMAND_PATTERNS: CommandPattern[] = [
  {
    type: "open_file",
    pattern:
      /(?:open|show|edit|go to|navigate to)\s+(?:file\s+)?(.+?)(?:\s+file)?$/i,
    extract: (match) => ({ filePath: match[1]?.trim() ?? "" }),
  },
  {
    type: "close_file",
    pattern: /(?:close|hide)\s+(?:file|tab|editor)(?:\s+(.+))?$/i,
    extract: (match) => ({ filePath: match[1]?.trim() ?? "" }),
  },
  {
    type: "create_file",
    pattern:
      /(?:create|new|add)\s+(?:a\s+)?(?:new\s+)?file\s+(?:called\s+|named\s+)?(.+)$/i,
    extract: (match) => ({ filePath: match[1]?.trim() ?? "" }),
  },
  {
    type: "search",
    pattern: /(?:search|find|look)\s+(?:for\s+)?(.+)$/i,
    extract: (match) => ({ query: match[1]?.trim() ?? "" }),
  },
  {
    type: "run_test",
    pattern:
      /(?:run|execute|start)\s+(?:the\s+)?tests?(?:\s+(?:for|in)\s+(.+))?$/i,
    extract: (match) => ({ target: match[1]?.trim() ?? "" }),
  },
  {
    type: "run_build",
    pattern:
      /(?:run|execute|start)\s+(?:the\s+)?build(?:\s+(?:for|in)\s+(.+))?$/i,
    extract: (match) => ({ target: match[1]?.trim() ?? "" }),
  },
  {
    type: "go_to_line",
    pattern: /(?:go to|jump to|navigate to)\s+line\s+(\d+)/i,
    extract: (match) => ({ line: match[1] ?? "" }),
  },
  {
    type: "toggle_terminal",
    pattern: /(?:toggle|show|hide|open|close)\s+(?:the\s+)?terminal/i,
    extract: () => ({}),
  },
  {
    type: "undo",
    pattern:
      /\b(?:undo|revert)\b(?:\s+(?:last|that|the last)\s+(?:change|action|edit))?/i,
    extract: () => ({}),
  },
  {
    type: "show_help",
    pattern:
      /(?:show|display|what)\s+(?:me\s+)?(?:the\s+)?(?:help|commands|voice commands)/i,
    extract: () => ({}),
  },
];

/**
 * Parses natural-language voice transcripts into structured command actions.
 *
 * Supports commands like:
 * - "open file src/index.ts"
 * - "search for authentication"
 * - "run tests for api"
 * - "go to line 42"
 * - "toggle terminal"
 * - "undo last change"
 */
export class CommandParser {
  private readonly customPatterns: CommandPattern[] = [];

  /**
   * Register a custom command pattern.
   */
  addPattern(
    type: VoiceCommandType,
    pattern: RegExp,
    extract: (match: RegExpMatchArray) => Record<string, string> = () => ({})
  ): void {
    this.customPatterns.push({ type, pattern, extract });
  }

  /**
   * Parse a transcript string into a VoiceCommand.
   * Returns an "unknown" command if no pattern matches.
   */
  parse(transcript: string): VoiceCommand {
    const cleaned = transcript.trim().toLowerCase();

    // Check custom patterns first (user-defined take precedence)
    for (const { type, pattern, extract } of this.customPatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        return {
          type,
          params: extract(match),
          rawMatch: match[0],
          originalTranscript: transcript,
        };
      }
    }

    // Check built-in patterns
    for (const { type, pattern, extract } of COMMAND_PATTERNS) {
      const match = cleaned.match(pattern);
      if (match) {
        return {
          type,
          params: extract(match),
          rawMatch: match[0],
          originalTranscript: transcript,
        };
      }
    }

    return {
      type: "unknown",
      params: { transcript: cleaned },
      rawMatch: cleaned,
      originalTranscript: transcript,
    };
  }

  /**
   * Parse a transcript and return null if the command is unknown.
   */
  tryParse(transcript: string): VoiceCommand | null {
    const command = this.parse(transcript);
    return command.type === "unknown" ? null : command;
  }

  /**
   * Returns a list of supported command descriptions for help display.
   */
  getSupportedCommands(): Array<{ description: string; examples: string[] }> {
    return [
      {
        description: "Open a file",
        examples: ["open file src/index.ts", "show app.tsx"],
      },
      {
        description: "Close a file",
        examples: ["close file", "close tab"],
      },
      {
        description: "Create a file",
        examples: ["create file utils.ts", "new file called helper.ts"],
      },
      {
        description: "Search the codebase",
        examples: ["search for authentication", "find useState"],
      },
      {
        description: "Run tests",
        examples: ["run tests", "run tests for api"],
      },
      {
        description: "Run build",
        examples: ["run build", "start build for web"],
      },
      {
        description: "Go to a line",
        examples: ["go to line 42", "jump to line 100"],
      },
      {
        description: "Toggle terminal",
        examples: ["toggle terminal", "show terminal"],
      },
      {
        description: "Undo",
        examples: ["undo", "undo last change"],
      },
      {
        description: "Show help",
        examples: ["show help", "what commands"],
      },
    ];
  }
}
