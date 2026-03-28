/**
 * Scaffold Templates — GAP-025
 *
 * Pre-defined project templates for common tech stacks.
 * Each template provides a complete set of scaffold files
 * that can be used to bootstrap a new project.
 */

import type { ProjectTemplate, ScaffoldFile } from "./types";

// ---------------------------------------------------------------------------
// nextjs-app template
// ---------------------------------------------------------------------------

const nextjsApp: ProjectTemplate = {
  id: "nextjs-app",
  name: "Next.js App",
  description: "Next.js 14+ with App Router, Tailwind CSS, and shadcn/ui",
  category: "Full-Stack",
  languages: ["typescript"],
  techStack: ["Next.js", "Tailwind CSS", "shadcn/ui", "TypeScript"],
  icon: "nextjs",
  estimatedMinutes: 5,
  scaffoldFiles(projectName: string): ScaffoldFile[] {
    return [
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: projectName,
            version: "0.1.0",
            private: true,
            scripts: {
              dev: "next dev",
              build: "next build",
              start: "next start",
              lint: "biome check .",
            },
          },
          null,
          2
        ),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify(
          {
            compilerOptions: {
              target: "ES2017",
              lib: ["dom", "dom.iterable", "esnext"],
              module: "esnext",
              moduleResolution: "bundler",
              jsx: "preserve",
              strict: true,
              paths: { "@/*": ["./src/*"] },
            },
            include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
          },
          null,
          2
        ),
      },
      {
        path: "tailwind.config.ts",
        content: `import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
`,
      },
      {
        path: "src/app/layout.tsx",
        content: `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "${projectName}",
  description: "Built with Next.js and Tailwind CSS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      },
      {
        path: "src/app/page.tsx",
        content: `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">${projectName}</h1>
    </main>
  );
}
`,
      },
      {
        path: "src/app/globals.css",
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// express-api template
// ---------------------------------------------------------------------------

const expressApi: ProjectTemplate = {
  id: "express-api",
  name: "Express API",
  description:
    "Express.js REST API with TypeScript, Drizzle ORM, and Zod validation",
  category: "Backend",
  languages: ["typescript"],
  techStack: ["Express", "TypeScript", "Drizzle", "Zod"],
  icon: "express",
  estimatedMinutes: 5,
  scaffoldFiles(projectName: string): ScaffoldFile[] {
    return [
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: projectName,
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: {
              dev: "tsx watch src/index.ts",
              build: "tsc",
              start: "node dist/index.js",
              test: "vitest",
              "db:push": "drizzle-kit push",
              "db:generate": "drizzle-kit generate",
            },
          },
          null,
          2
        ),
      },
      {
        path: "src/index.ts",
        content: `import express from "express";
import cors from "cors";
import { router } from "./routes";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use("/api", router);
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
`,
      },
      {
        path: "src/routes/index.ts",
        content: `import { Router } from "express";

export const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "API is running" });
});
`,
      },
      {
        path: "src/db/index.ts",
        content: `import { drizzle } from "drizzle-orm/node-postgres";

export const db = drizzle(process.env.DATABASE_URL!);
`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// fastapi template
// ---------------------------------------------------------------------------

const fastapiTemplate: ProjectTemplate = {
  id: "fastapi",
  name: "FastAPI",
  description:
    "Python FastAPI with SQLAlchemy, Pydantic, and Alembic migrations",
  category: "Backend",
  languages: ["python"],
  techStack: ["FastAPI", "SQLAlchemy", "Pydantic", "Alembic"],
  icon: "python",
  estimatedMinutes: 5,
  scaffoldFiles(projectName: string): ScaffoldFile[] {
    return [
      {
        path: "requirements.txt",
        content: `fastapi>=0.100.0
uvicorn>=0.23.0
sqlalchemy>=2.0.0
alembic>=1.11.0
pydantic>=2.0.0
python-dotenv>=1.0.0
httpx>=0.24.0
pytest>=7.4.0
`,
      },
      {
        path: "app/main.py",
        content: `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="${projectName}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "ok"}
`,
      },
      {
        path: "app/models/__init__.py",
        content: `# Database models
`,
      },
      {
        path: "app/routes/__init__.py",
        content: `# API routes
`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// go-api template
// ---------------------------------------------------------------------------

const goApi: ProjectTemplate = {
  id: "go-api",
  name: "Go API",
  description: "Go REST API with Chi router and pgx database driver",
  category: "Backend",
  languages: ["go"],
  techStack: ["Go", "Chi", "pgx", "PostgreSQL"],
  icon: "go",
  estimatedMinutes: 5,
  scaffoldFiles(projectName: string): ScaffoldFile[] {
    return [
      {
        path: "go.mod",
        content: `module github.com/org/${projectName}

