/**
 * Tech stack auto-detection from repository file contents.
 *
 * Given a list of file paths (relative to repository root) this module
 * infers languages, frameworks, package managers, monorepo layout, and
 * suggests the closest preset from the built-in presets catalogue.
 */

const DJANGO_RE = /\bdjango\b/i;
const FLASK_RE = /\bflask\b/i;
const FASTAPI_RE = /\bfastapi\b/i;

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface TechStackResult {
  /** Detected build command (best guess) */
  buildCommand: string;
  /** Detected dev command (best guess) */
  devCommand: string;
  /** Detected application frameworks (e.g. "next", "django", "express") */
  frameworks: string[];
  /** Whether the repo appears to be a monorepo */
  isMonorepo: boolean;
  /** Detected programming languages */
  languages: string[];
  /** Primary package manager detected */
  packageManager: string;
  /** ID of the closest built-in TechStackPreset */
  suggestedPreset: string;
  /** Detected test command (best guess) */
  testCommand: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hasFile(files: string[], name: string): boolean {
  return files.some((f) => f === name || f.endsWith(`/${name}`));
}

function findFile(files: string[], name: string): string | undefined {
  return files.find((f) => f === name || f.endsWith(`/${name}`));
}

/** Very small JSON parser that silently returns undefined on error. */
function tryParseJson(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Check whether `deps` object contains a key that starts with `prefix`. */
function depsContain(
  deps: Record<string, unknown> | undefined,
  prefix: string
): boolean {
  if (!deps) {
    return false;
  }
  return Object.keys(deps).some(
    (k) => k === prefix || k.startsWith(`${prefix}/`)
  );
}

// ---------------------------------------------------------------------------
// Content readers – when content map is supplied we can inspect file bodies
// ---------------------------------------------------------------------------

type ContentMap = Record<string, string>;

function detectNodeFrameworks(content: ContentMap, files: string[]): string[] {
  const pkgFile = findFile(files, "package.json");
  if (!pkgFile) {
    return [];
  }

  const raw = content[pkgFile];
  if (!raw) {
    return [];
  }

  const pkg = tryParseJson(raw);
  if (!pkg) {
    return [];
  }

  const allDeps: Record<string, unknown> = {
    ...(pkg.dependencies as Record<string, unknown> | undefined),
    ...(pkg.devDependencies as Record<string, unknown> | undefined),
  };

  const frameworks: string[] = [];

  if (depsContain(allDeps, "next")) {
    frameworks.push("next");
  }
  if (depsContain(allDeps, "react") && !frameworks.includes("next")) {
    frameworks.push("react");
  }
  if (depsContain(allDeps, "vue")) {
    frameworks.push("vue");
  }
  if (depsContain(allDeps, "@angular/core")) {
    frameworks.push("angular");
  }
  if (depsContain(allDeps, "express")) {
    frameworks.push("express");
  }
  if (depsContain(allDeps, "fastify")) {
    frameworks.push("fastify");
  }
  if (depsContain(allDeps, "hono")) {
    frameworks.push("hono");
  }
  if (depsContain(allDeps, "svelte") || depsContain(allDeps, "@sveltejs/kit")) {
    frameworks.push("svelte");
  }
  if (depsContain(allDeps, "nuxt")) {
    frameworks.push("nuxt");
  }
  if (depsContain(allDeps, "remix") || depsContain(allDeps, "@remix-run")) {
    frameworks.push("remix");
  }
  if (depsContain(allDeps, "astro")) {
    frameworks.push("astro");
  }
  if (depsContain(allDeps, "expo")) {
    frameworks.push("expo");
  }
  if (depsContain(allDeps, "react-native")) {
    frameworks.push("react-native");
  }

  return frameworks;
}

function detectPythonFrameworks(
  content: ContentMap,
  files: string[]
): string[] {
  const frameworks: string[] = [];

  const requirementsFile = findFile(files, "requirements.txt");
  const pyprojectFile = findFile(files, "pyproject.toml");

  const searchText = [
    requirementsFile ? (content[requirementsFile] ?? "") : "",
    pyprojectFile ? (content[pyprojectFile] ?? "") : "",
  ].join("\n");

  if (DJANGO_RE.test(searchText)) {
    frameworks.push("django");
  }
  if (FLASK_RE.test(searchText)) {
    frameworks.push("flask");
  }
  if (FASTAPI_RE.test(searchText)) {
    frameworks.push("fastapi");
  }

  return frameworks;
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

const LOCKFILE_TO_PM: [string[], string][] = [
  [["pnpm-lock.yaml"], "pnpm"],
  [["yarn.lock"], "yarn"],
  [["bun.lockb", "bun.lock"], "bun"],
  [["package-lock.json"], "npm"],
  [["Pipfile.lock", "Pipfile"], "pipenv"],
  [["poetry.lock"], "poetry"],
  [["requirements.txt", "setup.py"], "pip"],
  [["Cargo.lock", "Cargo.toml"], "cargo"],
  [["go.sum", "go.mod"], "go"],
  [["Gemfile.lock", "Gemfile"], "bundler"],
  [["composer.lock", "composer.json"], "composer"],
  [["pubspec.lock", "pubspec.yaml"], "pub"],
  [["Package.swift"], "swift"],
  [["package.json"], "npm"],
];

function detectPackageManager(files: string[]): string {
  for (const [indicators, pm] of LOCKFILE_TO_PM) {
    if (indicators.some((f) => hasFile(files, f))) {
      return pm;
    }
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Monorepo detection
// ---------------------------------------------------------------------------

function detectMonorepo(files: string[]): boolean {
  return (
    hasFile(files, "pnpm-workspace.yaml") ||
    hasFile(files, "lerna.json") ||
    hasFile(files, "nx.json") ||
    hasFile(files, "turbo.json")
  );
}

// ---------------------------------------------------------------------------
// Suggested preset matching
// ---------------------------------------------------------------------------

function matchPresetByFramework(
  fwSet: Set<string>,
  langSet: Set<string>
): string | null {
  if (fwSet.has("next") || fwSet.has("react")) {
    return langSet.has("python") ? "django-react" : "modern-saas";
  }
  if (fwSet.has("django") || fwSet.has("flask") || fwSet.has("fastapi")) {
    return "django-react";
  }
  if (fwSet.has("vue") || fwSet.has("nuxt")) {
    return langSet.has("php") ? "laravel-vue" : "fullstack-minimal";
  }
  if (
    fwSet.has("angular") ||
    fwSet.has("svelte") ||
    fwSet.has("remix") ||
    fwSet.has("astro")
  ) {
    return "fullstack-minimal";
  }
  if (fwSet.has("expo") || fwSet.has("react-native")) {
    return "react-native";
  }
  return null;
}

const LANG_TO_PRESET: Record<string, string> = {
  ruby: "rails",
  go: "go-microservices",
  rust: "rust-backend",
  php: "laravel-vue",
  typescript: "fullstack-minimal",
  javascript: "fullstack-minimal",
};

function matchPreset(languages: string[], frameworks: string[]): string {
  const langSet = new Set(languages.map((l) => l.toLowerCase()));
  const fwSet = new Set(frameworks.map((f) => f.toLowerCase()));

  const fwMatch = matchPresetByFramework(fwSet, langSet);
  if (fwMatch) {
    return fwMatch;
  }

  for (const [lang, preset] of Object.entries(LANG_TO_PRESET)) {
    if (langSet.has(lang)) {
      return preset;
    }
  }
  return "custom";
}

// ---------------------------------------------------------------------------
// Command inference
// ---------------------------------------------------------------------------

interface CommandSet {
  build: string;
  dev: string;
  test: string;
}

const LANG_COMMANDS: Record<string, CommandSet> = {
  python: { build: "", dev: "python manage.py runserver", test: "pytest" },
  go: { build: "go build ./...", dev: "go run .", test: "go test ./..." },
  rust: { build: "cargo build", dev: "cargo run", test: "cargo test" },
  ruby: {
    build: "bundle exec rake build",
    dev: "bundle exec rails server",
    test: "bundle exec rspec",
  },
  dart: { build: "flutter build", dev: "flutter run", test: "flutter test" },
  flutter: { build: "flutter build", dev: "flutter run", test: "flutter test" },
  swift: { build: "swift build", dev: "swift run", test: "swift test" },
  php: {
    build: "composer install --optimize-autoloader",
    dev: "php artisan serve",
    test: "php artisan test",
  },
};

function inferFromLanguage(langSet: Set<string>, files: string[]): CommandSet {
  for (const [lang, cmds] of Object.entries(LANG_COMMANDS)) {
    if (langSet.has(lang)) {
      return cmds;
    }
  }
  if (langSet.has("java") || langSet.has("kotlin")) {
    if (hasFile(files, "build.gradle") || hasFile(files, "build.gradle.kts")) {
      return {
        build: "./gradlew build",
        dev: "./gradlew bootRun",
        test: "./gradlew test",
      };
    }
    return {
      build: "mvn package",
      dev: "mvn spring-boot:run",
      test: "mvn test",
    };
  }
  return { build: "", dev: "", test: "" };
}

const PM_PREFIX: Record<string, string> = {
  pnpm: "pnpm",
  yarn: "yarn",
  bun: "bun",
};

function inferFromPkgJson(
  content: ContentMap,
  files: string[],
  packageManager: string
): CommandSet | null {
  const pkgFile = findFile(files, "package.json");
  if (!(pkgFile && content[pkgFile])) {
    return null;
  }
  const pkg = tryParseJson(content[pkgFile] as string);
  if (!pkg) {
    return null;
  }
  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (!scripts) {
    return null;
  }

  const prefix = PM_PREFIX[packageManager] ?? "npm run";
  let devCmd = "";
  if (scripts.dev) {
    devCmd = `${prefix} dev`;
  } else if (scripts.start) {
    devCmd = `${prefix} start`;
  }
  return {
    build: scripts.build ? `${prefix} build` : "",
    dev: devCmd,
    test: scripts.test ? `${prefix} test` : "",
  };
}

function inferCommands(
  languages: string[],
  packageManager: string,
  _isMonorepo: boolean,
  content: ContentMap,
  files: string[]
): CommandSet {
  const fromPkg = inferFromPkgJson(content, files, packageManager);
  if (fromPkg) {
    return fromPkg;
  }
  const langSet = new Set(languages.map((l) => l.toLowerCase()));
  return inferFromLanguage(langSet, files);
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Detect the tech stack of a project from its file listing.
 *
 * @param files - Array of file paths relative to the repository root.
 * @param fileContents - Optional map of file path to file content for deeper
 *   inspection (e.g. parsing package.json dependencies). Keys must match
 *   entries in `files`.
 */
function detectLanguages(files: string[]): string[] {
  const languages: string[] = [];

  if (hasFile(files, "package.json")) {
    const isTS =
      hasFile(files, "tsconfig.json") ||
      files.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    languages.push(isTS ? "TypeScript" : "JavaScript");
  }

  const langIndicators: [string[], string][] = [
    [["requirements.txt", "pyproject.toml", "setup.py"], "Python"],
    [["Cargo.toml"], "Rust"],
    [["go.mod"], "Go"],
    [["Gemfile"], "Ruby"],
    [["composer.json"], "PHP"],
    [["Package.swift"], "Swift"],
  ];

  for (const [indicators, lang] of langIndicators) {
    if (indicators.some((f) => hasFile(files, f))) {
      languages.push(lang);
    }
  }

  if (
    hasFile(files, "pom.xml") ||
    hasFile(files, "build.gradle") ||
    hasFile(files, "build.gradle.kts")
  ) {
    const isKotlin =
      hasFile(files, "build.gradle.kts") ||
      files.some((f) => f.endsWith(".kt"));
    languages.push(isKotlin ? "Kotlin" : "Java");
  }

  if (hasFile(files, "pubspec.yaml")) {
    languages.push("Dart");
    if (files.some((f) => f.includes("flutter"))) {
      languages.push("Flutter");
    }
  }

  return languages;
}

const RAILS_RE = /\brails\b/i;
const LARAVEL_RE = /\blaravel\b/i;

function detectFrameworks(files: string[], fileContents: ContentMap): string[] {
  const frameworks: string[] = [];
  frameworks.push(...detectNodeFrameworks(fileContents, files));
  frameworks.push(...detectPythonFrameworks(fileContents, files));

  if (hasFile(files, "Gemfile")) {
    const gemfileContent = fileContents[findFile(files, "Gemfile") ?? ""];
    if (gemfileContent && RAILS_RE.test(gemfileContent)) {
      frameworks.push("rails");
    }
  }
  if (hasFile(files, "composer.json")) {
    const composerContent =
      fileContents[findFile(files, "composer.json") ?? ""];
    if (composerContent && LARAVEL_RE.test(composerContent)) {
      frameworks.push("laravel");
    }
  }
  if (
    hasFile(files, "docker-compose.yml") ||
    hasFile(files, "docker-compose.yaml")
  ) {
    frameworks.push("docker-compose");
  }
  if (hasFile(files, "Dockerfile")) {
    frameworks.push("docker");
  }

  return frameworks;
}

export function detectTechStack(
  files: string[],
  fileContents: ContentMap = {}
): TechStackResult {
  const languages = detectLanguages(files);
  const frameworks = detectFrameworks(files, fileContents);

  // -- Other detections --
  const packageManager = detectPackageManager(files);
  const isMonorepo = detectMonorepo(files);
  const suggestedPreset = matchPreset(languages, frameworks);
  const commands = inferCommands(
    languages,
    packageManager,
    isMonorepo,
    fileContents,
    files
  );

  return {
    languages,
    frameworks,
    packageManager,
    isMonorepo,
    suggestedPreset,
    buildCommand: commands.build,
    devCommand: commands.dev,
    testCommand: commands.test,
  };
}
