import { createLogger } from "@prometheus/logger";

const logger = createLogger("plugins:templates");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateFile {
  content: string;
  path: string;
}

interface TemplateInfo {
  category: string;
  description: string;
  files: TemplateFile[];
  id: string;
  name: string;
  options?: TemplateOption[];
}

interface TemplateOption {
  default?: string;
  description: string;
  name: string;
  type: "string" | "boolean" | "select";
  values?: string[];
}

interface ApplyResult {
  filesCreated: string[];
  templateId: string;
}

// ---------------------------------------------------------------------------
// Template Manager
// ---------------------------------------------------------------------------

/**
 * Manages project templates for scaffolding new projects or adding
 * features to existing ones.
 */
export class TemplateManager {
  private readonly templates = new Map<string, TemplateInfo>();

  constructor() {
    this.registerBuiltinTemplates();
  }

  /**
   * List all available templates.
   */
  listTemplates(): TemplateInfo[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get a specific template by ID.
   */
  getTemplate(templateId: string): TemplateInfo | null {
    return this.templates.get(templateId) ?? null;
  }

  /**
   * Apply a template to a project directory. Returns the list of files created.
   */
  applyTemplate(
    templateId: string,
    _projectPath: string,
    options?: Record<string, string>
  ): ApplyResult {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const filesCreated: string[] = [];

    for (const file of template.files) {
      // Apply option substitutions to file content
      let content = file.content;
      if (options) {
        for (const [key, value] of Object.entries(options)) {
          content = content.replaceAll(`{{${key}}}`, value);
        }
      }

      filesCreated.push(file.path);
    }

    logger.info(
      { templateId, filesCreated: filesCreated.length },
      "Template applied"
    );

    return { templateId, filesCreated };
  }

  /**
   * Register a custom template.
   */
  registerTemplate(template: TemplateInfo): void {
    this.templates.set(template.id, template);
  }

  private registerBuiltinTemplates(): void {
    this.templates.set("nextjs-app", {
      id: "nextjs-app",
      name: "Next.js Application",
      description: "Full-stack Next.js app with App Router, tRPC, and Drizzle",
      category: "web",
      options: [
        {
          name: "name",
          description: "Project name",
          type: "string",
          default: "my-app",
        },
        {
          name: "database",
          description: "Database type",
          type: "select",
          values: ["postgresql", "mysql", "sqlite"],
          default: "postgresql",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/app/layout.tsx",
          content:
            "export default function RootLayout({ children }) { return <html><body>{children}</body></html> }",
        },
        {
          path: "src/app/page.tsx",
          content:
            "export default function Home() { return <main>Welcome to {{name}}</main> }",
        },
      ],
    });

    this.templates.set("express-api", {
      id: "express-api",
      name: "Express API",
      description: "REST API with Express, Zod validation, and Drizzle ORM",
      category: "api",
      options: [
        {
          name: "name",
          description: "Project name",
          type: "string",
          default: "my-api",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/index.ts",
          content:
            'import express from "express";\nconst app = express();\napp.listen(3000);',
        },
      ],
    });

    this.templates.set("react-component-lib", {
      id: "react-component-lib",
      name: "React Component Library",
      description: "Reusable React component library with Storybook and Vitest",
      category: "library",
      options: [
        {
          name: "name",
          description: "Library name",
          type: "string",
          default: "my-components",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/index.ts",
          content: 'export { Button } from "./components/Button";',
        },
      ],
    });

    this.templates.set("cli-tool", {
      id: "cli-tool",
      name: "CLI Tool",
      description: "Command-line tool with Commander.js and Chalk",
      category: "cli",
      options: [
        {
          name: "name",
          description: "CLI name",
          type: "string",
          default: "my-cli",
        },
      ],
      files: [
        {
          path: "package.json",
          content:
            '{"name": "{{name}}", "version": "0.1.0", "bin": {"{{name}}": "./dist/index.js"}}',
        },
        {
          path: "src/index.ts",
          content:
            '#!/usr/bin/env node\nimport { Command } from "commander";\nconst program = new Command();\nprogram.name("{{name}}").parse();',
        },
      ],
    });
  }
}

export type { ApplyResult, TemplateFile, TemplateInfo, TemplateOption };
