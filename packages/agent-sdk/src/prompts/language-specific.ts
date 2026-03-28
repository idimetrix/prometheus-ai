/**
 * Language-specific configuration and prompt templates.
 *
 * When the agent detects a project's primary language, these templates
 * provide setup commands, test commands, build commands, and coding
 * conventions specific to that language ecosystem.
 */

export interface LanguageConfig {
  /** Command to build / compile the project */
  buildCommand: string;
  /** Common conventions and best practices */
  conventions: string;
  /** Common file patterns for this language */
  filePatterns: string[];
  /** Language display name */
  name: string;
  /** Command to install dependencies */
  setup: string;
  /** Command to run tests */
  testCommand: string;
}

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  typescript: {
    name: "TypeScript",
    setup: "npm install",
    testCommand: "npx vitest run",
    buildCommand: "npx tsc --noEmit",
    filePatterns: ["**/*.ts", "**/*.tsx"],
    conventions: `- Use strict TypeScript (no 'any' unless necessary)
- Prefer interfaces over type aliases for object shapes
- Use async/await over raw promises
- Use const assertions for literal types
- Prefer named exports over default exports`,
  },
  javascript: {
    name: "JavaScript",
    setup: "npm install",
    testCommand: "npx jest",
    buildCommand: "node --check",
    filePatterns: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    conventions: `- Use ES modules (import/export) over CommonJS
- Use const/let, never var
- Use arrow functions for callbacks
- Handle errors with try/catch in async code`,
  },
  python: {
    name: "Python",
    setup: "pip install -r requirements.txt",
    testCommand: "pytest",
    buildCommand: "python -m py_compile",
    filePatterns: ["**/*.py"],
    conventions: `- Follow PEP 8 style guide
- Use type hints for function signatures
- Use f-strings over format() or %
- Use pathlib over os.path
- Use dataclasses or Pydantic for data models`,
  },
  go: {
    name: "Go",
    setup: "go mod download",
    testCommand: "go test ./...",
    buildCommand: "go build ./...",
    filePatterns: ["**/*.go"],
    conventions: `- Follow Effective Go guidelines
- Use error wrapping with fmt.Errorf and %w
- Keep interfaces small (1-3 methods)
- Use table-driven tests
- Capitalize exported names`,
  },
  rust: {
    name: "Rust",
    setup: "cargo fetch",
    testCommand: "cargo test",
    buildCommand: "cargo build",
    filePatterns: ["**/*.rs"],
    conventions: `- Follow Rust API guidelines
- Use Result<T, E> for fallible operations
- Prefer &str over String in function parameters
- Use derive macros for common traits
- Handle all match arms explicitly`,
  },
  ruby: {
    name: "Ruby",
    setup: "bundle install",
    testCommand: "bundle exec rspec",
    buildCommand: "ruby -c",
    filePatterns: ["**/*.rb"],
    conventions: `- Follow Ruby Style Guide
- Use frozen_string_literal: true pragma
- Prefer symbols over strings for hash keys
- Use snake_case for methods and variables`,
  },
  java: {
    name: "Java",
    setup: "mvn install -DskipTests",
    testCommand: "mvn test",
    buildCommand: "mvn compile",
    filePatterns: ["**/*.java"],
    conventions: `- Follow Google Java Style Guide
- Use Optional<T> instead of null returns
- Use records for data transfer objects
- Prefer composition over inheritance
- Use var for local variables when type is obvious`,
  },
  php: {
    name: "PHP",
    setup: "composer install",
    testCommand: "vendor/bin/phpunit",
    buildCommand: "php -l",
    filePatterns: ["**/*.php"],
    conventions: `- Follow PSR-12 coding standard
- Use strict_types declaration
- Use type declarations for parameters and return types
- Use named arguments for clarity`,
  },
  swift: {
    name: "Swift",
    setup: "swift package resolve",
    testCommand: "swift test",
    buildCommand: "swift build",
    filePatterns: ["**/*.swift"],
    conventions: `- Follow Swift API Design Guidelines
- Use guard for early returns
- Prefer value types (struct) over reference types (class)
- Use protocol-oriented programming`,
  },
  kotlin: {
    name: "Kotlin",
    setup: "gradle dependencies",
    testCommand: "gradle test",
    buildCommand: "gradle build",
    filePatterns: ["**/*.kt"],
    conventions: `- Follow Kotlin coding conventions
- Use data classes for simple models
- Use sealed classes for restricted hierarchies
- Prefer extension functions over utility classes`,
  },
};

const MANIFEST_INDICATORS: Record<string, string[]> = {
  typescript: ["tsconfig.json", "package.json"],
  python: [
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "Pipfile",
    "poetry.lock",
  ],
  go: ["go.mod", "go.sum"],
  rust: ["Cargo.toml", "Cargo.lock"],
  ruby: ["Gemfile", "Rakefile", ".ruby-version"],
  java: ["pom.xml", "build.gradle", "build.gradle.kts"],
  php: ["composer.json"],
  swift: ["Package.swift"],
  kotlin: ["build.gradle.kts"],
};

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
};

function detectByManifest(files: string[]): string | null {
  for (const [lang, manifests] of Object.entries(MANIFEST_INDICATORS)) {
    for (const manifest of manifests) {
      if (files.some((f) => f.endsWith(manifest))) {
        if (lang === "typescript") {
          return files.some((f) => f.endsWith("tsconfig.json"))
            ? "typescript"
            : "javascript";
        }
        return lang;
      }
    }
  }
  return null;
}

function detectByExtension(files: string[]): string {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const ext = file.slice(file.lastIndexOf("."));
    const lang = EXT_TO_LANG[ext];
    if (lang) {
      counts[lang] = (counts[lang] ?? 0) + 1;
    }
  }
  let best = "typescript";
  let max = 0;
  for (const [lang, count] of Object.entries(counts)) {
    if (count > max) {
      best = lang;
      max = count;
    }
  }
  return best;
}

/**
 * Detect the primary language of a project from its file listing.
 */
export function detectLanguage(files: string[]): string {
  return detectByManifest(files) ?? detectByExtension(files);
}

/**
 * Get the language-specific system prompt section for the agent.
 */
export function getLanguagePrompt(language: string): string {
  const config = LANGUAGE_CONFIGS[language];
  if (!config) {
    return "";
  }

  return `## Language: ${config.name}

### Setup
\`${config.setup}\`

### Build
\`${config.buildCommand}\`

### Test
\`${config.testCommand}\`

### Conventions
${config.conventions}`;
}
