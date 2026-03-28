/**
 * Project Language Detector (GAP-033)
 *
 * Detects the primary programming language of a project by inspecting
 * its file listing for characteristic configuration files and extensions.
 */

/** Ordered list of detection rules. First match wins for config files. */
const DETECTION_RULES: Array<{
  configFiles: string[];
  extensions: string[];
  language: string;
}> = [
  {
    language: "rust",
    configFiles: ["Cargo.toml"],
    extensions: [".rs"],
  },
  {
    language: "go",
    configFiles: ["go.mod"],
    extensions: [".go"],
  },
  {
    language: "python",
    configFiles: [
      "requirements.txt",
      "pyproject.toml",
      "setup.py",
      "Pipfile",
      "setup.cfg",
    ],
    extensions: [".py", ".pyi"],
  },
  {
    language: "ruby",
    configFiles: ["Gemfile", "Rakefile"],
    extensions: [".rb", ".rake"],
  },
  {
    language: "java",
    configFiles: ["pom.xml", "build.gradle", "build.gradle.kts"],
    extensions: [".java"],
  },
  {
    language: "typescript",
    configFiles: [
      "tsconfig.json",
      "package.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package-lock.json",
      "bun.lockb",
    ],
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
];

/**
 * Detect the primary language of a project from its file listing.
 *
 * @param files - Array of file paths (relative or absolute)
 * @returns The detected language key (e.g. "typescript", "python"), or "unknown"
 */
export function detectProjectLanguage(files: string[]): string {
  const fileNames = new Set(
    files.map((f) => {
      const parts = f.split("/");
      return parts.at(-1);
    })
  );

  // First pass: check for config files (strongest signal)
  for (const rule of DETECTION_RULES) {
    for (const configFile of rule.configFiles) {
      if (fileNames.has(configFile)) {
        return rule.language;
      }
    }
  }

  // Second pass: count file extensions
  const extensionCounts = new Map<string, number>();
  for (const file of files) {
    const dotIdx = file.lastIndexOf(".");
    if (dotIdx !== -1) {
      const ext = file.slice(dotIdx);
      extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
    }
  }

  let bestLanguage = "unknown";
  let bestCount = 0;

  for (const rule of DETECTION_RULES) {
    let count = 0;
    for (const ext of rule.extensions) {
      count += extensionCounts.get(ext) ?? 0;
    }
    if (count > bestCount) {
      bestCount = count;
      bestLanguage = rule.language;
    }
  }

  return bestLanguage;
}
