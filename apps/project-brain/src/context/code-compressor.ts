/**
 * Phase 7.20: Code Compressor.
 *
 * Symbol-level summaries for large codebases (100K+ LOC).
 * Expands only directly relevant files while providing
 * compressed summaries for everything else.
 */
import { createLogger } from "@prometheus/logger";
import { estimateTokens } from "./token-counter";

const logger = createLogger("project-brain:code-compressor");

const WHITESPACE_RE = /\s+/;

export interface FileSummary {
  exports: string[];
  filePath: string;
  language: string;
  lineCount: number;
  summary: string;
}

export interface CompressedContext {
  expandedFiles: string[];
  summaries: FileSummary[];
  tokenCount: number;
}

interface FileInput {
  content: string;
  filePath: string;
}

const EXPORT_PATTERN =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/g;
const FUNCTION_PATTERN =
  /(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
const CLASS_PATTERN = /class\s+(\w+)/g;
const INTERFACE_PATTERN = /interface\s+(\w+)/g;
const TYPE_PATTERN = /type\s+(\w+)/g;

/**
 * CodeCompressor creates symbol-level summaries for large codebases
 * and expands only the directly relevant files for the current query.
 */
export class CodeCompressor {
  /**
   * Compress a set of files into summaries and expand relevant ones.
   */
  compress(files: FileInput[], query: string): CompressedContext {
    const summaries: FileSummary[] = [];
    const expandedFiles: string[] = [];
    let totalTokens = 0;

    // Score each file for relevance to the query
    const scored = files.map((file) => ({
      file,
      relevance: this.scoreRelevance(file, query),
    }));

    // Sort by relevance descending
    scored.sort((a, b) => b.relevance - a.relevance);

    // Expand top relevant files (up to 5)
    const toExpand = scored.slice(0, 5);
    const toSummarize = scored.slice(5);

    // Create summaries for non-expanded files
    for (const { file } of toSummarize) {
      const summary = this.createFileSummary(file);
      summaries.push(summary);
      totalTokens += estimateTokens(summary.summary);
    }

    // Also create summaries for expanded files (for the summary list)
    for (const { file } of toExpand) {
      const summary = this.createFileSummary(file);
      summaries.push(summary);
      expandedFiles.push(file.filePath);
      totalTokens += estimateTokens(file.content);
    }

    logger.info(
      {
        totalFiles: files.length,
        expanded: expandedFiles.length,
        summarized: toSummarize.length,
        totalTokens,
      },
      "Code compressed"
    );

    return {
      summaries,
      expandedFiles,
      tokenCount: totalTokens,
    };
  }

  /**
   * Create a symbol-level summary of a file.
   */
  private createFileSummary(file: FileInput): FileSummary {
    const exports = this.findSymbols(file.content);
    const lineCount = file.content.split("\n").length;
    const language = this.detectLanguage(file.filePath);

    const exportList =
      exports.length > 0
        ? exports.slice(0, 10).join(", ")
        : "no public exports";

    const summary = `${file.filePath} (${lineCount} lines, ${language}): ${exportList}`;

    return {
      filePath: file.filePath,
      summary,
      exports,
      lineCount,
      language,
    };
  }

  /**
   * Find exported symbols in a file.
   */
  private findSymbols(content: string): string[] {
    const symbols = new Set<string>();

    const patterns = [
      EXPORT_PATTERN,
      FUNCTION_PATTERN,
      CLASS_PATTERN,
      INTERFACE_PATTERN,
      TYPE_PATTERN,
    ];

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const name = match[1] ?? match[2];
        if (name && name.length > 1) {
          symbols.add(name);
        }
      }
    }

    return Array.from(symbols);
  }

  /**
   * Score a file's relevance to a query.
   */
  private scoreRelevance(file: FileInput, query: string): number {
    const queryWords = query.toLowerCase().split(WHITESPACE_RE);
    const fileLower = file.filePath.toLowerCase();
    const contentLower = file.content.toLowerCase();
    let score = 0;

    // Path match
    for (const word of queryWords) {
      if (word.length > 2 && fileLower.includes(word)) {
        score += 0.3;
      }
    }

    // Content match (keyword overlap)
    for (const word of queryWords) {
      if (word.length > 2 && contentLower.includes(word)) {
        score += 0.1;
      }
    }

    // Symbol match
    const symbols = this.findSymbols(file.content);
    for (const symbol of symbols) {
      const symbolLower = symbol.toLowerCase();
      for (const word of queryWords) {
        if (word.length > 2 && symbolLower.includes(word)) {
          score += 0.2;
        }
      }
    }

    return Math.min(1, score);
  }

  private detectLanguage(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const langMap: Record<string, string> = {
      ts: "TypeScript",
      tsx: "TypeScript/React",
      js: "JavaScript",
      jsx: "JavaScript/React",
      py: "Python",
      go: "Go",
      rs: "Rust",
      java: "Java",
      cpp: "C++",
      c: "C",
    };
    return langMap[ext] ?? ext;
  }
}
