import type { ProjectTemplate, ScaffoldFile } from "./types";

function scaffoldFiles(projectName: string): ScaffoldFile[] {
  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: projectName,
          private: true,
          scripts: {
            dev: "turbo dev",
            build: "turbo build",
            lint: "turbo lint",
            typecheck: "turbo typecheck",
            test: "turbo test",
            clean: "turbo clean",
          },
          devDependencies: {
            turbo: "^2.3.0",
          },
          packageManager: "pnpm@9.15.0",
        },
        null,
        2
      ),
    },
    {
      path: "turbo.json",
      content: JSON.stringify(
        {
          $schema: "https://turbo.build/schema.json",
          tasks: {
            build: {
              dependsOn: ["^build"],
              outputs: ["dist/**", ".next/**"],
            },
            dev: {
              cache: false,
              persistent: true,
            },
            lint: { dependsOn: ["^build"] },
            typecheck: { dependsOn: ["^build"] },
            test: {},
            clean: { cache: false },
          },
        },
        null,
        2
      ),
    },
    {
      path: "pnpm-workspace.yaml",
      content: `packages:
  - "apps/*"
  - "packages/*"
`,
    },
    {
      path: "apps/web/package.json",
      content: JSON.stringify(
        {
          name: `@${projectName}/web`,
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev --port 3000",
            build: "next build",
            start: "next start",
            typecheck: "tsc --noEmit",
          },
          dependencies: {
            next: "^15.0.0",
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            [`@${projectName}/ui`]: "workspace:*",
            [`@${projectName}/utils`]: "workspace:*",
          },
          devDependencies: {
            typescript: "^5.7.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
          },
        },
        null,
        2
      ),
    },
    {
      path: "apps/web/next.config.ts",
      content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@${projectName}/ui"],
};

export default nextConfig;
`,
    },
    {
      path: "apps/web/tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "dom.iterable", "ES2022"],
            jsx: "preserve",
            module: "esnext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
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
      path: "apps/web/src/app/layout.tsx",
      content: `import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "${projectName}",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    },
    {
      path: "apps/web/src/app/page.tsx",
      content: `export default function Home() {
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <h1>${projectName}</h1>
      <p>Turborepo monorepo is ready.</p>
    </main>
  );
}
`,
    },
    {
      path: "apps/api/package.json",
      content: JSON.stringify(
        {
          name: `@${projectName}/api`,
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsc",
            start: "node dist/index.js",
            typecheck: "tsc --noEmit",
          },
          dependencies: {
            hono: "^4.6.0",
            [`@${projectName}/utils`]: "workspace:*",
          },
          devDependencies: {
            typescript: "^5.7.0",
            "@types/node": "^22.0.0",
            tsx: "^4.19.0",
          },
        },
        null,
        2
      ),
    },
    {
      path: "apps/api/tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            outDir: "dist",
            rootDir: "src",
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
          exclude: ["node_modules", "dist"],
        },
        null,
        2
      ),
    },
    {
      path: "apps/api/src/index.ts",
      content: `import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/hello", (c) => {
  const name = c.req.query("name") ?? "world";
  return c.json({ greeting: \`Hello \${name}!\` });
});

serve({ fetch: app.fetch, port: 4000 }, (info) => {
  console.log(\`API running on http://localhost:\${info.port}\`);
});
`,
    },
    {
      path: "packages/ui/package.json",
      content: JSON.stringify(
        {
          name: `@${projectName}/ui`,
          version: "0.1.0",
          private: true,
          main: "./src/index.ts",
          types: "./src/index.ts",
          scripts: {
            typecheck: "tsc --noEmit",
          },
          dependencies: {
            react: "^19.0.0",
          },
          devDependencies: {
            typescript: "^5.7.0",
            "@types/react": "^19.0.0",
          },
        },
        null,
        2
      ),
    },
    {
      path: "packages/ui/src/index.ts",
      content: `export { Button } from "./button";
`,
    },
    {
      path: "packages/ui/src/button.tsx",
      content: `interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

export function Button({ variant = "primary", children, ...props }: ButtonProps) {
  return (
    <button
      style={{
        padding: "8px 16px",
        borderRadius: "6px",
        border: "none",
        cursor: "pointer",
        backgroundColor: variant === "primary" ? "#0070f3" : "#eaeaea",
        color: variant === "primary" ? "#fff" : "#000",
      }}
      {...props}
    >
      {children}
    </button>
  );
}
`,
    },
    {
      path: "packages/ui/tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            jsx: "react-jsx",
            module: "esnext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2
      ),
    },
    {
      path: "packages/utils/package.json",
      content: JSON.stringify(
        {
          name: `@${projectName}/utils`,
          version: "0.1.0",
          private: true,
          main: "./src/index.ts",
          types: "./src/index.ts",
          scripts: {
            typecheck: "tsc --noEmit",
          },
          devDependencies: {
            typescript: "^5.7.0",
          },
        },
        null,
        2
      ),
    },
    {
      path: "packages/utils/src/index.ts",
      content: `export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
`,
    },
    {
      path: "packages/utils/tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "esnext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2
      ),
    },
    {
      path: ".gitignore",
      content: `node_modules/
dist/
.next/
.turbo/
.env
*.tsbuildinfo
`,
    },
    {
      path: "README.md",
      content: `# ${projectName}

Turborepo monorepo with **Next.js** web app, **Hono** API, and shared packages.

## Structure

\`\`\`
apps/
  web/   - Next.js frontend
  api/   - Hono API server
packages/
  ui/    - Shared React components
  utils/ - Shared utilities
\`\`\`

## Getting Started

\`\`\`bash
pnpm install
pnpm dev         # Start all services
\`\`\`

| App | URL |
|-----|-----|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
`,
    },
  ];
}

export const MONOREPO_TURBO_TEMPLATE: ProjectTemplate = {
  id: "monorepo-turbo",
  name: "Turborepo Monorepo",
  description:
    "Turborepo monorepo with Next.js web app, Hono API server, and shared UI/utils packages.",
  category: "Monorepo",
  techStack: ["Turborepo", "Next.js", "Hono", "pnpm"],
  languages: ["TypeScript"],
  icon: "layers",
  estimatedMinutes: 7,
  scaffoldFiles,
};
