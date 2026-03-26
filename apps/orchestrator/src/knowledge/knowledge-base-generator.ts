import { createLogger } from "@prometheus/logger";

const logger = createLogger("knowledge-base-generator");

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface KnowledgeBase {
  /** API endpoint documentation */
  apiReference: string;
  /** UI component catalog */
  components: string;
  /** Coding conventions detected */
  conventions: string;
  /** Database schema documentation */
  dataModel: string;
  /** Common questions from session history */
  faq: string;
  /** Setup and development guide */
  gettingStarted: string;
  /** High-level architecture description */
  overview: string;
}

interface SandboxFile {
  content: string;
  path: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function listSandboxFiles(sandboxId: string): Promise<SandboxFile[]> {
  try {
    const res = await fetch(
      `${SANDBOX_MANAGER_URL}/api/sandboxes/${sandboxId}/files/list`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    if (!res.ok) {
      return [];
    }
    return (await res.json()) as SandboxFile[];
  } catch {
    return [];
  }
}

async function readSandboxFile(
  sandboxId: string,
  filePath: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${SANDBOX_MANAGER_URL}/api/sandboxes/${sandboxId}/files/read`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      }
    );
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { content: string };
    return data.content;
  } catch {
    return null;
  }
}

function isConfig(p: string): boolean {
  return (
    p.endsWith("package.json") ||
    p.endsWith("tsconfig.json") ||
    p.endsWith("cargo.toml") ||
    p.endsWith("go.mod") ||
    p.endsWith(".env.example") ||
    p.includes("config")
  );
}

function isRoute(p: string): boolean {
  return (
    p.includes("route") ||
    p.includes("router") ||
    p.includes("api/") ||
    p.includes("endpoint")
  );
}

function isSchema(p: string): boolean {
  return (
    p.includes("schema") ||
    p.includes("model") ||
    p.includes("migration") ||
    p.includes("drizzle")
  );
}

function isComponent(p: string): boolean {
  return (
    p.includes("component") ||
    p.endsWith(".tsx") ||
    p.endsWith(".vue") ||
    p.endsWith(".svelte")
  );
}

function isTest(p: string): boolean {
  return p.includes("test") || p.includes("spec") || p.includes("__tests__");
}

function isDoc(p: string): boolean {
  return p.endsWith(".md") || p.endsWith(".mdx") || p.includes("docs/");
}

function isStyle(p: string): boolean {
  return p.endsWith(".css") || p.endsWith(".scss") || p.includes("tailwind");
}

function categorizeFiles(files: SandboxFile[]): {
  configs: string[];
  routes: string[];
  schemas: string[];
  components: string[];
  tests: string[];
  docs: string[];
  styles: string[];
} {
  const result = {
    configs: [] as string[],
    routes: [] as string[],
    schemas: [] as string[],
    components: [] as string[],
    tests: [] as string[],
    docs: [] as string[],
    styles: [] as string[],
  };

  for (const file of files) {
    const p = file.path.toLowerCase();

    if (isConfig(p)) {
      result.configs.push(file.path);
    }
    if (isRoute(p)) {
      result.routes.push(file.path);
    }
    if (isSchema(p)) {
      result.schemas.push(file.path);
    }
    if (isComponent(p)) {
      result.components.push(file.path);
    }
    if (isTest(p)) {
      result.tests.push(file.path);
    }
    if (isDoc(p)) {
      result.docs.push(file.path);
    }
    if (isStyle(p)) {
      result.styles.push(file.path);
    }
  }

  return result;
}

function detectPackageManager(files: SandboxFile[]): string {
  const paths = new Set(files.map((f) => f.path));
  if (paths.has("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (paths.has("yarn.lock")) {
    return "yarn";
  }
  if (paths.has("bun.lockb")) {
    return "bun";
  }
  if (paths.has("package-lock.json")) {
    return "npm";
  }
  if (paths.has("Cargo.lock")) {
    return "cargo";
  }
  if (paths.has("go.sum")) {
    return "go";
  }
  if (paths.has("Gemfile.lock")) {
    return "bundler";
  }
  return "unknown";
}

function detectFrameworks(files: SandboxFile[]): string[] {
  const frameworks: string[] = [];
  const paths = files.map((f) => f.path.toLowerCase());
  const hasPath = (pattern: string) => paths.some((p) => p.includes(pattern));

  if (hasPath("next.config") || hasPath("app/layout")) {
    frameworks.push("Next.js");
  }
  if (hasPath("vite.config")) {
    frameworks.push("Vite");
  }
  if (hasPath("nuxt.config")) {
    frameworks.push("Nuxt");
  }
  if (hasPath("angular.json")) {
    frameworks.push("Angular");
  }
  if (hasPath("svelte.config")) {
    frameworks.push("SvelteKit");
  }
  if (hasPath("remix.config") || hasPath("app/root.tsx")) {
    frameworks.push("Remix");
  }
  if (hasPath("drizzle.config") || hasPath("drizzle/")) {
    frameworks.push("Drizzle ORM");
  }
  if (hasPath("prisma/schema.prisma")) {
    frameworks.push("Prisma");
  }
  if (hasPath("tailwind.config")) {
    frameworks.push("Tailwind CSS");
  }
  if (hasPath("dockerfile") || hasPath("docker-compose")) {
    frameworks.push("Docker");
  }

  return frameworks;
}

/* -------------------------------------------------------------------------- */
/*  Generator                                                                  */
/* -------------------------------------------------------------------------- */

export class KnowledgeBaseGenerator {
  async generate(
    projectId: string,
    sandboxId?: string
  ): Promise<KnowledgeBase> {
    logger.info({ projectId, sandboxId }, "Generating knowledge base");

    const files = sandboxId ? await listSandboxFiles(sandboxId) : [];
    const categories = categorizeFiles(files);
    const packageManager = detectPackageManager(files);
    const frameworks = detectFrameworks(files);

    // Try to read README for additional context
    let readmeContent = "";
    if (sandboxId) {
      const readme =
        (await readSandboxFile(sandboxId, "README.md")) ??
        (await readSandboxFile(sandboxId, "readme.md"));
      if (readme) {
        readmeContent = readme;
      }
    }

    // Try to read package.json for project metadata
    let packageJson: Record<string, unknown> = {};
    if (sandboxId) {
      const raw = await readSandboxFile(sandboxId, "package.json");
      if (raw) {
        try {
          packageJson = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // ignore parse errors
        }
      }
    }

    const overview = this.generateOverview(
      files,
      frameworks,
      packageJson,
      readmeContent
    );
    const gettingStarted = this.generateGettingStarted(
      packageManager,
      frameworks,
      packageJson
    );
    const apiReference = this.generateApiReference(categories.routes);
    const dataModel = this.generateDataModel(categories.schemas);
    const components = this.generateComponents(categories.components);
    const conventions = this.generateConventions(
      files,
      categories,
      frameworks,
      packageManager
    );
    const faq = this.generateFaq(frameworks, packageManager);

    logger.info(
      {
        projectId,
        fileCount: files.length,
        frameworkCount: frameworks.length,
      },
      "Knowledge base generated"
    );

    return {
      overview,
      gettingStarted,
      apiReference,
      dataModel,
      components,
      conventions,
      faq,
    };
  }

  private generateOverview(
    files: SandboxFile[],
    frameworks: string[],
    packageJson: Record<string, unknown>,
    readmeContent: string
  ): string {
    const lines: string[] = ["# Project Overview\n"];

    if (packageJson.name) {
      lines.push(`**Name:** ${packageJson.name as string}`);
    }
    if (packageJson.description) {
      lines.push(`**Description:** ${packageJson.description as string}`);
    }
    if (packageJson.version) {
      lines.push(`**Version:** ${packageJson.version as string}`);
    }

    lines.push(`\n**Total files:** ${files.length}`);

    if (frameworks.length > 0) {
      lines.push(`**Frameworks:** ${frameworks.join(", ")}`);
    }

    // Directory structure summary
    const topDirs = new Set<string>();
    for (const file of files) {
      const parts = file.path.split("/");
      if (parts.length > 1 && parts[0]) {
        topDirs.add(parts[0]);
      }
    }
    if (topDirs.size > 0) {
      lines.push(
        `\n**Top-level directories:** ${[...topDirs].sort().join(", ")}`
      );
    }

    if (readmeContent) {
      lines.push("\n---\n");
      lines.push("## From README\n");
      // Include first 500 chars of README
      lines.push(readmeContent.slice(0, 500));
      if (readmeContent.length > 500) {
        lines.push("\n...(truncated)");
      }
    }

    return lines.join("\n");
  }

  private generateGettingStarted(
    packageManager: string,
    frameworks: string[],
    packageJson: Record<string, unknown>
  ): string {
    const lines: string[] = ["# Getting Started\n"];

    lines.push("## Prerequisites\n");
    if (packageManager === "pnpm") {
      lines.push("- Node.js (v18+)");
      lines.push("- pnpm (`npm install -g pnpm`)");
    } else if (packageManager === "npm" || packageManager === "yarn") {
      lines.push("- Node.js (v18+)");
    } else if (packageManager === "cargo") {
      lines.push("- Rust toolchain (`rustup`)");
    } else if (packageManager === "go") {
      lines.push("- Go (v1.21+)");
    }

    if (frameworks.includes("Docker")) {
      lines.push("- Docker & Docker Compose");
    }

    lines.push("\n## Installation\n");
    lines.push("```bash");
    lines.push(`${packageManager} install`);
    lines.push("```\n");

    const scripts = packageJson.scripts as Record<string, string> | undefined;
    if (scripts) {
      lines.push("## Available Scripts\n");
      for (const [name, cmd] of Object.entries(scripts)) {
        lines.push(`- \`${packageManager} ${name}\` - ${cmd}`);
      }
    }

    return lines.join("\n");
  }

  private generateApiReference(routeFiles: string[]): string {
    const lines: string[] = ["# API Reference\n"];

    if (routeFiles.length === 0) {
      lines.push("No route files detected.");
      return lines.join("\n");
    }

    lines.push(`Found ${routeFiles.length} route/API files:\n`);
    for (const file of routeFiles.slice(0, 50)) {
      lines.push(`- \`${file}\``);
    }

    if (routeFiles.length > 50) {
      lines.push(`\n...and ${routeFiles.length - 50} more`);
    }

    return lines.join("\n");
  }

  private generateDataModel(schemaFiles: string[]): string {
    const lines: string[] = ["# Data Model\n"];

    if (schemaFiles.length === 0) {
      lines.push("No schema/model files detected.");
      return lines.join("\n");
    }

    lines.push(`Found ${schemaFiles.length} schema/model files:\n`);
    for (const file of schemaFiles.slice(0, 50)) {
      lines.push(`- \`${file}\``);
    }

    return lines.join("\n");
  }

  private generateComponents(componentFiles: string[]): string {
    const lines: string[] = ["# UI Components\n"];

    if (componentFiles.length === 0) {
      lines.push("No UI component files detected.");
      return lines.join("\n");
    }

    lines.push(`Found ${componentFiles.length} component files:\n`);

    // Group by directory
    const groups = new Map<string, string[]>();
    for (const file of componentFiles) {
      const parts = file.split("/");
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      const existing = groups.get(dir) ?? [];
      existing.push(parts.at(-1) ?? file);
      groups.set(dir, existing);
    }

    for (const [dir, dirFiles] of [...groups.entries()].sort().slice(0, 30)) {
      lines.push(`\n### ${dir}/`);
      for (const file of dirFiles.slice(0, 10)) {
        lines.push(`- ${file}`);
      }
      if (dirFiles.length > 10) {
        lines.push(`- ...and ${dirFiles.length - 10} more`);
      }
    }

    return lines.join("\n");
  }

  private generateConventions(
    files: SandboxFile[],
    categories: ReturnType<typeof categorizeFiles>,
    frameworks: string[],
    packageManager: string
  ): string {
    const lines: string[] = ["# Coding Conventions\n"];

    lines.push(`**Package Manager:** ${packageManager}`);

    if (frameworks.length > 0) {
      lines.push(`**Framework Stack:** ${frameworks.join(", ")}`);
    }

    // Detect TypeScript usage
    const tsFiles = files.filter(
      (f) => f.path.endsWith(".ts") || f.path.endsWith(".tsx")
    );
    const jsFiles = files.filter(
      (f) => f.path.endsWith(".js") || f.path.endsWith(".jsx")
    );
    if (tsFiles.length > jsFiles.length) {
      lines.push("**Language:** TypeScript (primary)");
    } else if (jsFiles.length > 0) {
      lines.push("**Language:** JavaScript (primary)");
    }

    // Detect testing framework
    if (categories.tests.length > 0) {
      const hasVitest = files.some((f) => f.path.includes("vitest"));
      const hasJest = files.some((f) => f.path.includes("jest"));
      if (hasVitest) {
        lines.push("**Testing:** Vitest");
      } else if (hasJest) {
        lines.push("**Testing:** Jest");
      }
      lines.push(`**Test files:** ${categories.tests.length}`);
    }

    // Detect monorepo
    const hasWorkspaces = files.some(
      (f) => f.path === "pnpm-workspace.yaml" || f.path === "turbo.json"
    );
    if (hasWorkspaces) {
      lines.push("**Structure:** Monorepo (workspaces)");
    }

    // Detect linting
    const hasBiome = files.some((f) => f.path.includes("biome"));
    const hasEslint = files.some((f) => f.path.includes("eslint"));
    if (hasBiome) {
      lines.push("**Linting:** Biome");
    } else if (hasEslint) {
      lines.push("**Linting:** ESLint");
    }

    return lines.join("\n");
  }

  private generateFaq(frameworks: string[], packageManager: string): string {
    const lines: string[] = ["# FAQ\n"];

    lines.push("## How do I start the development server?\n");
    lines.push(`Run \`${packageManager} dev\` in the project root.\n`);

    lines.push("## How do I run tests?\n");
    lines.push(`Run \`${packageManager} test\` in the project root.\n`);

    lines.push("## How do I build for production?\n");
    lines.push(
      `Run \`${packageManager} build\` to create a production build.\n`
    );

    if (frameworks.includes("Docker")) {
      lines.push("## How do I start external services?\n");
      lines.push(
        "Run `docker compose up -d` to start all required services.\n"
      );
    }

    if (frameworks.includes("Drizzle ORM") || frameworks.includes("Prisma")) {
      lines.push("## How do I update the database schema?\n");
      if (frameworks.includes("Drizzle ORM")) {
        lines.push(
          `Run \`${packageManager} db:push\` for development or \`${packageManager} db:migrate\` for production.\n`
        );
      } else {
        lines.push(
          "Run `npx prisma migrate dev` for development or `npx prisma migrate deploy` for production.\n"
        );
      }
    }

    return lines.join("\n");
  }
}
