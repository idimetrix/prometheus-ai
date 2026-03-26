/**
 * Language detection for project workspaces.
 *
 * Reads project file extensions and config files to determine
 * the primary language(s) used, enabling language-specific prompt injection.
 */

export type SupportedLanguage =
  | "go"
  | "java"
  | "node"
  | "python"
  | "ruby"
  | "rust";

export interface DetectedLanguageInfo {
  /** Build tool / package manager (e.g., "maven", "gradle", "cargo"). */
  buildTool: string | null;
  /** Detected framework (e.g., "fastapi", "spring-boot", "rails"). */
  framework: string | null;
  /** Primary language identifier. */
  language: SupportedLanguage;
}

export interface LanguageDetectionResult {
  /** All detected languages sorted by confidence (highest first). */
  languages: DetectedLanguageInfo[];
  /** The primary (highest-confidence) language, if any. */
  primary: DetectedLanguageInfo | null;
}

/** Signature for a file-existence check (injected for testability). */
export type FileExistsFn = (path: string) => Promise<boolean>;

/** Signature for reading a file as UTF-8 text (injected for testability). */
export type ReadFileFn = (path: string) => Promise<string>;

interface LanguageProbe {
  buildToolResolver?: (
    fileExists: FileExistsFn,
    readFile: ReadFileFn,
    dir: string
  ) => Promise<string | null>;
  frameworkResolver?: (
    readFile: ReadFileFn,
    dir: string
  ) => Promise<string | null>;
  language: SupportedLanguage;
  /** Files whose presence indicates this language. */
  markerFiles: string[];
}

// ---------------------------------------------------------------------------
// Framework resolvers
// ---------------------------------------------------------------------------

async function detectPythonFramework(
  readFile: ReadFileFn,
  dir: string
): Promise<string | null> {
  for (const manifest of ["requirements.txt", "pyproject.toml", "setup.cfg"]) {
    try {
      const content = await readFile(`${dir}/${manifest}`);
      if (content.includes("fastapi") || content.includes("FastAPI")) {
        return "fastapi";
      }
      if (content.includes("django") || content.includes("Django")) {
        return "django";
      }
      if (content.includes("flask") || content.includes("Flask")) {
        return "flask";
      }
    } catch {
      // file may not exist — continue
    }
  }
  return null;
}

async function detectGoFramework(
  readFile: ReadFileFn,
  dir: string
): Promise<string | null> {
  try {
    const content = await readFile(`${dir}/go.mod`);
    if (content.includes("github.com/gin-gonic/gin")) {
      return "gin";
    }
    if (content.includes("github.com/gofiber/fiber")) {
      return "fiber";
    }
    if (content.includes("github.com/labstack/echo")) {
      return "echo";
    }
  } catch {
    // no go.mod
  }
  return null;
}

async function detectRustFramework(
  readFile: ReadFileFn,
  dir: string
): Promise<string | null> {
  try {
    const content = await readFile(`${dir}/Cargo.toml`);
    if (content.includes("axum")) {
      return "axum";
    }
    if (content.includes("actix-web")) {
      return "actix-web";
    }
    if (content.includes("rocket")) {
      return "rocket";
    }
  } catch {
    // no Cargo.toml
  }
  return null;
}

async function detectJavaFramework(
  readFile: ReadFileFn,
  dir: string
): Promise<string | null> {
  for (const manifest of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    try {
      const content = await readFile(`${dir}/${manifest}`);
      if (
        content.includes("spring-boot") ||
        content.includes("org.springframework.boot")
      ) {
        return "spring-boot";
      }
      if (content.includes("quarkus") || content.includes("io.quarkus")) {
        return "quarkus";
      }
      if (content.includes("micronaut") || content.includes("io.micronaut")) {
        return "micronaut";
      }
    } catch {
      // continue
    }
  }
  return null;
}

async function detectJavaBuildTool(
  fileExists: FileExistsFn,
  _readFile: ReadFileFn,
  dir: string
): Promise<string | null> {
  if (await fileExists(`${dir}/pom.xml`)) {
    return "maven";
  }
  if (await fileExists(`${dir}/build.gradle`)) {
    return "gradle";
  }
  if (await fileExists(`${dir}/build.gradle.kts`)) {
    return "gradle";
  }
  return null;
}

