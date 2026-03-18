import type { TechStackPresetExtended } from "./types";

export const NEXTJS_PRESET: TechStackPresetExtended = {
  id: "nextjs-fullstack",
  name: "Next.js Full-Stack",
  description:
    "Next.js 16 + React 19 + tRPC + Drizzle + PostgreSQL + Tailwind CSS 4",
  languages: ["TypeScript"],
  frameworks: ["Next.js 16", "React 19", "tRPC v11", "Tailwind CSS 4"],
  database: "PostgreSQL 16",
  orm: "Drizzle ORM",
  auth: "Clerk",
  testing: ["Vitest", "Playwright", "Testing Library"],
  deployment: ["Docker", "Vercel", "GitHub Actions"],
  packageManager: "pnpm",
  linters: ["ESLint", "Prettier"],
  icon: "globe",

  dependencies: {
    runtime: {
      next: "^16.0.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      "@trpc/server": "^11.0.0",
      "@trpc/client": "^11.0.0",
      "@trpc/react-query": "^11.0.0",
      "@tanstack/react-query": "^5.0.0",
      "drizzle-orm": "^0.38.0",
      postgres: "^3.4.0",
      tailwindcss: "^4.0.0",
      zod: "^3.23.0",
    },
    dev: {
      typescript: "^5.7.0",
      vitest: "^3.0.0",
      "@playwright/test": "^1.49.0",
      "drizzle-kit": "^0.30.0",
      eslint: "^9.0.0",
    },
  },

  fileTemplates: {
    "src/app/layout.tsx":
      "Root layout with providers (tRPC, React Query, Clerk)",
    "src/app/page.tsx": "Landing page with hero section",
    "src/server/db/schema.ts": "Drizzle schema definitions",
    "src/server/trpc/router.ts": "tRPC app router with auth middleware",
    "src/lib/trpc.ts": "tRPC client setup with React Query",
    "drizzle.config.ts": "Drizzle Kit configuration",
    "tailwind.config.ts": "Tailwind CSS 4 configuration",
  },

  conventions: {
    routing: "App Router with file-based routing",
    stateManagement: "React Query for server state, Zustand for client state",
    apiPattern: "tRPC procedures with Zod validation",
    componentPattern:
      "Server Components by default, 'use client' only when needed",
    styling: "Tailwind CSS utility classes, shadcn/ui components",
  },

  agentHints: {
    architect:
      "Design with Next.js App Router patterns. Use server components for data fetching. tRPC for type-safe API layer.",
    frontend_coder:
      "Use Server Components by default. Add 'use client' only for interactivity. Use shadcn/ui for components.",
    backend_coder:
      "Define tRPC routers with Zod input validation. Use Drizzle ORM for all database queries. Never use raw SQL.",
    test_engineer:
      "Use Vitest for unit tests, Playwright for E2E. Test tRPC procedures directly.",
    deploy_engineer:
      "Build with 'next build'. Deploy to Vercel or Docker. Use multi-stage Docker builds.",
  },
};
