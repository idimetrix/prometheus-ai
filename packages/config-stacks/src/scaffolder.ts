/**
 * Project Scaffolder — GAP-025
 *
 * High-level scaffolding API that can generate project structures from
 * templates or from natural language descriptions. Wraps the existing
 * scaffold-generator and template matching to provide a unified interface.
 */

import { createLogger } from "@prometheus/logger";
import { getExtendedPreset } from "./presets/index";
import {
  generateScaffoldBlueprint,
  matchScaffoldTemplate,
  type ScaffoldBlueprint,
} from "./templates/scaffold-generator";

const logger = createLogger("config-stacks:scaffolder");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaffoldOptions {
  /** Optional description override */
  description?: string;
  /** Include CI/CD pipeline configuration */
  includeCI?: boolean;
  /** Include Docker configuration */
  includeDocker?: boolean;
  /** Package manager preference */
  packageManager?: "npm" | "pnpm" | "yarn" | "pip" | "cargo" | "go";
  /** Project name */
  projectName: string;
}

export interface ScaffoldResult {
  /** The generated blueprint */
  blueprint: ScaffoldBlueprint;
  /** Generated env example content */
  envExample: string;
  /** Generated file tree representation */
  fileTree: FileTree;
  /** Whether scaffolding was successful */
  success: boolean;
  /** The template/preset used */
  templateId: string;
}

export interface FileTree {
  /** Child nodes */
  children: FileTree[];
  /** Whether this is a directory */
  isDirectory: boolean;
  /** File or directory name */
  name: string;
  /** Full path */
  path: string;
}

export interface TechStack {
  /** CSS framework (tailwind, css-modules, styled-components) */
  cssFramework?: string;
  /** Database (postgresql, mysql, sqlite, mongodb) */
  database?: string;
  /** Framework (nextjs, express, fastapi, django, rails, etc.) */
  framework: string;
  /** Primary language */
  language: string;
  /** ORM (drizzle, prisma, sqlalchemy, activerecord) */
  orm?: string;
  /** Testing framework */
  testFramework?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TECH_STACK_TO_PRESET: Record<string, string> = {
  nextjs: "nextjs-fullstack",
  "next.js": "nextjs-fullstack",
  express: "nextjs-fullstack",
  fastapi: "django-react",
  django: "django-react",
  rails: "rails",
  flutter: "flutter",
  go: "go-htmx",
  rust: "rust-axum",
  "react-native": "react-native",
  laravel: "laravel-vue",
};

// ---------------------------------------------------------------------------
// ProjectScaffolder
// ---------------------------------------------------------------------------

export class ProjectScaffolder {
  /**
   * Scaffold a project from a known template ID.
   */
  scaffoldFromTemplate(
    template: string,
    options: ScaffoldOptions
  ): ScaffoldResult {
    logger.info(
      { template, projectName: options.projectName },
      "Scaffolding from template"
    );

    const blueprint = generateScaffoldBlueprint(
      template,
      options.projectName,
      options.description
    );

    if (!blueprint) {
      throw new Error(`Unknown template: ${template}`);
    }

    const enhancedBlueprint = this.enhanceBlueprint(blueprint, options);
    const fileTree = this.generateStructureFromBlueprint(enhancedBlueprint);
    const envExample = this.generateEnvExampleFromBlueprint(enhancedBlueprint);

    return {
      success: true,
      templateId: template,
      blueprint: enhancedBlueprint,
      fileTree,
      envExample,
    };
  }

  /**
   * Scaffold a project from a natural language description.
   * Matches the description to the best available template.
   */
  scaffoldFromDescription(
    description: string,
    options: ScaffoldOptions
  ): ScaffoldResult {
    logger.info(
      {
        description: description.slice(0, 100),
        projectName: options.projectName,
      },
      "Scaffolding from description"
    );

    const matchedPreset = matchScaffoldTemplate(description);

    if (!matchedPreset) {
      throw new Error(
        `Could not match a template for description: "${description.slice(0, 100)}"`
      );
    }

    return this.scaffoldFromTemplate(matchedPreset.id, {
      ...options,
      description: options.description ?? description,
    });
  }

  /**
   * Generate a file tree structure from a tech stack definition.
   */
  generateStructure(techStack: TechStack): FileTree {
    const presetId = TECH_STACK_TO_PRESET[techStack.framework.toLowerCase()];
    const preset = presetId ? getExtendedPreset(presetId) : null;

    const root: FileTree = {
      name: ".",
      path: ".",
      isDirectory: true,
      children: [],
    };

    if (preset) {
      // Build tree from preset file templates
      for (const filePath of Object.keys(preset.fileTemplates)) {
        this.addPathToTree(root, filePath);
      }
    } else {
      // Generate a generic structure based on language
      const dirs = this.getDefaultDirectories(techStack);
      for (const dir of dirs) {
        this.addPathToTree(root, dir);
      }
    }

    return root;
  }

  /**
   * Generate a dependency manifest (package.json, requirements.txt, etc.)
   * for the given tech stack.
   */
  generateDependencyManifest(techStack: TechStack): string {
    switch (techStack.language.toLowerCase()) {
      case "typescript":
      case "javascript":
        return this.generatePackageJson(techStack);
      case "python":
        return this.generateRequirementsTxt(techStack);
      case "go":
        return this.generateGoMod(techStack);
      case "rust":
        return this.generateCargoToml(techStack);
      default:
        return this.generatePackageJson(techStack);
    }
  }

