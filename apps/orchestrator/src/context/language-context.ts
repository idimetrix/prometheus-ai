/**
 * Language Context Provider
 *
 * Builds language-specific context sections for agent prompts based on
 * the detected project languages. Integrates with the language-variants
 * guidelines from @prometheus/agent-sdk.
 */

import { createLogger } from "@prometheus/logger";
import type { LanguageDetectionResult } from "./language-detector";

const logger = createLogger("orchestrator:context:language-context");

export interface LanguageContext {
  /** Build/test command recommendations */
  commandHints: string;
  /** Full combined context string to inject into prompts */
  fullContext: string;
  /** The primary language guidelines section */
  primaryGuidelines: string;
  /** Additional context for secondary languages */
  secondaryGuidelines: string[];
}

/** Test commands per language/framework */
const TEST_COMMANDS: Record<string, string> = {
  vitest: "pnpm vitest run",
  jest: "pnpm jest",
  playwright: "pnpm playwright test",
  pytest: "pytest -v",
  "cargo test": "cargo test",
  junit: "./gradlew test",
  go: "go test ./...",
};

/** Build commands per build tool */
const BUILD_COMMANDS: Record<string, string> = {
  "npm/pnpm/yarn": "pnpm build",
  cargo: "cargo build",
  "go modules": "go build ./...",
  "python (pyproject)": "pip install -e .",
  "python (setuptools)": "python setup.py build",
  "python (pip)": "pip install -r requirements.txt",
  "python (pipenv)": "pipenv install",
  gradle: "./gradlew build",
  "gradle (kotlin)": "./gradlew build",
  maven: "mvn compile",
  bundler: "bundle install",
  composer: "composer install",
  cmake: "cmake --build .",
  make: "make",
  "swift package manager": "swift build",
};

/** Lint commands per linter */
const LINT_COMMANDS: Record<string, string> = {
  biome: "pnpm biome check --apply",
  eslint: "pnpm eslint --fix .",
  ruff: "ruff check --fix .",
  "golangci-lint": "golangci-lint run",
  clippy: "cargo clippy --fix",
  rustfmt: "cargo fmt",
  rubocop: "rubocop -a",
  phpstan: "phpstan analyse",
  checkstyle: "checkstyle -c /checkstyle.xml src/",
  "clang-format": 'find . -name "*.cpp" | xargs clang-format -i',
};

/**
 * Build language-specific context for agent prompts from detection results.
 */
export function buildLanguageContext(
  detection: LanguageDetectionResult
): LanguageContext {
  const primaryGuidelines = getLanguageSection(detection.primary);
  const secondaryGuidelines = detection.secondary.map(getLanguageSection);

  const commandHints = buildCommandHints(detection);

  const parts: string[] = [
    "## Language Context",
    "",
    `Primary language: **${detection.primary}**`,
  ];

  if (detection.secondary.length > 0) {
    parts.push(`Secondary languages: ${detection.secondary.join(", ")}`);
  }

  parts.push("", primaryGuidelines);

  if (secondaryGuidelines.length > 0) {
    parts.push("", "### Additional Language Notes");
    for (const sg of secondaryGuidelines) {
      parts.push("", sg);
    }
  }

  if (commandHints) {
    parts.push("", commandHints);
  }

  const fullContext = parts.join("\n");

  logger.debug(
    {
      primary: detection.primary,
      contextLength: fullContext.length,
    },
    "Language context built"
  );

  return {
    primaryGuidelines,
    secondaryGuidelines,
    commandHints,
    fullContext,
  };
}

/**
 * Get a language-specific guidelines section.
 * Returns idiomatic patterns and best practices for the language.
 */
function getLanguageSection(language: string): string {
  const sections: Record<string, string> = {
    typescript: `### TypeScript
- Use strict mode, prefer \`unknown\` over \`any\`
- Use \`as const\` for literal types, \`satisfies\` for type validation
- Import types with \`import type { ... }\`
- Handle async errors with try/catch, never leave promises unhandled
- Format with Biome; lint with Biome or ESLint`,

    python: `### Python
- Target Python 3.11+, use type hints on all signatures
- Use \`dataclasses\` or \`pydantic\` for structured data
- Use \`pathlib.Path\` for file operations
- Format with \`ruff format\`; lint with \`ruff check\`
- Use \`logging\` module, not \`print()\``,

    go: `### Go
- Return errors as last value, check immediately
- Use \`context.Context\` as first param for I/O functions
- Prefer table-driven tests with \`t.Run()\`
- Use \`golangci-lint\` for linting; \`gofmt\` for formatting
- Keep interfaces small (1-3 methods)`,

    rust: `### Rust
- Use \`Result<T, E>\` for fallible operations, avoid \`.unwrap()\`
- Use \`?\` operator for error propagation
- Prefer iterators over manual loops
- Use \`clippy\` for linting; \`rustfmt\` for formatting
- Derive Debug, Clone, PartialEq as baseline`,

    java: `### Java
- Target Java 21+, use records and sealed interfaces
- Use \`Optional<T>\` for nullable returns
- Use \`try-with-resources\` for AutoCloseable
- Format with \`google-java-format\`; lint with Error Prone
- Use SLF4J for logging, never \`System.out.println\``,

    kotlin: `### Kotlin
- Use \`data class\` for value objects, \`sealed class\` for ADTs
- Prefer \`val\` over \`var\`, immutable collections by default
- Use \`suspend\` functions and \`Flow\` for async
- Format with \`ktlint\`; lint with \`detekt\``,

    ruby: `### Ruby
- Use frozen string literal comment at file top
- Prefer \`&.\` for nil-safe chains
- Use \`Struct\` or \`Data\` for value objects
- Format with \`rubocop\``,

    php: `### PHP
- Target PHP 8.2+, use strict types
- Use \`match\` over \`switch\` for value-returning conditionals
- Use \`readonly\` properties for immutable data
- Lint with PHPStan level 9`,
  };

  return (
    sections[language] ??
    `### ${language}\n- Follow official style guide and idioms`
  );
}

/**
 * Build command hints based on detected tooling.
 */
function buildCommandHints(detection: LanguageDetectionResult): string {
  const hints: string[] = ["### Available Commands"];

  if (detection.buildTool) {
    const cmd = BUILD_COMMANDS[detection.buildTool];
    if (cmd) {
      hints.push(`- **Build:** \`${cmd}\``);
    }
  }

  if (detection.testFramework) {
    const cmd = TEST_COMMANDS[detection.testFramework];
    if (cmd) {
      hints.push(`- **Test:** \`${cmd}\``);
    }
  }

  if (detection.linter) {
    const cmd = LINT_COMMANDS[detection.linter];
    if (cmd) {
      hints.push(`- **Lint:** \`${cmd}\``);
    }
  }

  if (hints.length <= 1) {
    return "";
  }

  return hints.join("\n");
}
