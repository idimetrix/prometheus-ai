/**
 * Language Detector
 *
 * Detects the primary and secondary programming languages used in a project
 * by analyzing file extensions, config files, and package manifests.
 * Used to inject language-specific context into agent prompts.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:context:language-detector");

export interface LanguageDetectionResult {
  /** All detected languages with file counts */
  breakdown: Record<string, number>;
  /** Build tool / package manager detected */
  buildTool: string | null;
  /** Linter/formatter detected */
  linter: string | null;
  /** Primary language of the project */
  primary: string;
  /** Secondary languages detected */
  secondary: string[];
  /** Test framework detected */
  testFramework: string | null;
}

/** Extension-to-language mapping */
const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".pyx": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".cpp": "c++",
  ".cc": "c++",
  ".cxx": "c++",
  ".c": "c++",
  ".h": "c++",
  ".hpp": "c++",
  ".cs": "csharp",
  ".scala": "scala",
  ".ex": "elixir",
  ".exs": "elixir",
  ".zig": "zig",
  ".lua": "lua",
  ".dart": "dart",
};

/** Config file indicators for build tools */
const BUILD_TOOL_INDICATORS: Record<string, string> = {
  "package.json": "npm/pnpm/yarn",
  "Cargo.toml": "cargo",
  "go.mod": "go modules",
  "pyproject.toml": "python (pyproject)",
  "setup.py": "python (setuptools)",
  "requirements.txt": "python (pip)",
  Pipfile: "python (pipenv)",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle (kotlin)",
  "pom.xml": "maven",
  Gemfile: "bundler",
  "composer.json": "composer",
  "CMakeLists.txt": "cmake",
  Makefile: "make",
  "Package.swift": "swift package manager",
};

/** Config file indicators for test frameworks */
const TEST_FRAMEWORK_INDICATORS: Record<string, string> = {
  "vitest.config.ts": "vitest",
  "vitest.config.js": "vitest",
  "jest.config.ts": "jest",
  "jest.config.js": "jest",
  "playwright.config.ts": "playwright",
  "pytest.ini": "pytest",
  "pyproject.toml": "pytest",
  "conftest.py": "pytest",
  "Cargo.toml": "cargo test",
  "build.gradle": "junit",
};

/** Config file indicators for linters/formatters */
const LINTER_INDICATORS: Record<string, string> = {
  "biome.json": "biome",
  "biome.jsonc": "biome",
  ".eslintrc": "eslint",
  ".eslintrc.js": "eslint",
  ".eslintrc.json": "eslint",
  "ruff.toml": "ruff",
  ".golangci.yml": "golangci-lint",
  "clippy.toml": "clippy",
  "rustfmt.toml": "rustfmt",
  ".rubocop.yml": "rubocop",
  "phpstan.neon": "phpstan",
  "checkstyle.xml": "checkstyle",
  ".clang-format": "clang-format",
};

/** Regex to extract file extension from a path */
const FILE_EXTENSION_RE = /\.[^.]+$/;

interface ToolingDetection {
  buildTool: string | null;
  linter: string | null;
  testFramework: string | null;
}

/**
 * Detect build tool, test framework, and linter from config file names.
 */
function detectTooling(filePaths: string[]): ToolingDetection {
  let buildTool: string | null = null;
  let testFramework: string | null = null;
  let linter: string | null = null;

  for (const filePath of filePaths) {
    const fileName = filePath.split("/").pop() ?? "";

    if (!buildTool && BUILD_TOOL_INDICATORS[fileName]) {
      buildTool = BUILD_TOOL_INDICATORS[fileName] ?? null;
    }
    if (!testFramework && TEST_FRAMEWORK_INDICATORS[fileName]) {
      testFramework = TEST_FRAMEWORK_INDICATORS[fileName] ?? null;
    }
    if (!linter && LINTER_INDICATORS[fileName]) {
      linter = LINTER_INDICATORS[fileName] ?? null;
    }
  }

  return { buildTool, testFramework, linter };
}

/**
 * Count language occurrences by file extension.
 */
function countLanguages(filePaths: string[]): Record<string, number> {
  const breakdown: Record<string, number> = {};

  for (const filePath of filePaths) {
    const extMatch = FILE_EXTENSION_RE.exec(filePath);
    const ext = extMatch?.[0];
    if (ext) {
      const language = EXTENSION_MAP[ext];
      if (language) {
        breakdown[language] = (breakdown[language] ?? 0) + 1;
      }
    }
  }

  return breakdown;
}

/**
 * Detect programming languages from a list of file paths.
 */
export function detectLanguages(filePaths: string[]): LanguageDetectionResult {
  const breakdown = countLanguages(filePaths);
  const { buildTool, testFramework, linter } = detectTooling(filePaths);

  // Sort languages by file count
  const sorted = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  const primary = sorted[0]?.[0] ?? "typescript";
  const secondary = sorted
    .slice(1)
    .filter(([, count]) => count >= 2)
    .map(([lang]) => lang);

  logger.info(
    { primary, secondary, buildTool, testFramework, linter },
    "Language detection complete"
  );

  return {
    primary,
    secondary,
    breakdown,
    buildTool,
    testFramework,
    linter,
  };
}

/**
 * Detect language from a single file path.
 */
export function detectFileLanguage(filePath: string): string {
  const extMatch = FILE_EXTENSION_RE.exec(filePath);
  const ext = extMatch?.[0];
  if (ext) {
    return EXTENSION_MAP[ext] ?? "unknown";
  }
  return "unknown";
}
