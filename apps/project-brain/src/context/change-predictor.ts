import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:change-predictor");

export interface ChangePrediction {
  filePath: string;
  probability: number;
  reason: string;
}

/** Matches common test file naming patterns */
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

/** Matches file extension */
const FILE_EXT_RE = /\.[^.]+$/;

/** Matches import/require statements to extract paths */
const _IMPORT_PATH_RE =
  /from\s+["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\)/;

/** Keywords that indicate specific file types in task descriptions */
const TASK_KEYWORD_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  pathIndicators: readonly string[];
}> = [
  { pattern: /\brouter?\b/i, pathIndicators: ["router", "route", "trpc"] },
  { pattern: /\bcomponent\b/i, pathIndicators: ["component", "ui", "widget"] },
  { pattern: /\bschema\b/i, pathIndicators: ["schema", "model", "db"] },
  { pattern: /\bmigrat/i, pathIndicators: ["migration", "drizzle"] },
  { pattern: /\bmiddleware\b/i, pathIndicators: ["middleware"] },
  { pattern: /\bauth/i, pathIndicators: ["auth", "session"] },
  { pattern: /\bconfig/i, pathIndicators: ["config", "env", "setting"] },
  { pattern: /\bhook\b/i, pathIndicators: ["hook", "use"] },
  { pattern: /\butil/i, pathIndicators: ["util", "helper", "lib"] },
  { pattern: /\bservice\b/i, pathIndicators: ["service"] },
];

export class ChangePredictor {
  /**
   * Predict which files are most likely to be modified based on:
   * 1. Import graph proximity (files imported by relevant files)
   * 2. Historical co-change patterns (same directory, shared prefix)
   * 3. Test file proximity (component + component.test)
   * 4. Naming conventions and task keyword matching
   */
  predict(
    taskDescription: string,
    relevantFiles: string[],
    allFiles: string[]
  ): ChangePrediction[] {
    const predictions = new Map<string, ChangePrediction>();
    const relevantSet = new Set(relevantFiles);

    // 1. Score files based on import graph proximity
    this.scoreImportProximity(
      relevantFiles,
      allFiles,
      relevantSet,
      predictions
    );

    // 2. Score files based on co-change patterns (shared directory/prefix)
    this.scoreCoChangePatterns(
      relevantFiles,
      allFiles,
      relevantSet,
      predictions
    );

    // 3. Score test file proximity
    this.scoreTestProximity(relevantFiles, allFiles, relevantSet, predictions);

    // 4. Score based on task description keyword matching
    this.scoreTaskKeywords(taskDescription, allFiles, relevantSet, predictions);

    // Normalize probabilities and sort by descending probability
    const results = [...predictions.values()];
    const maxScore = Math.max(...results.map((p) => p.probability), 1);

    for (const prediction of results) {
      prediction.probability = Math.min(prediction.probability / maxScore, 1);
    }

    results.sort((a, b) => b.probability - a.probability);

    logger.info(
      {
        taskDescription: taskDescription.slice(0, 100),
        relevantFileCount: relevantFiles.length,
        predictedCount: results.length,
        topPrediction: results[0]?.filePath ?? "none",
      },
      "Change predictions generated"
    );

    return results;
  }

  /**
   * Files sharing directory with relevant files are likely co-changed.
   * Files sharing a longer common prefix get a higher score.
   */
  private scoreCoChangePatterns(
    relevantFiles: string[],
    allFiles: string[],
    relevantSet: Set<string>,
    predictions: Map<string, ChangePrediction>
  ): void {
    const relevantDirs = new Set<string>();
    for (const file of relevantFiles) {
      const dir = this.getDirectory(file);
      relevantDirs.add(dir);
    }

    for (const file of allFiles) {
      if (relevantSet.has(file)) {
        continue;
      }

      const dir = this.getDirectory(file);
      if (!relevantDirs.has(dir)) {
        continue;
      }

      // Check shared prefix length with each relevant file
      let maxPrefixScore = 0;
      for (const relevantFile of relevantFiles) {
        const prefixLen = this.commonPrefixLength(file, relevantFile);
        const score = prefixLen / Math.max(file.length, relevantFile.length);
        if (score > maxPrefixScore) {
          maxPrefixScore = score;
        }
      }

      const probability = 0.3 + maxPrefixScore * 0.4;
      this.addPrediction(
        predictions,
        file,
        probability,
        "co-located in same directory"
      );
    }
  }

  /**
   * For each relevant file, find its corresponding test file or vice versa.
   */
  private scoreTestProximity(
    relevantFiles: string[],
    allFiles: string[],
    relevantSet: Set<string>,
    predictions: Map<string, ChangePrediction>
  ): void {
    const allFileSet = new Set(allFiles);

    for (const file of relevantFiles) {
      const isTestFile = TEST_FILE_RE.test(file);

      if (isTestFile) {
        // Find the source file for this test
        const sourceFile = file.replace(".test.", ".").replace(".spec.", ".");
        if (allFileSet.has(sourceFile) && !relevantSet.has(sourceFile)) {
          this.addPrediction(
            predictions,
            sourceFile,
            0.8,
            "source file for related test"
          );
        }
      } else {
        // Find test files for this source
        const basePath = file.replace(FILE_EXT_RE, "");
        const ext = this.getExtension(file);

        const testVariants = [
          `${basePath}.test${ext}`,
          `${basePath}.spec${ext}`,
        ];

        for (const testFile of testVariants) {
          if (allFileSet.has(testFile) && !relevantSet.has(testFile)) {
            this.addPrediction(
              predictions,
              testFile,
              0.75,
              "test file for related source"
            );
          }
        }
      }
    }
  }

