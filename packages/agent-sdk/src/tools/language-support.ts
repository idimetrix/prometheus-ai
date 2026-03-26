/**
 * Multi-Language Project Support (MOON-015)
 *
 * Language-specific tool configurations for detecting project languages,
 * resolving package managers, test runners, linters, build tools, and
 * frameworks across TypeScript, Python, Go, Rust, and Java ecosystems.
 */

// ---------------------------------------------------------------------------
// Language configuration definitions
// ---------------------------------------------------------------------------

export const LANGUAGE_CONFIGS = {
  typescript: {
    packageManager: ["npm", "pnpm", "yarn", "bun"] as const,
    testRunners: ["vitest", "jest", "mocha"] as const,
    linters: ["eslint", "biome"] as const,
    buildTools: ["tsc", "esbuild", "vite", "webpack"] as const,
    frameworks: ["next.js", "express", "hono", "fastify", "nest.js"] as const,
  },
  python: {
    packageManager: ["pip", "poetry", "pipenv", "conda", "uv"] as const,
    testRunners: ["pytest", "unittest"] as const,
    linters: ["ruff", "pylint", "flake8", "mypy"] as const,
    buildTools: ["setuptools", "poetry", "hatch"] as const,
    frameworks: ["django", "fastapi", "flask", "starlette"] as const,
  },
  go: {
    packageManager: ["go mod"] as const,
    testRunners: ["go test"] as const,
    linters: ["golangci-lint", "staticcheck"] as const,
    buildTools: ["go build"] as const,
    frameworks: ["gin", "echo", "fiber", "chi"] as const,
  },
  rust: {
    packageManager: ["cargo"] as const,
    testRunners: ["cargo test"] as const,
    linters: ["clippy"] as const,
    buildTools: ["cargo build"] as const,
    frameworks: ["actix-web", "axum", "rocket", "warp"] as const,
  },
  java: {
    packageManager: ["maven", "gradle"] as const,
    testRunners: ["junit", "testng"] as const,
    linters: ["checkstyle", "spotbugs"] as const,
    buildTools: ["maven", "gradle"] as const,
    frameworks: ["spring-boot", "quarkus", "micronaut"] as const,
  },
} as const;

export type SupportedLanguage = keyof typeof LANGUAGE_CONFIGS;

export type LanguageConfig =
  (typeof LANGUAGE_CONFIGS)[keyof typeof LANGUAGE_CONFIGS];

// ---------------------------------------------------------------------------
// File-to-language detection mapping
// ---------------------------------------------------------------------------

const LANGUAGE_INDICATORS: Record<SupportedLanguage, string[]> = {
  typescript: [
    "package.json",
    "tsconfig.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    "bun.lockb",
    ".ts",
    ".tsx",
  ],
  python: [
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "Pipfile",
    "poetry.lock",
    ".py",
    ".pyi",
  ],
  go: ["go.mod", "go.sum", ".go"],
  rust: ["Cargo.toml", "Cargo.lock", ".rs"],
  java: ["pom.xml", "build.gradle", "build.gradle.kts", ".java", ".kt"],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect languages present in a project based on file names.
 * Returns an array of detected language identifiers, sorted by
 * confidence (number of matching indicators).
 */
export function detectLanguage(files: string[]): SupportedLanguage[] {
  const scores = new Map<SupportedLanguage, number>();

  for (const file of files) {
    const basename = file.split("/").pop() ?? file;

    for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
      const language = lang as SupportedLanguage;
      for (const indicator of indicators) {
        if (
          basename === indicator ||
          (indicator.startsWith(".") && basename.endsWith(indicator))
        ) {
          scores.set(language, (scores.get(language) ?? 0) + 1);
        }
      }
    }
  }

  // Sort by score descending
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

/**
 * Get the full configuration for a detected language.
 * Returns undefined if the language is not supported.
 */
export function getLanguageConfig(
  language: string
): LanguageConfig | undefined {
  const key = language.toLowerCase() as SupportedLanguage;
  return LANGUAGE_CONFIGS[key] as LanguageConfig | undefined;
}

/**
 * Get the shell command to run tests for a given language and runner.
 */
export function getTestCommand(language: string, runner: string): string {
  const commands: Record<string, Record<string, string>> = {
    typescript: {
      vitest: "npx vitest run",
      jest: "npx jest",
      mocha: "npx mocha",
    },
    python: {
      pytest: "python -m pytest",
      unittest: "python -m unittest discover",
    },
    go: {
      "go test": "go test ./...",
    },
    rust: {
      "cargo test": "cargo test",
    },
    java: {
      junit: "mvn test",
      testng: "mvn test",
    },
  };

  const lang = language.toLowerCase();
  const runnerLower = runner.toLowerCase();
  return commands[lang]?.[runnerLower] ?? `${runner}`;
}

/**
 * Get the shell command to run linting for a given language and linter.
 */
export function getLintCommand(language: string, linter: string): string {
  const commands: Record<string, Record<string, string>> = {
    typescript: {
      eslint: "npx eslint .",
      biome: "npx biome check .",
    },
    python: {
      ruff: "ruff check .",
      pylint: "pylint **/*.py",
      flake8: "flake8 .",
      mypy: "mypy .",
    },
    go: {
      "golangci-lint": "golangci-lint run",
      staticcheck: "staticcheck ./...",
    },
    rust: {
      clippy: "cargo clippy -- -D warnings",
    },
    java: {
      checkstyle: "mvn checkstyle:check",
      spotbugs: "mvn spotbugs:check",
    },
  };

  const lang = language.toLowerCase();
  const linterLower = linter.toLowerCase();
  return commands[lang]?.[linterLower] ?? `${linter}`;
}

/**
 * Get the shell command to build a project for a given language and tool.
 */
export function getBuildCommand(language: string, tool: string): string {
  const commands: Record<string, Record<string, string>> = {
    typescript: {
      tsc: "npx tsc --build",
      esbuild: "npx esbuild src/index.ts --bundle --outdir=dist",
      vite: "npx vite build",
      webpack: "npx webpack --mode production",
    },
    python: {
      setuptools: "python -m build",
      poetry: "poetry build",
      hatch: "hatch build",
    },
    go: {
      "go build": "go build ./...",
    },
    rust: {
      "cargo build": "cargo build --release",
    },
    java: {
      maven: "mvn package -DskipTests",
      gradle: "gradle build -x test",
    },
  };

  const lang = language.toLowerCase();
  const toolLower = tool.toLowerCase();
  return commands[lang]?.[toolLower] ?? `${tool}`;
}