  /**
   * Generate an .env.example file for the given tech stack.
   */
  generateEnvExample(techStack: TechStack): string {
    const lines: string[] = [
      "# Environment Configuration",
      "# Copy this file to .env and fill in the values",
      "",
    ];

    // Database
    if (techStack.database) {
      lines.push("# Database");
      switch (techStack.database) {
        case "postgresql":
          lines.push(
            'DATABASE_URL="postgresql://user:password@localhost:5432/dbname"'
          );
          break;
        case "mysql":
          lines.push(
            'DATABASE_URL="mysql://user:password@localhost:3306/dbname"'
          );
          break;
        case "sqlite":
          lines.push('DATABASE_URL="file:./dev.db"');
          break;
        case "mongodb":
          lines.push('DATABASE_URL="mongodb://localhost:27017/dbname"');
          break;
        default:
          lines.push('DATABASE_URL="your-database-url"');
      }
      lines.push("");
    }

    // Framework-specific vars
    lines.push("# Application");
    lines.push('NODE_ENV="development"');
    lines.push("PORT=3000");
    lines.push("");

    lines.push("# Authentication");
    lines.push('JWT_SECRET="your-jwt-secret"');
    lines.push("");

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private enhanceBlueprint(
    blueprint: ScaffoldBlueprint,
    options: ScaffoldOptions
  ): ScaffoldBlueprint {
    const enhanced = { ...blueprint };

    if (options.includeDocker) {
      enhanced.files = {
        ...enhanced.files,
        Dockerfile: "Multi-stage Docker build for production deployment",
        "docker-compose.yml":
          "Local development services (database, cache, etc.)",
        ".dockerignore": "Files excluded from Docker build context",
      };
    }

    if (options.includeCI) {
      enhanced.files = {
        ...enhanced.files,
        ".github/workflows/ci.yml": "CI pipeline: lint, typecheck, test, build",
        ".github/workflows/deploy.yml":
          "Deployment pipeline: staging and production",
      };
    }

    return enhanced;
  }

  private generateStructureFromBlueprint(
    blueprint: ScaffoldBlueprint
  ): FileTree {
    const root: FileTree = {
      name: blueprint.projectName,
      path: blueprint.projectName,
      isDirectory: true,
      children: [],
    };

    for (const dirPath of Object.keys(blueprint.directories)) {
      this.addPathToTree(root, dirPath);
    }
    for (const filePath of Object.keys(blueprint.files)) {
      this.addPathToTree(root, filePath);
    }

    return root;
  }

  private generateEnvExampleFromBlueprint(
    blueprint: ScaffoldBlueprint
  ): string {
    const lines: string[] = [
      "# Environment Configuration",
      `# Generated for ${blueprint.projectName}`,
      "",
    ];

    for (const [key, description] of Object.entries(blueprint.envVars)) {
      lines.push(`# ${description}`);
      lines.push(`${key}=`);
      lines.push("");
    }

    return lines.join("\n");
  }

  private addPathToTree(root: FileTree, path: string): void {
    const parts = path.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      let existing = current.children.find((c) => c.name === part);
      if (!existing) {
        existing = {
          name: part,
          path: fullPath,
          isDirectory: !(isLast && part.includes(".")),
          children: [],
        };
        current.children.push(existing);
      }
      current = existing;
    }
  }

  private getDefaultDirectories(techStack: TechStack): string[] {
    const base = ["src", "tests", "config"];

    switch (techStack.language.toLowerCase()) {
      case "typescript":
      case "javascript":
        return [...base, "src/components", "src/lib", "src/types", "public"];
      case "python":
        return [...base, "src/models", "src/routes", "src/utils", "migrations"];
      case "go":
        return ["cmd", "internal", "internal/handler", "internal/model", "pkg"];
      case "rust":
        return ["src", "src/handlers", "src/models", "tests", "migrations"];
      default:
        return base;
    }
  }

  private generatePackageJson(_techStack: TechStack): string {
    const pkg: Record<string, unknown> = {
      name: "my-project",
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        lint: "biome check .",
        test: "vitest",
        typecheck: "tsc --noEmit",
      },
      dependencies: {} as Record<string, string>,
      devDependencies: {} as Record<string, string>,
    };

    return JSON.stringify(pkg, null, 2);
  }

  private generateRequirementsTxt(techStack: TechStack): string {
    const deps = ["python-dotenv>=1.0.0"];

    if (techStack.framework === "fastapi") {
      deps.push("fastapi>=0.100.0", "uvicorn>=0.23.0", "pydantic>=2.0.0");
    } else if (techStack.framework === "django") {
      deps.push("django>=4.2.0", "django-cors-headers>=4.0.0");
    }

    if (techStack.orm === "sqlalchemy") {
      deps.push("sqlalchemy>=2.0.0", "alembic>=1.11.0");
    }

    return deps.join("\n");
  }

  private generateGoMod(_techStack: TechStack): string {
    return [
      "module github.com/org/my-project",
      "",
      "go 1.21",
      "",
      "require (",
      "\tgithub.com/go-chi/chi/v5 v5.0.10",
      "\tgithub.com/jackc/pgx/v5 v5.4.3",
      ")",
    ].join("\n");
  }

  private generateCargoToml(_techStack: TechStack): string {
    return [
      "[package]",
      'name = "my-project"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'axum = "0.7"',
      'tokio = { version = "1", features = ["full"] }',
      'serde = { version = "1", features = ["derive"] }',
      'serde_json = "1"',
    ].join("\n");
  }
}
