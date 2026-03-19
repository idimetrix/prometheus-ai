/**
 * Phase 3.3: Convention Learning.
 *
 * Analyzes a codebase to learn recurring conventions by leveraging
 * the existing ConventionExtractor (analyzers/) and ConventionMemoryLayer.
 * Stores learned conventions per project with confidence scores.
 */
import { createLogger } from "@prometheus/logger";

import type { ConventionExtractor as AnalyzerConventionExtractor } from "../analyzers/convention-extractor";
import type { ConventionMemoryLayer } from "../layers/convention-memory";

const logger = createLogger("project-brain:convention-learner");

// ---- Regex constants for pattern detection ----
const CAMEL_CASE_FILE_RE = /^[a-z][a-zA-Z0-9]+\.\w+$/;
const KEBAB_CASE_FILE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+\.\w+$/;
const SNAKE_CASE_FILE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+\.\w+$/;
const PASCAL_CASE_FILE_RE = /^[A-Z][a-zA-Z0-9]+\.\w+$/;

const IMPORT_LINE_RE = /^import\s+.*$/gm;
const EXTERNAL_IMPORT_RE = /from\s+["']([^./@][^"']*)["']/;
const SCOPED_IMPORT_RE = /from\s+["'](@[^"'/]+\/[^"'/]+)/;
const RELATIVE_IMPORT_RE = /from\s+["'](\.{1,2}\/[^"']+)["']/;

