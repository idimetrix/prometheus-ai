/**
 * TargetedRunner uses knowledge of file-to-test relationships to run
 * only the tests that cover changed source files, falling back to
 * a full suite when relationships are unclear.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ci-loop:targeted");

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

/** Maps source file extensions to likely test file patterns */
const TEST_PATTERNS: Array<{
  sourcePattern: RegExp;
  testSuffixes: string[];
}> = [
  {
    sourcePattern: /\.tsx?$/,
    testSuffixes: [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"],
  },
  {
    sourcePattern: /\.jsx?$/,
    testSuffixes: [".test.js", ".test.jsx", ".spec.js", ".spec.jsx"],
  },
];

export class TargetedRunner {
  /**
   * Given a list of changed source files, determine which test files
   * to run. Returns a test command targeting only those files,
   * or the full suite command as fallback.
   */
  buildCommand(
    changedFiles: string[],
    fullCommand = "pnpm test"
  ): { command: string; targeted: boolean; testFiles: string[] } {
    if (changedFiles.length === 0) {
      return { command: fullCommand, targeted: false, testFiles: [] };
    }

    const testFiles = new Set<string>();
    const sourceFiles: string[] = [];

    for (const file of changedFiles) {
      // Skip if it's already a test file
      if (this.isTestFile(file)) {
        testFiles.add(file);
        continue;
      }

      // Find corresponding test files
      const relatedTests = this.findRelatedTests(file);
      for (const test of relatedTests) {
        testFiles.add(test);
      }
      sourceFiles.push(file);
    }

    if (testFiles.size === 0) {
      logger.info(
        { changedFiles: changedFiles.length },
        "No related tests found, running full suite"
      );
      return { command: fullCommand, targeted: false, testFiles: [] };
    }

    const testFilesArray = Array.from(testFiles);
    const testPatterns = testFilesArray.join(" ");

    logger.info(
      {
        changedFiles: sourceFiles.length,
        targetedTests: testFilesArray.length,
      },
      "Running targeted tests"
    );

    // Use vitest's filter capability
    return {
      command: `pnpm vitest run ${testPatterns} --reporter=verbose`,
      targeted: true,
      testFiles: testFilesArray,
    };
  }

  /**
   * Find test files related to a source file by naming convention.
   */
  private findRelatedTests(filePath: string): string[] {
    const tests: string[] = [];

    for (const pattern of TEST_PATTERNS) {
      if (!pattern.sourcePattern.test(filePath)) {
        continue;
      }

      for (const suffix of pattern.testSuffixes) {
        // Replace extension with test suffix
        const testPath = filePath.replace(pattern.sourcePattern, suffix);
        tests.push(testPath);

        // Also check __tests__ directory
        const parts = filePath.split("/");
        const fileName = parts.pop() ?? "";
        const dir = parts.join("/");
        const testFileName = fileName.replace(pattern.sourcePattern, suffix);
        tests.push(`${dir}/__tests__/${testFileName}`);
      }
    }

    return tests;
  }

  private isTestFile(filePath: string): boolean {
    return TEST_FILE_RE.test(filePath) || filePath.includes("__tests__/");
  }
}
