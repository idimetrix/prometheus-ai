/**
 * Workspace detector for monorepo configurations.
 *
 * Detects workspace type from config files and parses workspace
 * config to get package paths/globs.
 */

const CARGO_WORKSPACE_MEMBERS_RE =
  /\[workspace\][^[]*members\s*=\s*\[([\s\S]*?)\]/;

export type WorkspaceType =
  | "pnpm"
  | "npm"
  | "yarn"
  | "nx"
  | "turbo"
  | "lerna"
  | "rush"
  | "cargo"
  | "go";

export interface WorkspacePackage {
  dependencies: string[];
  name: string;
  path: string;
}

export interface WorkspaceDetectionResult {
  packages: WorkspacePackage[];
  type: WorkspaceType;
}

interface FileReader {
  exists(filePath: string): Promise<boolean>;
  glob(pattern: string, cwd: string): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
}

/**
 * Detects workspace type from config files in the given root directory.
 */
export class WorkspaceDetector {
  private readonly reader: FileReader;

  constructor(reader: FileReader) {
    this.reader = reader;
  }

  async detect(rootPath: string): Promise<WorkspaceDetectionResult | null> {
    // Check each workspace type in order of specificity
    const detectors: Array<{
      file: string;
      type: WorkspaceType;
      parse: (content: string, rootPath: string) => Promise<WorkspacePackage[]>;
    }> = [
      {
        file: `${rootPath}/pnpm-workspace.yaml`,
        type: "pnpm",
        parse: (c, r) => this.parsePnpmWorkspace(c, r),
      },
      {
        file: `${rootPath}/nx.json`,
        type: "nx",
        parse: (c, r) => this.parseNxWorkspace(c, r),
      },
      {
        file: `${rootPath}/turbo.json`,
        type: "turbo",
        parse: (c, r) => this.parseTurboWorkspace(c, r),
      },
      {
        file: `${rootPath}/lerna.json`,
        type: "lerna",
        parse: (c, r) => this.parseLernaWorkspace(c, r),
      },
      {
        file: `${rootPath}/rush.json`,
        type: "rush",
        parse: (c, r) => Promise.resolve(this.parseRushWorkspace(c, r)),
      },
      {
        file: `${rootPath}/go.work`,
        type: "go",
        parse: (c, r) => Promise.resolve(this.parseGoWorkspace(c, r)),
      },
      {
        file: `${rootPath}/Cargo.toml`,
        type: "cargo",
        parse: (c, r) => Promise.resolve(this.parseCargoWorkspace(c, r)),
      },
    ];

    for (const detector of detectors) {
      if (await this.reader.exists(detector.file)) {
        const content = await this.reader.readFile(detector.file);

        // For Cargo.toml, only match if it has [workspace]
        if (detector.type === "cargo" && !content.includes("[workspace]")) {
          continue;
        }

        const packages = await detector.parse(content, rootPath);
        return { type: detector.type, packages };
      }
    }

    // Check package.json for npm/yarn workspaces
    const pkgJsonPath = `${rootPath}/package.json`;
    if (await this.reader.exists(pkgJsonPath)) {
      const content = await this.reader.readFile(pkgJsonPath);
      const pkgJson = JSON.parse(content) as {
        workspaces?: string[] | { packages: string[] };
      };
      if (pkgJson.workspaces) {
        const globs = Array.isArray(pkgJson.workspaces)
          ? pkgJson.workspaces
          : pkgJson.workspaces.packages;

        // Determine if yarn or npm based on lock file
        const isYarn = await this.reader.exists(`${rootPath}/yarn.lock`);
        const packages = await this.resolveGlobPackages(globs, rootPath);
        return { type: isYarn ? "yarn" : "npm", packages };
      }
    }

    return null;
  }

  private parsePnpmWorkspace(
    content: string,
    rootPath: string
  ): Promise<WorkspacePackage[]> {
    // Simple YAML parsing for pnpm-workspace.yaml
    const lines = content.split("\n");
    const globs: string[] = [];
    let inPackages = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "packages:") {
        inPackages = true;
        continue;
      }
      if (inPackages && trimmed.startsWith("- ")) {
        const glob = trimmed.slice(2).trim().replace(/['"]/g, "");
        globs.push(glob);
      } else if (inPackages && !trimmed.startsWith("-") && trimmed.length > 0) {
        inPackages = false;
      }
    }

    return this.resolveGlobPackages(globs, rootPath);
  }

  private parseNxWorkspace(
    _content: string,
    rootPath: string
  ): Promise<WorkspacePackage[]> {
    // Nx projects can be in packages/ or apps/ or libs/
    const defaultGlobs = ["packages/*", "apps/*", "libs/*"];
    return this.resolveGlobPackages(defaultGlobs, rootPath);
  }

  private async parseTurboWorkspace(
    _content: string,
    rootPath: string
  ): Promise<WorkspacePackage[]> {
    // Turbo uses the same workspace config as package.json
    const pkgJsonPath = `${rootPath}/package.json`;
    if (await this.reader.exists(pkgJsonPath)) {
      const pkgContent = await this.reader.readFile(pkgJsonPath);
      const pkgJson = JSON.parse(pkgContent) as {
        workspaces?: string[] | { packages: string[] };
      };
      if (pkgJson.workspaces) {
        const globs = Array.isArray(pkgJson.workspaces)
          ? pkgJson.workspaces
          : pkgJson.workspaces.packages;
        return this.resolveGlobPackages(globs, rootPath);
      }
    }
    return this.resolveGlobPackages(["packages/*", "apps/*"], rootPath);
  }

  private parseLernaWorkspace(
    content: string,
    rootPath: string
  ): Promise<WorkspacePackage[]> {
    const config = JSON.parse(content) as { packages?: string[] };
    const globs = config.packages ?? ["packages/*"];
    return this.resolveGlobPackages(globs, rootPath);
  }

  private parseRushWorkspace(
    content: string,
    _rootPath: string
  ): WorkspacePackage[] {
    const config = JSON.parse(content) as {
      projects?: Array<{
        packageName: string;
        projectFolder: string;
      }>;
    };

    return (config.projects ?? []).map((p) => ({
      name: p.packageName,
      path: p.projectFolder,
      dependencies: [],
    }));
  }

  private parseCargoWorkspace(
    content: string,
    rootPath: string
  ): WorkspacePackage[] | Promise<WorkspacePackage[]> {
    // Simple TOML parsing for Cargo workspace members
    const membersMatch = content.match(CARGO_WORKSPACE_MEMBERS_RE);
    if (!membersMatch) {
      return [];
    }

    const membersStr = membersMatch[1] ?? "";
    const members = membersStr
      .split(",")
      .map((m) => m.trim().replace(/['"]/g, ""))
      .filter(Boolean);

    return this.resolveGlobPackages(members, rootPath);
  }

  private parseGoWorkspace(
    content: string,
    _rootPath: string
  ): WorkspacePackage[] {
    const packages: WorkspacePackage[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("use ") || trimmed.startsWith("use\t")) {
        const modPath = trimmed.slice(4).trim();
        if (modPath && !modPath.startsWith("(")) {
          packages.push({
            name: modPath,
            path: modPath,
            dependencies: [],
          });
        }
      } else if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
        packages.push({
          name: trimmed,
          path: trimmed,
          dependencies: [],
        });
      }
    }

    return packages;
  }

  private async resolveGlobPackages(
    globs: string[],
    rootPath: string
  ): Promise<WorkspacePackage[]> {
    const packages: WorkspacePackage[] = [];

    for (const glob of globs) {
      const matchedPaths = await this.reader.glob(glob, rootPath);

      for (const matchedPath of matchedPaths) {
        const pkgJsonPath = `${matchedPath}/package.json`;
        if (await this.reader.exists(pkgJsonPath)) {
          const content = await this.reader.readFile(pkgJsonPath);
          const pkgJson = JSON.parse(content) as {
            name?: string;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };

          packages.push({
            name: pkgJson.name ?? matchedPath.split("/").pop() ?? matchedPath,
            path: matchedPath,
            dependencies: [
              ...Object.keys(pkgJson.dependencies ?? {}),
              ...Object.keys(pkgJson.devDependencies ?? {}),
            ],
          });
        } else {
          // For non-JS workspaces (Cargo, Go)
          packages.push({
            name: matchedPath.split("/").pop() ?? matchedPath,
            path: matchedPath,
            dependencies: [],
          });
        }
      }
    }

    return packages;
  }
}