go 1.21

require (
\tgithub.com/go-chi/chi/v5 v5.0.10
\tgithub.com/jackc/pgx/v5 v5.4.3
)
`,
      },
      {
        path: "cmd/server/main.go",
        content: `package main

import (
\t"log"
\t"net/http"
\t"os"

\t"github.com/go-chi/chi/v5"
\t"github.com/go-chi/chi/v5/middleware"
)

func main() {
\tr := chi.NewRouter()
\tr.Use(middleware.Logger)
\tr.Use(middleware.Recoverer)

\tr.Get("/health", func(w http.ResponseWriter, r *http.Request) {
\t\tw.Write([]byte("ok"))
\t})

\tport := os.Getenv("PORT")
\tif port == "" {
\t\tport = "8080"
\t}

\tlog.Printf("Server starting on port %s", port)
\tlog.Fatal(http.ListenAndServe(":"+port, r))
}
`,
      },
      {
        path: "internal/handler/health.go",
        content: `package handler

import "net/http"

func HealthCheck(w http.ResponseWriter, r *http.Request) {
\tw.WriteHeader(http.StatusOK)
\tw.Write([]byte("ok"))
}
`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// react-vite template
// ---------------------------------------------------------------------------

const reactVite: ProjectTemplate = {
  id: "react-vite",
  name: "React + Vite",
  description: "React 18+ with Vite, Tailwind CSS, and TypeScript",
  category: "Frontend",
  languages: ["typescript"],
  techStack: ["React", "Vite", "Tailwind CSS", "TypeScript"],
  icon: "react",
  estimatedMinutes: 3,
  scaffoldFiles(projectName: string): ScaffoldFile[] {
    return [
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: projectName,
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: {
              dev: "vite",
              build: "tsc && vite build",
              preview: "vite preview",
              test: "vitest",
            },
          },
          null,
          2
        ),
      },
      {
        path: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: "src/main.tsx",
        content: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,
      },
      {
        path: "src/App.tsx",
        content: `export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <h1 className="text-4xl font-bold">${projectName}</h1>
    </div>
  );
}
`,
      },
      {
        path: "src/index.css",
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// fullstack-saas template
// ---------------------------------------------------------------------------

const fullstackSaas: ProjectTemplate = {
  id: "fullstack-saas",
  name: "Full-Stack SaaS",
  description:
    "Next.js + tRPC + Drizzle + Auth + Stripe: complete SaaS starter",
  category: "Full-Stack",
  languages: ["typescript"],
  techStack: [
    "Next.js",
    "tRPC",
    "Drizzle",
    "NextAuth",
    "Stripe",
    "Tailwind CSS",
  ],
  icon: "saas",
  estimatedMinutes: 10,
  scaffoldFiles(projectName: string): ScaffoldFile[] {
    return [
      {
        path: "package.json",
        content: JSON.stringify(
          {
            name: projectName,
            version: "0.1.0",
            private: true,
            scripts: {
              dev: "next dev",
              build: "next build",
              start: "next start",
              lint: "biome check .",
              test: "vitest",
              "db:push": "drizzle-kit push",
              "db:generate": "drizzle-kit generate",
              "db:studio": "drizzle-kit studio",
              stripe:
                "stripe listen --forward-to localhost:3000/api/webhooks/stripe",
            },
          },
          null,
          2
        ),
      },
      {
        path: "src/app/layout.tsx",
        content: `import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "${projectName}",
  description: "SaaS application",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
`,
      },
      {
        path: "src/server/trpc/router.ts",
        content: `import { initTRPC } from "@trpc/server";
import { z } from "zod";

const t = initTRPC.create();

export const appRouter = t.router({
  health: t.procedure.query(() => ({ status: "ok" })),
});

export type AppRouter = typeof appRouter;
`,
      },
      {
        path: "src/server/db/schema.ts",
        content: `import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
`,
      },
      {
        path: "src/app/globals.css",
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Template Registry
// ---------------------------------------------------------------------------

/**
 * All available scaffold templates indexed by ID.
 */
export const SCAFFOLD_TEMPLATES: Record<string, ProjectTemplate> = {
  "nextjs-app": nextjsApp,
  "express-api": expressApi,
  fastapi: fastapiTemplate,
  "go-api": goApi,
  "react-vite": reactVite,
  "fullstack-saas": fullstackSaas,
};

/**
 * Get a scaffold template by ID.
 */
export function getScaffoldTemplate(id: string): ProjectTemplate | null {
  return SCAFFOLD_TEMPLATES[id] ?? null;
}

/**
 * List all available scaffold templates.
 */
export function listAllScaffoldTemplates(): ProjectTemplate[] {
  return Object.values(SCAFFOLD_TEMPLATES);
}
