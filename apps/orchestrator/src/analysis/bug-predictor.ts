/**
 * Bug Predictor (MOON-013)
 *
 * Predictive bug detection that analyzes code patterns to predict
 * potential bugs. Uses historical data from past bug fixes and
 * code pattern analysis to identify high-risk code.
 */

import { createLogger } from "@prometheus/logger";
import { modelRouterClient, projectBrainClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:analysis:bug-predictor");

const JSON_ARRAY_RE = /\[[\s\S]*\]/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BugType =
  | "null_reference"
  | "race_condition"
  | "off_by_one"
  | "resource_leak"
  | "type_mismatch"
  | "missing_validation"
  | "error_swallowing";

export type RiskLevel = "low" | "medium" | "high";

export interface BugPrediction {
  /** The type of potential bug */
  bugType: BugType;
  /** Explanation of why this is flagged */
  explanation: string;
  /** The file containing the potential bug */
  file: string;
  /** Line number of the potential bug */
  line: number;
  /** Probability the code has a bug (0-1) */
  probability: number;
  /** Suggested fix if available */
  suggestedFix?: string;
}

export interface BugPredictionResult {
  /** Overall risk assessment */
  overallRisk: RiskLevel;
  /** Individual bug predictions */
  predictions: BugPrediction[];
}

interface FileAnalysis {
  content: string;
  path: string;
}

interface HistoricalBugPattern {
  bugType: BugType;
  frequency: number;
  pattern: string;
}

// ---------------------------------------------------------------------------
// Pattern matchers (static analysis heuristics)
// ---------------------------------------------------------------------------

const EMPTY_CATCH_RE = /catch\s*\([^)]*\)\s*\{\s*\}/;
const PROMISE_NO_CATCH_RE = /(?:\.then\s*\([^)]*\))(?!\s*\.catch|\s*\.finally)/;
const ARRAY_INDEX_RE = /\[\s*(?:\w+\s*[-+]\s*1|\w+\.length\s*[-+]?\s*\d*)\s*\]/;
const EVENT_LISTENER_RE = /addEventListener\s*\(/;
const REMOVE_LISTENER_RE = /removeEventListener\s*\(/;
const SETINTERVAL_RE = /setInterval\s*\(/;
const CLEARINTERVAL_RE = /clearInterval\s*\(/;
const PROPERTY_ACCESS_RE = /\.\w+/;

// ---------------------------------------------------------------------------
// BugPredictor
// ---------------------------------------------------------------------------

export class BugPredictor {
  /**
   * Analyze changed files to predict potential bugs.
   */
  async predict(
    projectId: string,
    changedFiles: string[]
  ): Promise<BugPredictionResult> {
    const logCtx = { projectId, fileCount: changedFiles.length };

    logger.info(logCtx, "Starting bug prediction analysis");

    try {
      // Step 1: Fetch file contents
      const files = await this.fetchFiles(projectId, changedFiles);
      logger.info(
        { ...logCtx, fetchedFiles: files.length },
        "Files fetched for analysis"
      );

      // Step 2: Run static pattern analysis
      const staticPredictions = this.runStaticAnalysis(files);
      logger.info(
        { ...logCtx, staticPredictions: staticPredictions.length },
        "Static analysis complete"
      );

      // Step 3: Fetch historical bug patterns
      const historicalPatterns = await this.fetchHistoricalPatterns(projectId);

      // Step 4: Run LLM-powered deep analysis
      const llmPredictions = await this.runLLMAnalysis(
        files,
        historicalPatterns
      );
      logger.info(
        { ...logCtx, llmPredictions: llmPredictions.length },
        "LLM analysis complete"
      );

      // Step 5: Merge and deduplicate predictions
      const allPredictions = this.mergePredictions(
        staticPredictions,
        llmPredictions
      );

      // Step 6: Calculate overall risk
      const overallRisk = this.calculateOverallRisk(allPredictions);

      logger.info(
        {
          ...logCtx,
          totalPredictions: allPredictions.length,
          overallRisk,
        },
        "Bug prediction complete"
      );

      return {
        predictions: allPredictions,
        overallRisk,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ ...logCtx, error: msg }, "Bug prediction failed");

      return {
        predictions: [],
        overallRisk: "low",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step implementations
  // -------------------------------------------------------------------------

  /**
   * Fetch file contents from the project brain.
   */
  private async fetchFiles(
    projectId: string,
    filePaths: string[]
  ): Promise<FileAnalysis[]> {
    const files: FileAnalysis[] = [];

    try {
      const response = await projectBrainClient.post<{
        files: Array<{ content: string; path: string }>;
      }>(`/api/projects/${projectId}/files`, {
        paths: filePaths,
      });

      for (const file of response.data.files) {
        if (file.content) {
          files.push({ path: file.path, content: file.content });
        }
      }
    } catch (error) {
      logger.warn({ error }, "Failed to fetch files from project brain");
    }

    return files;
  }

  /**
   * Run static pattern analysis to detect common bug patterns.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: static analysis requires many sequential pattern checks
  private runStaticAnalysis(files: FileAnalysis[]): BugPrediction[] {
    const predictions: BugPrediction[] = [];

    for (const file of files) {
      const lines = file.content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const lineNum = i + 1;
        const context = lines.slice(Math.max(0, i - 2), i + 3).join("\n");

        // Check for potential null dereference
        if (
          line.includes(".find(") &&
          i + 1 < lines.length &&
          !line.includes("??") &&
          !line.includes("?.")
        ) {
          const nextLine = lines[i + 1] ?? "";
          if (nextLine.match(PROPERTY_ACCESS_RE) && !nextLine.includes("?.")) {
            predictions.push({
              file: file.path,
              line: lineNum + 1,
              probability: 0.7,
              bugType: "null_reference",
              explanation:
                "Result of .find() is used without null check on the next line",
              suggestedFix: "Add optional chaining (?.) or a null check",
            });
          }
        }

        // Check for empty catch blocks (error swallowing)
        if (EMPTY_CATCH_RE.test(context)) {
          predictions.push({
            file: file.path,
            line: lineNum,
            probability: 0.8,
            bugType: "error_swallowing",
            explanation: "Empty catch block swallows errors silently",
            suggestedFix:
              "Log the error or re-throw it. At minimum, add a comment explaining why errors are ignored.",
          });
        }

        // Check for array bounds issues
        if (ARRAY_INDEX_RE.test(line)) {
          predictions.push({
            file: file.path,
            line: lineNum,
            probability: 0.5,
            bugType: "off_by_one",
            explanation:
              "Array access with computed index may be out of bounds",
            suggestedFix: "Add bounds checking before array access",
          });
        }

        // Check for potential resource leaks (event listeners, intervals)
        if (EVENT_LISTENER_RE.test(line)) {
          const hasRemoveListener = file.content
            .slice(file.content.indexOf(line))
            .match(REMOVE_LISTENER_RE);
          if (!hasRemoveListener) {
            predictions.push({
              file: file.path,
              line: lineNum,
              probability: 0.6,
              bugType: "resource_leak",
              explanation:
                "Event listener added without a corresponding removeEventListener",
              suggestedFix:
                "Add cleanup logic to remove the event listener when no longer needed",
            });
          }
        }

        if (SETINTERVAL_RE.test(line)) {
          const hasClearInterval = file.content.match(CLEARINTERVAL_RE);
          if (!hasClearInterval) {
            predictions.push({
              file: file.path,
              line: lineNum,
              probability: 0.7,
              bugType: "resource_leak",
              explanation:
                "setInterval used without a corresponding clearInterval",
              suggestedFix:
                "Store the interval ID and call clearInterval in cleanup",
            });
          }
        }

        // Check for unhandled promises
        if (PROMISE_NO_CATCH_RE.test(line) && !line.includes("await")) {
          predictions.push({
            file: file.path,
            line: lineNum,
            probability: 0.5,
            bugType: "error_swallowing",
            explanation: "Promise chain without .catch() may silently fail",
            suggestedFix:
              "Add .catch() handler or use async/await with try-catch",
          });
        }
      }
    }

    return predictions;
  }

  /**
   * Fetch historical bug patterns from past fixes.
   */
  private async fetchHistoricalPatterns(
    projectId: string
  ): Promise<HistoricalBugPattern[]> {
    try {
      const response = await projectBrainClient.get<{
        patterns: HistoricalBugPattern[];
      }>(`/api/projects/${projectId}/bug-patterns`);

      return response.data.patterns;
    } catch {
      return [];
    }
  }

  /**
   * Run LLM-powered deep analysis for subtle bug patterns.
   */
  private async runLLMAnalysis(
    files: FileAnalysis[],
    historicalPatterns: HistoricalBugPattern[]
  ): Promise<BugPrediction[]> {
    if (files.length === 0) {
      return [];
    }

    try {
      const historicalContext =
        historicalPatterns.length > 0
          ? `Historical bug patterns in this project:\n${historicalPatterns.map((p) => `- ${p.bugType}: ${p.pattern} (occurred ${p.frequency} times)`).join("\n")}`
          : "No historical bug data available.";

      const filesContext = files
        .slice(0, 5)
        .map((f) => `### ${f.path}\n${f.content.slice(0, 2000)}`)
        .join("\n\n");

      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `You are a senior engineer specializing in bug detection. Analyze these code files for potential bugs.

${historicalContext}

Look for:
- Null/undefined reference errors
- Race conditions in async code
- Off-by-one errors
- Resource leaks (unclosed connections, streams, timers)
- Type mismatches
- Missing input validation
- Silently swallowed errors
- Concurrency issues

Files:
${filesContext}

For each potential bug, output a JSON array of objects with:
- "file": string
- "line": number
- "probability": number (0-1)
- "bugType": "null_reference" | "race_condition" | "off_by_one" | "resource_leak" | "type_mismatch" | "missing_validation" | "error_swallowing"
- "explanation": string
- "suggestedFix": string (optional)

Output ONLY the JSON array. If no bugs found, output [].`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "[]";
      const jsonMatch = content.match(JSON_ARRAY_RE);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as BugPrediction[];
        return parsed.filter(
          (p) =>
            p.file &&
            p.bugType &&
            p.explanation &&
            typeof p.probability === "number"
        );
      }
    } catch (error) {
      logger.warn({ error }, "LLM bug analysis failed");
    }

    return [];
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Merge and deduplicate predictions from static and LLM analysis.
   */
  private mergePredictions(
    staticPredictions: BugPrediction[],
    llmPredictions: BugPrediction[]
  ): BugPrediction[] {
    const merged: BugPrediction[] = [...staticPredictions];
    const seen = new Set(
      staticPredictions.map((p) => `${p.file}:${p.line}:${p.bugType}`)
    );

    for (const prediction of llmPredictions) {
      const key = `${prediction.file}:${prediction.line}:${prediction.bugType}`;
      if (seen.has(key)) {
        // If both found the same bug, boost the probability
        const existing = merged.find(
          (p) =>
            p.file === prediction.file &&
            p.line === prediction.line &&
            p.bugType === prediction.bugType
        );
        if (existing) {
          existing.probability = Math.min(
            1,
            existing.probability + prediction.probability * 0.3
          );
        }
      } else {
        seen.add(key);
        merged.push(prediction);
      }
    }

    // Sort by probability (highest first)
    merged.sort((a, b) => b.probability - a.probability);

    return merged;
  }

  /**
   * Calculate the overall risk level from predictions.
   */
  private calculateOverallRisk(predictions: BugPrediction[]): RiskLevel {
    if (predictions.length === 0) {
      return "low";
    }

    const highProbCount = predictions.filter(
      (p) => p.probability >= 0.7
    ).length;
    const maxProbability = Math.max(...predictions.map((p) => p.probability));

    if (highProbCount >= 3 || maxProbability >= 0.9) {
      return "high";
    }

    if (highProbCount >= 1 || predictions.length >= 5) {
      return "medium";
    }

    return "low";
  }
}