  /**
   * Score files that likely participate in the import graph of relevant files.
   * Uses naming heuristics since we don't have actual import parsing here.
   */
  private scoreImportProximity(
    relevantFiles: string[],
    allFiles: string[],
    relevantSet: Set<string>,
    predictions: Map<string, ChangePrediction>
  ): void {
    // Extract base names from relevant files to find likely imports
    const relevantBaseNames = new Set<string>();
    for (const file of relevantFiles) {
      const baseName = this.getBaseName(file);
      relevantBaseNames.add(baseName);
    }

    for (const file of allFiles) {
      if (relevantSet.has(file)) {
        continue;
      }

      const baseName = this.getBaseName(file);

      // Check if this file's name appears as a likely import target
      // e.g., if relevant file is "user-service.ts", "user-types.ts" is likely related
      for (const relevantBase of relevantBaseNames) {
        const sharedPrefix = this.getSharedWordPrefix(baseName, relevantBase);
        if (sharedPrefix.length >= 3) {
          const score =
            0.4 + (sharedPrefix.length / Math.max(baseName.length, 1)) * 0.3;
          this.addPrediction(
            predictions,
            file,
            score,
            `shares naming prefix "${sharedPrefix}" with ${relevantBase}`
          );
        }
      }

      // Index/barrel files in relevant directories are often affected
      if (baseName === "index" || baseName === "types") {
        const dir = this.getDirectory(file);
        for (const relevantFile of relevantFiles) {
          if (this.getDirectory(relevantFile) === dir) {
            this.addPrediction(
              predictions,
              file,
              0.6,
              `index/types file in same directory as ${this.getFileName(relevantFile)}`
            );
            break;
          }
        }
      }
    }
  }

  /**
   * Score files based on task description keywords matching file paths.
   */
  private scoreTaskKeywords(
    taskDescription: string,
    allFiles: string[],
    relevantSet: Set<string>,
    predictions: Map<string, ChangePrediction>
  ): void {
    const matchedIndicators: string[] = [];

    for (const { pattern, pathIndicators } of TASK_KEYWORD_PATTERNS) {
      if (pattern.test(taskDescription)) {
        matchedIndicators.push(...pathIndicators);
      }
    }

    if (matchedIndicators.length === 0) {
      return;
    }

    const lowerIndicators = matchedIndicators.map((ind) => ind.toLowerCase());

    for (const file of allFiles) {
      if (relevantSet.has(file)) {
        continue;
      }

      const lowerFile = file.toLowerCase();
      let matchCount = 0;

      for (const indicator of lowerIndicators) {
        if (lowerFile.includes(indicator)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const score = Math.min(0.2 + matchCount * 0.15, 0.7);
        this.addPrediction(
          predictions,
          file,
          score,
          `path matches task keywords (${matchCount} indicators)`
        );
      }
    }
  }

  private addPrediction(
    predictions: Map<string, ChangePrediction>,
    filePath: string,
    probability: number,
    reason: string
  ): void {
    const existing = predictions.get(filePath);
    if (existing) {
      // Combine probabilities: P(A or B) = P(A) + P(B) - P(A)*P(B)
      existing.probability =
        existing.probability + probability - existing.probability * probability;
      existing.reason = `${existing.reason}; ${reason}`;
    } else {
      predictions.set(filePath, { filePath, probability, reason });
    }
  }

  private getDirectory(filePath: string): string {
    const lastSlash = filePath.lastIndexOf("/");
    if (lastSlash === -1) {
      return "";
    }
    return filePath.slice(0, lastSlash);
  }

  private getFileName(filePath: string): string {
    const lastSlash = filePath.lastIndexOf("/");
    return filePath.slice(lastSlash + 1);
  }

  private getBaseName(filePath: string): string {
    const fileName = this.getFileName(filePath);
    const dotIndex = fileName.indexOf(".");
    if (dotIndex === -1) {
      return fileName;
    }
    return fileName.slice(0, dotIndex);
  }

  private getExtension(filePath: string): string {
    const match = filePath.match(FILE_EXT_RE);
    return match ? match[0] : "";
  }

  private commonPrefixLength(a: string, b: string): number {
    let i = 0;
    const len = Math.min(a.length, b.length);
    while (i < len && a[i] === b[i]) {
      i++;
    }
    return i;
  }

  /**
   * Get the shared word-level prefix between two file base names.
   * e.g., "user-service" and "user-types" share "user".
   */
  private getSharedWordPrefix(a: string, b: string): string {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    let i = 0;
    const len = Math.min(aLower.length, bLower.length);
    while (i < len && aLower[i] === bLower[i]) {
      i++;
    }

    // Trim to last word boundary (hyphen, underscore, or camelCase transition)
    const prefix = a.slice(0, i);
    const lastBoundary = Math.max(
      prefix.lastIndexOf("-"),
      prefix.lastIndexOf("_")
    );

    if (lastBoundary > 0) {
      return prefix.slice(0, lastBoundary);
    }

    return prefix;
  }
}
