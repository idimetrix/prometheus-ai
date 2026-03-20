/**
 * Style Transfer — Analyzes and applies coding style from existing code
 * to newly generated code, ensuring consistency across the codebase.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:style-transfer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StyleProperties {
  bracketStyle: "same-line" | "new-line";
  commentStyle: "line" | "block" | "jsdoc" | "mixed";
  indentation: "tabs" | "spaces-2" | "spaces-4";
  maxLineLength: number;
  namingConventions: {
    classes: "PascalCase" | "camelCase";
    constants: "UPPER_SNAKE" | "camelCase" | "PascalCase";
    functions: "camelCase" | "snake_case";
    variables: "camelCase" | "snake_case";
  };
  quoteStyle: "single" | "double";
  semicolons: boolean;
  trailingCommas: "none" | "es5" | "all";
}

export interface StyleScore {
  details: Record<string, number>;
  overall: number;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const INDENT_TAB_RE = /^\t/m;
const INDENT_4_RE = /^ {4}\S/m;
const INDENT_2_RE = /^ {2}\S/m;
const SINGLE_QUOTE_RE = /'/g;
const DOUBLE_QUOTE_RE = /"/g;
const SEMICOLON_RE = /;\s*$/m;
const NO_SEMICOLON_RE = /[^;{}\s]\s*$/m;
const TRAILING_COMMA_RE = /,\s*[\])}]/g;
const LINE_COMMENT_RE = /\/\//g;
const BLOCK_COMMENT_RE = /\/\*[^*]/g;
const JSDOC_COMMENT_RE = /\/\*\*/g;
const PASCAL_CASE_RE = /\bclass\s+([A-Z][a-zA-Z0-9]+)/g;
const CAMEL_CASE_FUNC_RE =
  /(?:function|const|let)\s+([a-z][a-zA-Z0-9]*)\s*(?:=\s*(?:\(|async)|[(])/g;
const UPPER_SNAKE_RE = /\bconst\s+([A-Z][A-Z0-9_]+)\s*=/g;
const BRACE_SAME_LINE_RE = /\)\s*\{/g;
const BRACE_NEW_LINE_RE = /\)\s*\n\s*\{/g;
const DOUBLE_TO_SINGLE_RE = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
const SINGLE_TO_DOUBLE_RE = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
const LEADING_WHITESPACE_RE = /^[\t ]+/;
const LEADING_WHITESPACE_CAPTURE_RE = /^([\t ]+)/;

// ---------------------------------------------------------------------------
// StyleTransfer
// ---------------------------------------------------------------------------

export class StyleTransfer {
  /**
   * Analyze coding style from existing source code.
   */
  analyzeStyle(existingCode: string): StyleProperties {
    logger.debug("Analyzing code style");

    return {
      indentation: this.detectIndentation(existingCode),
      quoteStyle: this.detectQuoteStyle(existingCode),
      semicolons: this.detectSemicolons(existingCode),
      trailingCommas: this.detectTrailingCommas(existingCode),
      commentStyle: this.detectCommentStyle(existingCode),
      namingConventions: this.detectNamingConventions(existingCode),
      bracketStyle: this.detectBracketStyle(existingCode),
      maxLineLength: this.detectMaxLineLength(existingCode),
    };
  }

  /**
   * Apply a target style to generated code.
   */
  applyStyle(generatedCode: string, targetStyle: StyleProperties): string {
    logger.debug("Applying style transfer");

    let result = generatedCode;

    result = this.applyIndentation(result, targetStyle.indentation);
    result = this.applyQuoteStyle(result, targetStyle.quoteStyle);
    result = this.applySemicolons(result, targetStyle.semicolons);

    return result;
  }

  /**
   * Score how well code conforms to a target style (0-1).
   */
  getStyleScore(code: string, targetStyle: StyleProperties): StyleScore {
    const actual = this.analyzeStyle(code);
    const details: Record<string, number> = {};

    details.indentation =
      actual.indentation === targetStyle.indentation ? 1 : 0;
    details.quoteStyle = actual.quoteStyle === targetStyle.quoteStyle ? 1 : 0;
    details.semicolons = actual.semicolons === targetStyle.semicolons ? 1 : 0;
    details.trailingCommas =
      actual.trailingCommas === targetStyle.trailingCommas ? 1 : 0;
    details.bracketStyle =
      actual.bracketStyle === targetStyle.bracketStyle ? 1 : 0;

    const values = Object.values(details);
    const overall = values.reduce((a, b) => a + b, 0) / values.length;

    return { overall, details };
  }

  // ---- Detection helpers ---------------------------------------------------

  private detectIndentation(code: string): "tabs" | "spaces-2" | "spaces-4" {
    if (INDENT_TAB_RE.test(code)) {
      return "tabs";
    }
    if (INDENT_4_RE.test(code)) {
      return "spaces-4";
    }
    if (INDENT_2_RE.test(code)) {
      return "spaces-2";
    }
    return "spaces-2";
  }

  private detectQuoteStyle(code: string): "single" | "double" {
    const cleaned = code.replace(/`[^`]*`/g, "");
    const singles = (cleaned.match(SINGLE_QUOTE_RE) ?? []).length;
    const doubles = (cleaned.match(DOUBLE_QUOTE_RE) ?? []).length;
    return singles > doubles ? "single" : "double";
  }

  private detectSemicolons(code: string): boolean {
    const lines = code.split("\n").filter((l) => l.trim().length > 0);
    let withSemi = 0;
    let withoutSemi = 0;

    for (const line of lines) {
      if (SEMICOLON_RE.test(line)) {
        withSemi++;
      } else if (NO_SEMICOLON_RE.test(line)) {
        withoutSemi++;
      }
    }

    return withSemi >= withoutSemi;
  }

  private detectTrailingCommas(code: string): "none" | "es5" | "all" {
    const matches = code.match(TRAILING_COMMA_RE);
    if (!matches || matches.length === 0) {
      return "none";
    }
    return matches.length > 3 ? "all" : "es5";
  }

  private detectCommentStyle(
    code: string
  ): "line" | "block" | "jsdoc" | "mixed" {
    const lineCount = (code.match(LINE_COMMENT_RE) ?? []).length;
    const blockCount = (code.match(BLOCK_COMMENT_RE) ?? []).length;
    const jsdocCount = (code.match(JSDOC_COMMENT_RE) ?? []).length;

    if (jsdocCount > 0 && lineCount > 0) {
      return "mixed";
    }
    if (jsdocCount > blockCount && jsdocCount > lineCount) {
      return "jsdoc";
    }
    if (blockCount > lineCount) {
      return "block";
    }
    return "line";
  }

  private detectNamingConventions(
    code: string
  ): StyleProperties["namingConventions"] {
    return {
      classes: PASCAL_CASE_RE.test(code) ? "PascalCase" : "camelCase",
      functions: CAMEL_CASE_FUNC_RE.test(code) ? "camelCase" : "snake_case",
      variables: "camelCase",
      constants: UPPER_SNAKE_RE.test(code) ? "UPPER_SNAKE" : "camelCase",
    };
  }

  private detectBracketStyle(code: string): "same-line" | "new-line" {
    const sameLine = (code.match(BRACE_SAME_LINE_RE) ?? []).length;
    const newLine = (code.match(BRACE_NEW_LINE_RE) ?? []).length;
    return sameLine >= newLine ? "same-line" : "new-line";
  }

  private detectMaxLineLength(code: string): number {
    const lines = code.split("\n");
    let maxLen = 0;
    for (const line of lines) {
      if (line.length > maxLen) {
        maxLen = line.length;
      }
    }
    if (maxLen <= 80) {
      return 80;
    }
    if (maxLen <= 100) {
      return 100;
    }
    if (maxLen <= 120) {
      return 120;
    }
    return 140;
  }

  // ---- Application helpers -------------------------------------------------

  private applyIndentation(
    code: string,
    target: "tabs" | "spaces-2" | "spaces-4"
  ): string {
    const lines = code.split("\n");
    return lines
      .map((line) => {
        const stripped = line.replace(LEADING_WHITESPACE_RE, "");
        const leadingMatch = LEADING_WHITESPACE_CAPTURE_RE.exec(line);
        if (!leadingMatch) {
          return line;
        }

        const existing = leadingMatch[1] ?? "";
        let level = 0;
        if (existing.includes("\t")) {
          level = (existing.match(/\t/g) ?? []).length;
        } else {
          const spaces = existing.length;
          level = Math.round(spaces / 2);
        }

        const indent =
          target === "tabs"
            ? "\t".repeat(level)
            : " ".repeat(level * (target === "spaces-4" ? 4 : 2));

        return indent + stripped;
      })
      .join("\n");
  }

  private applyQuoteStyle(code: string, target: "single" | "double"): string {
    if (target === "single") {
      return code.replace(DOUBLE_TO_SINGLE_RE, (match) => {
        if (match.includes("\\")) {
          return match;
        }
        return `'${match.slice(1, -1)}'`;
      });
    }
    return code.replace(SINGLE_TO_DOUBLE_RE, (match) => {
      if (match.includes("\\")) {
        return match;
      }
      return `"${match.slice(1, -1)}"`;
    });
  }

  private applySemicolons(code: string, target: boolean): string {
    if (target) {
      return code.replace(
        /^([^/\n{}\s].*[^;{}\s,])\s*$/gm,
        (match, content: string) => {
          if (
            content.endsWith("{") ||
            content.endsWith("}") ||
            content.endsWith(",") ||
            content.startsWith("//") ||
            content.startsWith("/*") ||
            content.startsWith("*") ||
            content.startsWith("import") ||
            content.startsWith("export")
          ) {
            return match;
          }
          return `${content};`;
        }
      );
    }
    return code.replace(/;\s*$/gm, "");
  }
}