const TRY_CATCH_RE = /try\s*\{/g;
const CATCH_ERR_INSTANCE_RE =
  /catch\s*\(\s*(\w+)\s*\)\s*\{[^}]*instanceof\s+Error/;
const THROW_NEW_RE = /throw\s+new\s+(\w*Error)/g;
const EXTENDS_ERROR_RE = /class\s+\w+\s+extends\s+(\w*Error)/g;

const FUNCTIONAL_COMPONENT_RE =
  /(?:export\s+)?(?:const|function)\s+[A-Z]\w+\s*(?::\s*React\.FC|=\s*\()/g;
const CLASS_COMPONENT_RE = /class\s+\w+\s+extends\s+(?:React\.)?Component/g;
const USE_HOOK_RE = /\buse[A-Z]\w+\s*\(/g;

const DESCRIBE_BLOCK_RE = /describe\s*\(/g;
const IT_BLOCK_RE = /\bit\s*\(/g;
const TEST_BLOCK_RE = /\btest\s*\(/g;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const TESTS_DIR_RE = /__tests__\//;

const CODE_FILE_EXT_RE = /\.(ts|tsx|js|jsx)$/;

export interface FileContent {
  content: string;
  path: string;
}

export interface LearnedConventions {
  /** All detected conventions */
  conventions: LearnedConvention[];
  /** Number of files analyzed */
  filesAnalyzed: number;
  /** Timestamp of learning run */
  learnedAt: string;
}

export interface LearnedConvention {
  category: string;
  confidence: number;
  description: string;
  examples: string[];
  fileCount: number;
  pattern: string;
}

/**
 * ConventionLearner analyzes codebases to detect and store conventions.
 * Leverages the existing ConventionExtractor for initial extraction,
 * then runs additional specialized analyzers.
 */
export class ConventionLearner {
  private readonly conventionMemory: ConventionMemoryLayer;
  private readonly extractor: AnalyzerConventionExtractor | null;

  constructor(
    conventionMemory: ConventionMemoryLayer,
    extractor?: AnalyzerConventionExtractor
  ) {
    this.conventionMemory = conventionMemory;
    this.extractor = extractor ?? null;
  }

  /**
   * Analyze a set of files and learn conventions from them.
   * Stores results in the ConventionMemoryLayer with confidence scores.
   */
  async learn(
    projectId: string,
    files: FileContent[]
  ): Promise<LearnedConventions> {
    const conventions: LearnedConvention[] = [];

    // Use existing extractor if available
    if (this.extractor) {
      try {
        const result = await this.extractor.extractFromFiles(projectId, files);
        for (const conv of result.conventions) {
          conventions.push({
            category: conv.category,
            pattern: conv.pattern,
            description: conv.description,
            confidence: conv.confidence,
            examples: conv.examples,
            fileCount: conv.fileCount,
          });
        }
      } catch (err) {
        logger.warn(
          { err, projectId },
          "Existing extractor failed, using built-in analyzers"
        );
      }
    }

    // Run additional specialized analyzers
    conventions.push(...this.analyzeFileNamingPatterns(files));
    conventions.push(...this.analyzeImportOrdering(files));
    conventions.push(...this.analyzeErrorHandlingStyle(files));
    conventions.push(...this.analyzeComponentStructure(files));
    conventions.push(...this.analyzeTestOrganization(files));

    // Deduplicate by pattern
    const seen = new Set<string>();
    const unique = conventions.filter((c) => {
      if (seen.has(c.pattern)) {
        return false;
      }
      seen.add(c.pattern);
      return true;
    });

    // Filter to meaningful conventions (confidence >= 0.5)
    const meaningful = unique.filter((c) => c.confidence >= 0.5);

    // Store in convention memory
    for (const conv of meaningful) {
      await this.conventionMemory.store(projectId, {
        category: mapCategory(conv.category),
        pattern: conv.pattern,
        description: conv.description,
        confidence: conv.confidence,
        fileCount: conv.fileCount,
        examples: conv.examples,
      });
    }

    logger.info(
      {
        projectId,
        filesAnalyzed: files.length,
        conventionsLearned: meaningful.length,
        categories: [...new Set(meaningful.map((c) => c.category))],
      },
      "Convention learning complete"
    );

    return {
      conventions: meaningful,
      filesAnalyzed: files.length,
      learnedAt: new Date().toISOString(),
    };
  }

  // ---- Specialized Analyzers ----

  private analyzeFileNamingPatterns(files: FileContent[]): LearnedConvention[] {
    const conventions: LearnedConvention[] = [];
    const fileNames = files
      .filter((f) => CODE_FILE_EXT_RE.test(f.path))
      .map((f) => f.path.split("/").pop() ?? "");

    if (fileNames.length < 5) {
      return conventions;
    }

    const counts = {
      kebab: fileNames.filter((n) => KEBAB_CASE_FILE_RE.test(n)),
      camel: fileNames.filter((n) => CAMEL_CASE_FILE_RE.test(n)),
      snake: fileNames.filter((n) => SNAKE_CASE_FILE_RE.test(n)),
      pascal: fileNames.filter((n) => PASCAL_CASE_FILE_RE.test(n)),
    };

    const total = fileNames.length;
    const entries = Object.entries(counts) as [string, string[]][];
    entries.sort((a, b) => b[1].length - a[1].length);

    const [topStyle, topFiles] = entries[0] as [string, string[]];
    const ratio = topFiles.length / total;

    if (ratio >= 0.4 && topFiles.length >= 3) {
      const styleNames: Record<string, string> = {
        kebab: "kebab-case",
        camel: "camelCase",
        snake: "snake_case",
        pascal: "PascalCase",
      };

      conventions.push({
        category: "naming",
        pattern: `${topStyle}-case-files`,
        description: `Files use ${styleNames[topStyle] ?? topStyle} naming convention`,
        confidence: ratio,
        examples: topFiles.slice(0, 5),
        fileCount: topFiles.length,
      });
    }

    return conventions;
  }

  private analyzeImportOrdering(files: FileContent[]): LearnedConvention[] {
    const conventions: LearnedConvention[] = [];
    const codeFiles = files.filter((f) => CODE_FILE_EXT_RE.test(f.path));

    let externalFirstCount = 0;
    let analyzedCount = 0;

    for (const file of codeFiles) {
      const importLines = file.content.match(IMPORT_LINE_RE);
      if (!importLines || importLines.length < 3) {
        continue;
      }

      analyzedCount++;

      // Classify each import
      const classified = importLines.map((line) => {
        if (SCOPED_IMPORT_RE.test(line) || EXTERNAL_IMPORT_RE.test(line)) {
          return "external";
        }
        if (RELATIVE_IMPORT_RE.test(line)) {
          return "relative";
        }
        return "other";
      });

      // Check if external imports come before relative ones
      let lastExternalIdx = -1;
      let firstRelativeIdx = classified.length;

      for (let i = 0; i < classified.length; i++) {
        if (classified[i] === "external") {
          lastExternalIdx = i;
        }
        if (classified[i] === "relative" && i < firstRelativeIdx) {
          firstRelativeIdx = i;
        }
      }

      if (lastExternalIdx < firstRelativeIdx) {
        externalFirstCount++;
      }
    }

    if (analyzedCount >= 5) {
      const ratio = externalFirstCount / analyzedCount;
      if (ratio >= 0.6) {
        conventions.push({
          category: "import_style",
          pattern: "external-imports-first",
          description:
            "Imports are ordered: external/package imports first, then relative imports",
          confidence: ratio,
          examples: [
            'import { X } from "@prometheus/db" // external first',
            'import { Y } from "./utils" // relative after',
          ],
          fileCount: externalFirstCount,
        });
      }
    }

    return conventions;
  }

  private analyzeErrorHandlingStyle(files: FileContent[]): LearnedConvention[] {
    const conventions: LearnedConvention[] = [];
    const codeFiles = files.filter((f) => CODE_FILE_EXT_RE.test(f.path));

    let instanceofCheckCount = 0;
    let customErrorClassCount = 0;
    let _throwNewErrorCount = 0;
    let tryCatchFileCount = 0;

    for (const file of codeFiles) {
      const tryCatches = file.content.match(TRY_CATCH_RE);
      if (tryCatches && tryCatches.length > 0) {
        tryCatchFileCount++;
      }

      if (CATCH_ERR_INSTANCE_RE.test(file.content)) {
        instanceofCheckCount++;
      }

      const customErrors = file.content.match(EXTENDS_ERROR_RE);
      if (customErrors) {
        customErrorClassCount += customErrors.length;
      }

      const throwNew = file.content.match(THROW_NEW_RE);
      if (throwNew) {
        _throwNewErrorCount += throwNew.length;
      }
    }

    if (instanceofCheckCount >= 3 && tryCatchFileCount > 0) {
      conventions.push({
        category: "error_handling",
        pattern: "instanceof-error-guard",
        description:
          "Uses instanceof Error type guards in catch blocks for safe error access",
        confidence: Math.min(instanceofCheckCount / tryCatchFileCount, 1),
        examples: [
          "catch (err) { const msg = err instanceof Error ? err.message : String(err) }",
        ],
        fileCount: instanceofCheckCount,
      });
    }

    if (customErrorClassCount >= 2) {
      conventions.push({
        category: "error_handling",
        pattern: "custom-error-classes",
        description:
          "Defines custom Error subclasses for domain-specific error handling",
        confidence: Math.min(customErrorClassCount / 5, 1),
        examples: ["class NotFoundError extends Error { ... }"],
        fileCount: customErrorClassCount,
      });
    }

    return conventions;
  }

  private analyzeComponentStructure(files: FileContent[]): LearnedConvention[] {
    const conventions: LearnedConvention[] = [];
    const tsxFiles = files.filter(
      (f) => f.path.endsWith(".tsx") || f.path.endsWith(".jsx")
    );

    if (tsxFiles.length < 3) {
      return conventions;
    }

    let functionalCount = 0;
    let classCount = 0;
    let hookUsageCount = 0;

    for (const file of tsxFiles) {
      const functional = file.content.match(FUNCTIONAL_COMPONENT_RE);
      const classBased = file.content.match(CLASS_COMPONENT_RE);
      const hooks = file.content.match(USE_HOOK_RE);

      functionalCount += functional?.length ?? 0;
      classCount += classBased?.length ?? 0;
      hookUsageCount += hooks?.length ?? 0;
    }

    const totalComponents = functionalCount + classCount;
    if (totalComponents >= 3 && functionalCount > classCount) {
      conventions.push({
        category: "code_pattern",
        pattern: "functional-components",
        description:
          "React components use functional style with hooks instead of class components",
        confidence: functionalCount / Math.max(totalComponents, 1),
        examples: [
          "const MyComponent: React.FC = () => { ... }",
          "function MyComponent() { ... }",
        ],
        fileCount: tsxFiles.length,
      });
    }

    if (hookUsageCount >= 5) {
      conventions.push({
        category: "code_pattern",
        pattern: "react-hooks-pattern",
        description: "Uses React hooks (useState, useEffect, custom hooks)",
        confidence: Math.min(hookUsageCount / (tsxFiles.length * 2), 1),
        examples: [
          "const [state, setState] = useState()",
          "useEffect(() => { ... }, [])",
        ],
        fileCount: tsxFiles.length,
      });
    }

    return conventions;
  }

  private analyzeTestOrganization(files: FileContent[]): LearnedConvention[] {
    const conventions: LearnedConvention[] = [];
    const testFiles = files.filter((f) => TEST_FILE_RE.test(f.path));

    if (testFiles.length < 3) {
      return conventions;
    }

    let describeItCount = 0;
    let testFnCount = 0;
    let colocatedCount = 0;
    let testsDirCount = 0;

    for (const file of testFiles) {
      const describes = file.content.match(DESCRIBE_BLOCK_RE);
      const its = file.content.match(IT_BLOCK_RE);
      const tests = file.content.match(TEST_BLOCK_RE);

      describeItCount += (describes?.length ?? 0) + (its?.length ?? 0);
      testFnCount += tests?.length ?? 0;

      if (TESTS_DIR_RE.test(file.path)) {
        testsDirCount++;
      } else {
        // Check if co-located (same directory as source)
        const dir = file.path.split("/").slice(0, -1).join("/");
        const hasSourceInSameDir = files.some(
          (f) =>
            !TEST_FILE_RE.test(f.path) &&
            f.path.startsWith(`${dir}/`) &&
            f.path.split("/").length === file.path.split("/").length
        );
        if (hasSourceInSameDir) {
          colocatedCount++;
        }
      }
    }

    // Test style: describe/it vs test()
    const totalTestBlocks = describeItCount + testFnCount;
    if (totalTestBlocks >= 5) {
      if (describeItCount > testFnCount) {
        conventions.push({
          category: "testing",
          pattern: "describe-it-test-style",
          description: "Tests use describe/it block style for organization",
          confidence: describeItCount / totalTestBlocks,
          examples: [
            'describe("Feature", () => { it("should work", () => { ... }) })',
          ],
          fileCount: testFiles.length,
        });
      } else if (testFnCount > describeItCount) {
        conventions.push({
          category: "testing",
          pattern: "flat-test-style",
          description: "Tests use flat test() function style",
          confidence: testFnCount / totalTestBlocks,
          examples: ['test("should work", () => { ... })'],
          fileCount: testFiles.length,
        });
      }
    }

    // Test location
    if (colocatedCount > testsDirCount && colocatedCount >= 2) {
      conventions.push({
        category: "testing",
        pattern: "colocated-tests",
        description: "Test files are co-located next to source files",
        confidence: colocatedCount / testFiles.length,
        examples: ["src/utils.ts + src/utils.test.ts"],
        fileCount: colocatedCount,
      });
    } else if (testsDirCount > colocatedCount && testsDirCount >= 2) {
      conventions.push({
        category: "testing",
        pattern: "tests-directory",
        description: "Test files are placed in __tests__ directories",
        confidence: testsDirCount / testFiles.length,
        examples: ["src/__tests__/utils.test.ts"],
        fileCount: testsDirCount,
      });
    }

    return conventions;
  }
}

/**
 * Map convention categories to the DB enum values used by ConventionMemoryLayer.
 */
function mapCategory(category: string): string {
  const mapping: Record<string, string> = {
    naming: "naming",
    file_structure: "structure",
    import_style: "imports",
    error_handling: "error_handling",
    logging: "other",
    testing: "testing",
    type_usage: "other",
    export_style: "other",
    code_pattern: "other",
  };
  return mapping[category] ?? "other";
}
