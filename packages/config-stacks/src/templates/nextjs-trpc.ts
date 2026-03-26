import type { ProjectTemplate, ScaffoldFile } from "./types";

function scaffoldFiles(projectName: string): ScaffoldFile[] {
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
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "next lint",
            "db:push": "drizzle-kit push",
            "db:generate": "drizzle-kit generate",
            "db:migrate": "drizzle-kit migrate",
            "db:studio": "drizzle-kit studio",
            typecheck: "tsc --noEmit",
            test: "vitest run",
          },
          dependencies: {
            next: "^15.0.0",
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            "@trpc/server": "^11.0.0",
            "@trpc/client": "^11.0.0",
            "@trpc/react-query": "^11.0.0",
            "@tanstack/react-query": "^5.0.0",
            "drizzle-orm": "^0.38.0",
            postgres: "^3.4.0",
            zod: "^3.23.0",
            tailwindcss: "^4.0.0",
            "@tailwindcss/vite": "^4.0.0",
            "lucide-react": "^0.400.0",
            superjson: "^2.2.0",
          },
          devDependencies: {
            typescript: "^5.7.0",
            "@types/node": "^22.0.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            vitest: "^3.0.0",
            "drizzle-kit": "^0.30.0",
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
            target: "ES2022",
            lib: ["dom", "dom.iterable", "ES2022"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./src/*"] },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
          exclude: ["node_modules"],
        },
        null,
        2
      ),
    },
    {
      path: "next.config.ts",
      content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`,
    },
    {
      path: "drizzle.config.ts",
      content: `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
`,
    },
    {
      path: ".env.example",
      content: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${projectName}
`,
    },
    {
      path: ".gitignore",
      content: `node_modules/
.next/
.env
.env.local
dist/
*.tsbuildinfo
`,
    },
    {
      path: "src/app/layout.tsx",
      content: `import type { Metadata } from "next";
import "@/styles/globals.css";
import { TRPCProvider } from "@/lib/trpc-provider";

export const metadata: Metadata = {
  title: "${projectName}",
  description: "Built with Next.js, tRPC, and Tailwind CSS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
`,
    },
    {
      path: "src/app/page.tsx",
      content: `export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-bold text-4xl tracking-tight">${projectName}</h1>
      <p className="max-w-md text-center text-lg text-neutral-600">
        Your project is ready. Start editing{" "}
        <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-sm">
          src/app/page.tsx
        </code>
      </p>
    </main>
  );
}
`,
    },
    {
      path: "src/styles/globals.css",
      content: `@import "tailwindcss";
`,
    },
    {
      path: "src/server/db/schema.ts",
      content: `import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
`,
    },
    {
      path: "src/server/db/index.ts",
      content: `import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
export const db = drizzle(client, { schema });
`,
    },
    {
      path: "src/server/trpc/init.ts",
      content: `import { initTRPC } from "@trpc/server";
import superjson from "superjson";

const t = initTRPC.create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
`,
    },
    {
      path: "src/server/trpc/router.ts",
      content: `import { z } from "zod";
import { publicProcedure, router } from "./init";

export const appRouter = router({
  hello: publicProcedure
    .input(z.object({ name: z.string().optional() }))
    .query(({ input }) => {
      return { greeting: \`Hello \${input.name ?? "world"}!\` };
    }),
});

export type AppRouter = typeof appRouter;
`,
    },
    {
      path: "src/lib/trpc-provider.tsx",
      content: `"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState } from "react";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/router";

export const trpc = createTRPCReact<AppRouter>();

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
`,
    },
    {
      path: "src/app/api/trpc/[trpc]/route.ts",
      content: `import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/router";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => ({}),
  });

export { handler as GET, handler as POST };
`,
    },
    {
      path: "README.md",
      content: `# ${projectName}

Built with **Next.js**, **tRPC**, **Drizzle ORM**, **Tailwind CSS**, and **shadcn/ui**.

## Getting Started

\`\`\`bash
pnpm install
cp .env.example .env   # configure DATABASE_URL
pnpm db:push           # create tables
pnpm dev               # start dev server at http://localhost:3000
\`\`\`

## Scripts

| Command | Description |
|---------|-------------|
| \`pnpm dev\` | Start development server |
| \`pnpm build\` | Build for production |
| \`pnpm db:push\` | Push schema changes |
| \`pnpm db:studio\` | Open Drizzle Studio |
| \`pnpm test\` | Run tests |
| \`pnpm typecheck\` | Type-check the project |
`,
    },
  ];
}

export const NEXTJS_TRPC_TEMPLATE: ProjectTemplate = {
  id: "nextjs-trpc",
  name: "Next.js + tRPC",
  description:
    "Full-stack Next.js app with tRPC API layer, Drizzle ORM, Tailwind CSS, and shadcn/ui components.",
  category: "Full-Stack",
  techStack: ["Next.js", "tRPC", "Tailwind CSS", "Drizzle", "shadcn/ui"],
  languages: ["TypeScript"],
  icon: "globe",
  estimatedMinutes: 5,
  scaffoldFiles,
};
