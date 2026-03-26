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
  tags?: string[];
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
 * features to existing ones. Templates are categorized and searchable.
 */
export class TemplateManager {
  private readonly templates = new Map<string, TemplateInfo>();

  constructor() {
    this.registerBuiltinTemplates();
  }

  /**
   * List all available templates, optionally filtered by category.
   */
  listTemplates(category?: string): TemplateInfo[] {
    const all = Array.from(this.templates.values());
    if (category) {
      return all.filter((t) => t.category === category);
    }
    return all;
  }

  /**
   * Search templates by query string.
   */
  searchTemplates(query: string): TemplateInfo[] {
    const q = query.toLowerCase();
    return Array.from(this.templates.values()).filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(q))
    );
  }

  /**
   * Get available template categories.
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const t of this.templates.values()) {
      categories.add(t.category);
    }
    return Array.from(categories).sort();
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
    // ---- Web ----

    this.templates.set("nextjs-app", {
      id: "nextjs-app",
      name: "Next.js Application",
      description:
        "Full-stack Next.js app with App Router, tRPC, Drizzle ORM, and Tailwind CSS",
      category: "web",
      tags: ["nextjs", "react", "fullstack", "trpc", "drizzle"],
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
          content: '{"name": "{{name}}", "version": "0.1.0", "private": true}',
        },
        {
          path: "src/app/layout.tsx",
          content:
            "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html> }",
        },
        {
          path: "src/app/page.tsx",
          content:
            "export default function Home() { return <main>Welcome to {{name}}</main> }",
        },
        {
          path: "drizzle.config.ts",
          content:
            'import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "{{database}}", schema: "./src/db/schema.ts" });',
        },
        {
          path: "tailwind.config.ts",
          content:
            'import type { Config } from "tailwindcss";\nexport default { content: ["./src/**/*.{ts,tsx}"] } satisfies Config;',
        },
      ],
    });

    this.templates.set("react-spa", {
      id: "react-spa",
      name: "React SPA",
      description:
        "Single-page React application with Vite, React Router, and Tanstack Query",
      category: "web",
      tags: ["react", "vite", "spa", "tanstack-query"],
      options: [
        {
          name: "name",
          description: "Project name",
          type: "string",
          default: "my-spa",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0", "type": "module"}',
        },
        {
          path: "src/main.tsx",
          content:
            'import { createRoot } from "react-dom/client";\nimport { App } from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);',
        },
        {
          path: "src/App.tsx",
          content:
            "export function App() { return <div>Welcome to {{name}}</div> }",
        },
        {
          path: "vite.config.ts",
          content:
            'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });',
        },
      ],
    });

    this.templates.set("astro-site", {
      id: "astro-site",
      name: "Astro Website",
      description:
        "Static site with Astro, MDX content, and island architecture",
      category: "web",
      tags: ["astro", "static-site", "mdx", "islands"],
      options: [
        {
          name: "name",
          description: "Site name",
          type: "string",
          default: "my-site",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "astro.config.mjs",
          content:
            'import { defineConfig } from "astro/config";\nimport mdx from "@astrojs/mdx";\nexport default defineConfig({ integrations: [mdx()] });',
        },
        {
          path: "src/pages/index.astro",
          content:
            "---\n// Welcome to {{name}}\n---\n<html><body><h1>{{name}}</h1></body></html>",
        },
      ],
    });

    // ---- API ----

    this.templates.set("express-api", {
      id: "express-api",
      name: "Express REST API",
      description:
        "REST API with Express, Zod validation, Drizzle ORM, and OpenAPI docs",
      category: "api",
      tags: ["express", "rest", "api", "zod", "drizzle"],
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
            'import express from "express";\nconst app = express();\napp.use(express.json());\napp.get("/health", (_req, res) => res.json({ status: "ok" }));\napp.listen(3000);',
        },
      ],
    });

    this.templates.set("hono-api", {
      id: "hono-api",
      name: "Hono API",
      description:
        "Lightweight API with Hono, runs on Node.js, Cloudflare Workers, Bun, and Deno",
      category: "api",
      tags: ["hono", "api", "edge", "cloudflare", "bun"],
      options: [
        {
          name: "name",
          description: "Project name",
          type: "string",
          default: "my-hono-api",
        },
        {
          name: "runtime",
          description: "Target runtime",
          type: "select",
          values: ["node", "bun", "cloudflare-workers", "deno"],
          default: "node",
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
            'import { Hono } from "hono";\nconst app = new Hono();\napp.get("/", (c) => c.json({ message: "Hello from {{name}}" }));\nexport default app;',
        },
      ],
    });

    this.templates.set("trpc-api", {
      id: "trpc-api",
      name: "tRPC API",
      description: "Type-safe API with tRPC, Zod validation, and Drizzle ORM",
      category: "api",
      tags: ["trpc", "api", "typesafe", "zod", "drizzle"],
      options: [
        {
          name: "name",
          description: "Project name",
          type: "string",
          default: "my-trpc-api",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/router.ts",
          content:
            // biome-ignore lint/suspicious/noTemplateCurlyInString: template file content
            'import { initTRPC } from "@trpc/server";\nimport { z } from "zod";\nconst t = initTRPC.create();\nexport const appRouter = t.router({\n  hello: t.procedure.input(z.object({ name: z.string() })).query(({ input }) => `Hello ${input.name}`),\n});',
        },
      ],
    });

    // ---- Library ----

    this.templates.set("react-component-lib", {
      id: "react-component-lib",
      name: "React Component Library",
      description:
        "Reusable React component library with Storybook, Vitest, and tsup bundling",
      category: "library",
      tags: ["react", "components", "storybook", "vitest"],
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
          content:
            'export { Button } from "./components/Button";\nexport { Input } from "./components/Input";',
        },
      ],
    });

    this.templates.set("typescript-lib", {
      id: "typescript-lib",
      name: "TypeScript Library",
      description:
        "Publishable TypeScript library with tsup, Vitest, and Changesets",
      category: "library",
      tags: ["typescript", "library", "npm", "tsup"],
      options: [
        {
          name: "name",
          description: "Package name",
          type: "string",
          default: "my-lib",
        },
      ],
      files: [
        {
          path: "package.json",
          content:
            '{"name": "{{name}}", "version": "0.0.1", "main": "./dist/index.js", "types": "./dist/index.d.ts"}',
        },
        {
          path: "src/index.ts",
          content:
            // biome-ignore lint/suspicious/noTemplateCurlyInString: template file content
            "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}",
        },
        {
          path: "tsup.config.ts",
          content:
            'import { defineConfig } from "tsup";\nexport default defineConfig({ entry: ["src/index.ts"], format: ["cjs", "esm"], dts: true });',
        },
      ],
    });

    // ---- CLI ----

    this.templates.set("cli-tool", {
      id: "cli-tool",
      name: "CLI Tool",
      description:
        "Command-line tool with Commander.js, Chalk, and interactive prompts",
      category: "cli",
      tags: ["cli", "commander", "chalk", "terminal"],
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
            '#!/usr/bin/env node\nimport { Command } from "commander";\nconst program = new Command();\nprogram.name("{{name}}").version("0.1.0").parse();',
        },
      ],
    });

    // ---- E-commerce ----

    this.templates.set("ecommerce-nextjs", {
      id: "ecommerce-nextjs",
      name: "E-commerce Store",
      description:
        "Next.js e-commerce with Stripe payments, cart, checkout, and inventory management",
      category: "ecommerce",
      tags: ["ecommerce", "stripe", "nextjs", "payments", "cart"],
      options: [
        {
          name: "name",
          description: "Store name",
          type: "string",
          default: "my-store",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/app/page.tsx",
          content:
            "export default function StorePage() { return <main>Welcome to {{name}}</main> }",
        },
        {
          path: "src/lib/stripe.ts",
          content:
            'import Stripe from "stripe";\nexport const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);',
        },
        {
          path: "src/db/schema/products.ts",
          content:
            '// Product schema\nexport const products = pgTable("products", {\n  id: text("id").primaryKey(),\n  name: text("name").notNull(),\n  price: integer("price").notNull(),\n  inventory: integer("inventory").notNull().default(0),\n});',
        },
      ],
    });

    // ---- SaaS ----

    this.templates.set("saas-starter", {
      id: "saas-starter",
      name: "SaaS Starter Kit",
      description:
        "Multi-tenant SaaS with auth, billing (Stripe), teams, RBAC, and onboarding flow",
      category: "saas",
      tags: ["saas", "multi-tenant", "billing", "auth", "teams"],
      options: [
        {
          name: "name",
          description: "App name",
          type: "string",
          default: "my-saas",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/db/schema/organizations.ts",
          content:
            '// Organization schema\nexport const organizations = pgTable("organizations", {\n  id: text("id").primaryKey(),\n  name: text("name").notNull(),\n  slug: text("slug").notNull().unique(),\n  plan: text("plan").notNull().default("free"),\n});',
        },
        {
          path: "src/middleware/auth.ts",
          content:
            "// Auth middleware with org context\nexport function withAuth(handler: Function) {\n  return async (req: Request) => {\n    // Verify JWT, extract orgId, check permissions\n  };\n}",
        },
      ],
    });

    // ---- Mobile / PWA ----

    this.templates.set("pwa-template", {
      id: "pwa-template",
      name: "Progressive Web App",
      description:
        "Installable PWA with offline support, push notifications, and service worker",
      category: "mobile",
      tags: ["pwa", "offline", "push-notifications", "service-worker"],
      options: [
        {
          name: "name",
          description: "App name",
          type: "string",
          default: "my-pwa",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "public/manifest.json",
          content:
            '{"name": "{{name}}", "short_name": "{{name}}", "display": "standalone", "start_url": "/", "theme_color": "#000000"}',
        },
        {
          path: "public/sw.js",
          content:
            '// Service Worker\nconst CACHE_NAME = "{{name}}-v1";\nself.addEventListener("install", (event) => {\n  event.waitUntil(caches.open(CACHE_NAME));\n});',
        },
      ],
    });

    // ---- Data Pipeline ----

    this.templates.set("etl-pipeline", {
      id: "etl-pipeline",
      name: "ETL Pipeline",
      description:
        "Data pipeline with BullMQ job scheduling, ETL stages, and quality monitoring",
      category: "data",
      tags: ["etl", "pipeline", "bullmq", "data", "scheduling"],
      options: [
        {
          name: "name",
          description: "Pipeline name",
          type: "string",
          default: "my-pipeline",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/pipeline.ts",
          content:
            "// Pipeline definition\nexport interface PipelineStage {\n  name: string;\n  execute: (data: unknown) => Promise<unknown>;\n}\n\nexport class Pipeline {\n  private stages: PipelineStage[] = [];\n  addStage(stage: PipelineStage) { this.stages.push(stage); return this; }\n  async run(input: unknown) {\n    let data = input;\n    for (const stage of this.stages) { data = await stage.execute(data); }\n    return data;\n  }\n}",
        },
      ],
    });

    // ---- Auth ----

    this.templates.set("auth-starter", {
      id: "auth-starter",
      name: "Auth Starter",
      description:
        "Authentication system with OAuth 2.0, JWT tokens, session management, and RBAC",
      category: "auth",
      tags: ["auth", "oauth", "jwt", "rbac", "sessions"],
      options: [
        {
          name: "name",
          description: "Project name",
          type: "string",
          default: "my-auth",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/auth/jwt.ts",
          content:
            '// JWT utilities\nimport jwt from "jsonwebtoken";\n\nexport function signAccessToken(payload: Record<string, unknown>): string {\n  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "15m", algorithm: "RS256" });\n}',
        },
        {
          path: "src/auth/rbac.ts",
          content:
            '// RBAC middleware\nexport type Role = "owner" | "admin" | "member" | "viewer";\n\nexport function checkPermission(requiredRole: Role) {\n  return (req: Request) => {\n    // Verify user role meets minimum required role\n  };\n}',
        },
      ],
    });

    // ---- Real-time ----

    this.templates.set("realtime-chat", {
      id: "realtime-chat",
      name: "Real-time Chat",
      description:
        "WebSocket-based chat with rooms, presence tracking, typing indicators, and message persistence",
      category: "real-time",
      tags: ["websocket", "chat", "real-time", "presence"],
      options: [
        {
          name: "name",
          description: "App name",
          type: "string",
          default: "my-chat",
        },
      ],
      files: [
        {
          path: "package.json",
          content: '{"name": "{{name}}", "version": "0.1.0"}',
        },
        {
          path: "src/server.ts",
          content:
            'import { Server } from "socket.io";\nconst io = new Server(3001, { cors: { origin: "*" } });\nio.on("connection", (socket) => {\n  socket.on("join", (room) => socket.join(room));\n  socket.on("message", (data) => socket.to(data.room).emit("message", data));\n});',
        },
      ],
    });
  }
}

export type { ApplyResult, TemplateFile, TemplateInfo, TemplateOption };
