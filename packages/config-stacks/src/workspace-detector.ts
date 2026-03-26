/**
 * Monorepo and workspace auto-detection.
 *
 * Scans a repository's file listing to determine workspace tooling,
 * discover packages, and detect CI configuration.
 */

// ── Types ───────────────────────────────────────────────────

export interface WorkspaceDetectionResult {
  /** CI provider detected (e.g. "github-actions", "gitlab-ci", "none") */
  ciProvider: string;
  /** Whether the repo is a monorepo / workspace */
  isMonorepo: boolean;
  /** Discovered package/workspace paths */
  packages: string[];
  /** Type of workspace tooling detected */
  workspaceType: WorkspaceType;
}

export type WorkspaceType =
  | "cargo"
  | "docker-compose"
  | "go"
  | "lerna"
  | "none"
  | "npm"
  | "nx"
  | "pnpm"
  | "rush"
  | "turborepo"
  | "yarn";

// ── Content map for deeper inspection ────────────────────────

type ContentMap = Record<string, string>;

const GLOB_SUFFIX_RE = /\/?\*.*$/;
const PNPM_PACKAGES_RE = /packages:\s*\n((?:\s*-\s*.+\n?)*)/;
const YAML_LIST_ITEM_PREFIX_RE = /^\s*-\s*['"]?/;
const YAML_QUOTED_SUFFIX_RE = /['"]?\s*$/;
const CARGO_WORKSPACE_MEMBERS_RE =
  /\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/;
const GO_WORK_USE_RE = /use\s*\(([\s\S]*?)\)/;
const DOCKER_SERVICES_RE =
  /services:\s*\n((?:\s{2,}\w[\w-]*:\s*\n?(?:\s{4,}.*\n?)*)*)/;
const DOCKER_SERVICE_NAME_RE = /^\s{2}(\w[\w-]*):/;

// ── Helpers ──────────────────────────────────────────────────

function hasFile(files: string[], name: string): boolean {
  return files.some((f) => f === name || f.endsWith(`/${name}`));
}

function findFile(files: string[], name: string): string | undefined {
  return files.find((f) => f === name || f.endsWith(`/${name}`));
}

function tryParseJson(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Extract package paths from glob patterns like ["packages/*", "apps/*"].
 * Matches actual directories in the file list.
 */
function resolveGlobPatterns(patterns: string[], files: string[]): string[] {
  const packages = new Set<string>();

  for (const pattern of patterns) {
    // Handle simple "dir/*" patterns
    const prefix = pattern.replace(GLOB_SUFFIX_RE, "");
    if (!prefix) {
      continue;
    }

    for (const file of files) {
      // Match files that are under prefix/something/...
      if (file.startsWith(`${prefix}/`)) {
        const rest = file.slice(prefix.length + 1);
        const packageDir = rest.split("/")[0];
        if (packageDir) {
          packages.add(`${prefix}/${packageDir}`);
        }
      }
    }
  }

  return Array.from(packages).sort();
}

// ── Workspace type detection ─────────────────────────────────

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Sequentially checks many workspace types with file-content inspection
function detectWorkspaceType(
  files: string[],
  content: ContentMap
): { packages: string[]; type: WorkspaceType } {
  // pnpm workspaces (highest priority since it's most explicit)
  if (hasFile(files, "pnpm-workspace.yaml")) {
    const raw = content[findFile(files, "pnpm-workspace.yaml") ?? ""];
    let packages: string[] = [];
    if (raw) {
      // Simple YAML parse for packages list
      const match = raw.match(PNPM_PACKAGES_RE);
      if (match?.[1]) {
        const patterns = match[1]
          .split("\n")
          .map((line) =>
            line
              .replace(YAML_LIST_ITEM_PREFIX_RE, "")
              .replace(YAML_QUOTED_SUFFIX_RE, "")
          )
          .filter(Boolean);
        packages = resolveGlobPatterns(patterns, files);
      }
    }
    if (packages.length === 0) {
      // Fallback: look for common monorepo dirs
      packages = resolveGlobPatterns(["packages", "apps", "libs"], files);
    }
    return { type: "pnpm", packages };
  }

  // Nx
  if (hasFile(files, "nx.json")) {
    const packages = resolveGlobPatterns(["packages", "apps", "libs"], files);
    return { type: "nx", packages };
  }

  // Turborepo
  if (hasFile(files, "turbo.json")) {
    const packages = resolveGlobPatterns(["packages", "apps", "libs"], files);
    return { type: "turborepo", packages };
  }

  // Lerna
  if (hasFile(files, "lerna.json")) {
    const raw = content[findFile(files, "lerna.json") ?? ""];
    let packages: string[] = [];
    if (raw) {
      const lerna = tryParseJson(raw);
      const lernaPackages = lerna?.packages as string[] | undefined;
      if (lernaPackages) {
        packages = resolveGlobPatterns(lernaPackages, files);
      }
    }
    if (packages.length === 0) {
      packages = resolveGlobPatterns(["packages"], files);
    }
    return { type: "lerna", packages };
  }

  // Rush
  if (hasFile(files, "rush.json")) {
    const raw = content[findFile(files, "rush.json") ?? ""];
    let packages: string[] = [];
    if (raw) {
      const rush = tryParseJson(raw);
      const rushProjects = rush?.projects as
        | Array<{ projectFolder: string }>
        | undefined;
      if (rushProjects) {
        packages = rushProjects.map((p) => p.projectFolder);
      }
    }
    return { type: "rush", packages };
  }

  // npm/yarn workspaces via package.json
  if (hasFile(files, "package.json")) {
    const raw = content[findFile(files, "package.json") ?? ""];
    if (raw) {
      const pkg = tryParseJson(raw);
      const workspaces = pkg?.workspaces as
        | string[]
        | { packages: string[] }
        | undefined;
      if (workspaces) {
        const patterns = Array.isArray(workspaces)
          ? workspaces
          : (workspaces.packages ?? []);
        const packages = resolveGlobPatterns(patterns, files);
        // Determine yarn vs npm
        const isYarn = hasFile(files, "yarn.lock");
        return { type: isYarn ? "yarn" : "npm", packages };
      }
    }
  }

  // Cargo workspaces
  if (hasFile(files, "Cargo.toml")) {
    const raw = content[findFile(files, "Cargo.toml") ?? ""];
    if (raw?.includes("[workspace]")) {
      // Extract members from workspace section
      const membersMatch = raw.match(CARGO_WORKSPACE_MEMBERS_RE);
      let packages: string[] = [];
      if (membersMatch?.[1]) {
        const patterns = membersMatch[1]
          .split(",")
          .map((s) => s.replace(/['"]/g, "").trim())
          .filter(Boolean);
        packages = resolveGlobPatterns(patterns, files);
      }
      return { type: "cargo", packages };
    }
  }

  // Go workspaces
  if (hasFile(files, "go.work")) {
    const raw = content[findFile(files, "go.work") ?? ""];
    let packages: string[] = [];
    if (raw) {
      const useMatch = raw.match(GO_WORK_USE_RE);
      if (useMatch?.[1]) {
        packages = useMatch[1]
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("//"));
      }
    }
    return { type: "go", packages };
  }

  // Docker Compose (multi-service, not strictly a monorepo but multi-component)
  if (
    hasFile(files, "docker-compose.yml") ||
    hasFile(files, "docker-compose.yaml")
  ) {
    const raw =
      content[findFile(files, "docker-compose.yml") ?? ""] ??
      content[findFile(files, "docker-compose.yaml") ?? ""];
    const packages: string[] = [];
    if (raw) {
      // Extract service names from "services:" section
      const servicesMatch = raw.match(DOCKER_SERVICES_RE);
      if (servicesMatch?.[1]) {
        const serviceLines = servicesMatch[1].split("\n");
        for (const line of serviceLines) {
          const svcMatch = line.match(DOCKER_SERVICE_NAME_RE);
          if (svcMatch?.[1]) {
            packages.push(svcMatch[1]);
          }
        }
      }
    }
    return { type: "docker-compose", packages };
  }

  return { type: "none", packages: [] };
}

// ── CI provider detection ────────────────────────────────────

function detectCiProvider(files: string[]): string {
  // GitHub Actions
  if (files.some((f) => f.startsWith(".github/workflows/"))) {
    return "github-actions";
  }
  // GitLab CI
  if (hasFile(files, ".gitlab-ci.yml") || hasFile(files, ".gitlab-ci.yaml")) {
    return "gitlab-ci";
  }
  // CircleCI
  if (hasFile(files, ".circleci/config.yml")) {
    return "circleci";
  }
  // Jenkins
  if (hasFile(files, "Jenkinsfile")) {
    return "jenkins";
  }
  // Travis CI
  if (hasFile(files, ".travis.yml")) {
    return "travis-ci";
  }
  // Azure Pipelines
  if (hasFile(files, "azure-pipelines.yml")) {
    return "azure-pipelines";
  }
  // Buildkite
  if (files.some((f) => f.startsWith(".buildkite/") && f.endsWith(".yml"))) {
    return "buildkite";
  }
  // Bitbucket Pipelines
  if (hasFile(files, "bitbucket-pipelines.yml")) {
    return "bitbucket-pipelines";
  }

  return "none";
}

// ── Main detection function ──────────────────────────────────

/**
 * Detect workspace/monorepo configuration from a repository's file listing.
 *
 * @param files - Array of file paths relative to repository root.
 * @param fileContents - Optional map of file path to file content for deeper
 *   inspection (e.g. parsing pnpm-workspace.yaml, package.json workspaces).
 */
export function detectWorkspace(
  files: string[],
  fileContents: ContentMap = {}
): WorkspaceDetectionResult {
  const { type, packages } = detectWorkspaceType(files, fileContents);
  const ciProvider = detectCiProvider(files);
  const isMonorepo = type !== "none" && type !== "docker-compose";

  return {
    isMonorepo,
    workspaceType: type,
    packages,
    ciProvider,
  };
}