async function detectRubyFramework(
  readFile: ReadFileFn,
  dir: string
): Promise<string | null> {
  try {
    const content = await readFile(`${dir}/Gemfile`);
    if (content.includes("rails") || content.includes("railties")) {
      return "rails";
    }
    if (content.includes("sinatra")) {
      return "sinatra";
    }
    if (content.includes("hanami")) {
      return "hanami";
    }
  } catch {
    // no Gemfile
  }
  return null;
}

async function detectPythonBuildTool(
  fileExists: FileExistsFn,
  _readFile: ReadFileFn,
  dir: string
): Promise<string | null> {
  if (await fileExists(`${dir}/poetry.lock`)) {
    return "poetry";
  }
  if (await fileExists(`${dir}/Pipfile`)) {
    return "pipenv";
  }
  if (await fileExists(`${dir}/pyproject.toml`)) {
    return "uv/pip";
  }
  if (await fileExists(`${dir}/requirements.txt`)) {
    return "pip";
  }
  return null;
}

async function detectNodeBuildTool(
  fileExists: FileExistsFn,
  _readFile: ReadFileFn,
  dir: string
): Promise<string | null> {
  if (await fileExists(`${dir}/pnpm-lock.yaml`)) {
    return "pnpm";
  }
  if (await fileExists(`${dir}/yarn.lock`)) {
    return "yarn";
  }
  if (await fileExists(`${dir}/bun.lockb`)) {
    return "bun";
  }
  return "npm";
}

// ---------------------------------------------------------------------------
// Language probes (ordered by detection priority)
// ---------------------------------------------------------------------------

const LANGUAGE_PROBES: LanguageProbe[] = [
  {
    language: "node",
    markerFiles: ["package.json"],
    buildToolResolver: detectNodeBuildTool,
  },
  {
    language: "python",
    markerFiles: ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"],
    buildToolResolver: detectPythonBuildTool,
    frameworkResolver: detectPythonFramework,
  },
  {
    language: "go",
    markerFiles: ["go.mod"],
    frameworkResolver: detectGoFramework,
  },
  {
    language: "rust",
    markerFiles: ["Cargo.toml"],
    frameworkResolver: detectRustFramework,
  },
  {
    language: "java",
    markerFiles: ["pom.xml", "build.gradle", "build.gradle.kts"],
    buildToolResolver: detectJavaBuildTool,
    frameworkResolver: detectJavaFramework,
  },
  {
    language: "ruby",
    markerFiles: ["Gemfile"],
    frameworkResolver: detectRubyFramework,
  },
];

/**
 * Detect the programming language(s) used in a project workspace.
 *
 * Scans for well-known manifest/config files and optionally reads their
 * contents to identify the build tool and framework.
 *
 * @param workspaceDir - Absolute path to the project root.
 * @param fileExists   - Async function that checks if a file exists.
 * @param readFile     - Async function that reads a file as UTF-8 text.
 * @returns Detection result with primary language and all detected languages.
 */
export async function detectLanguages(
  workspaceDir: string,
  fileExists: FileExistsFn,
  readFile: ReadFileFn
): Promise<LanguageDetectionResult> {
  const detected: DetectedLanguageInfo[] = [];

  for (const probe of LANGUAGE_PROBES) {
    let found = false;
    for (const marker of probe.markerFiles) {
      if (await fileExists(`${workspaceDir}/${marker}`)) {
        found = true;
        break;
      }
    }
    if (!found) {
      continue;
    }

    const buildTool = probe.buildToolResolver
      ? await probe.buildToolResolver(fileExists, readFile, workspaceDir)
      : null;

    const framework = probe.frameworkResolver
      ? await probe.frameworkResolver(readFile, workspaceDir)
      : null;

    detected.push({
      language: probe.language,
      buildTool,
      framework,
    });
  }

  return {
    primary: detected[0] ?? null,
    languages: detected,
  };
}
