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
            dev: "tsx watch src/index.ts",
            build: "tsc",
            start: "node dist/index.js",
            lint: "eslint src/",
            typecheck: "tsc --noEmit",
            test: "vitest run",
            "db:push": "prisma db push",
            "db:generate": "prisma generate",
            "db:migrate": "prisma migrate dev",
            "db:studio": "prisma studio",
          },
          dependencies: {
            express: "^5.0.0",
            prisma: "^6.0.0",
            "@prisma/client": "^6.0.0",
            zod: "^3.23.0",
            cors: "^2.8.5",
            helmet: "^8.0.0",
            "express-rate-limit": "^7.0.0",
            pino: "^9.0.0",
            "pino-pretty": "^13.0.0",
            dotenv: "^16.4.0",
          },
          devDependencies: {
            typescript: "^5.7.0",
            "@types/node": "^22.0.0",
            "@types/express": "^5.0.0",
            "@types/cors": "^2.8.0",
            tsx: "^4.19.0",
            vitest: "^3.0.0",
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
            module: "NodeNext",
            moduleResolution: "NodeNext",
            outDir: "dist",
            rootDir: "src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            declaration: true,
          },
          include: ["src"],
          exclude: ["node_modules", "dist"],
        },
        null,
        2
      ),
    },
    {
      path: "prisma/schema.prisma",
      content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("users")
}
`,
    },
    {
      path: "src/index.ts",
      content: `import cors from "cors";
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { pino } from "pino";
import { healthRouter } from "./routes/health.js";
import { usersRouter } from "./routes/users.js";

const logger = pino({ transport: { target: "pino-pretty" } });
const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);
app.use("/api/users", usersRouter);

app.listen(port, () => {
  logger.info(\`Server running on http://localhost:\${port}\`);
});
`,
    },
    {
      path: "src/lib/prisma.ts",
      content: `import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
`,
    },
    {
      path: "src/routes/health.ts",
      content: `import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
`,
    },
    {
      path: "src/routes/users.ts",
      content: `import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

export const usersRouter = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  res.json(users);
});

usersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.flatten() });
    return;
  }
  const user = await prisma.user.create({ data: parsed.data });
  res.status(201).json(user);
});
`,
    },
    {
      path: ".env.example",
      content: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${projectName}
PORT=4000
`,
    },
    {
      path: ".gitignore",
      content: `node_modules/
dist/
.env
*.tsbuildinfo
`,
    },
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

FROM base AS runner
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 4000
CMD ["node", "dist/index.js"]
`,
    },
    {
      path: "README.md",
      content: `# ${projectName}

Express.js REST API with **Prisma** ORM and **PostgreSQL**.

## Getting Started

\`\`\`bash
pnpm install
cp .env.example .env
pnpm db:push
pnpm dev          # http://localhost:4000
\`\`\`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /api/users | List users |
| POST | /api/users | Create user |
`,
    },
  ];
}

export const EXPRESS_API_TEMPLATE: ProjectTemplate = {
  id: "express-api",
  name: "Express API",
  description:
    "Express.js REST API with Prisma ORM, Zod validation, and PostgreSQL.",
  category: "Backend",
  techStack: ["Express", "Prisma", "Zod", "PostgreSQL"],
  languages: ["TypeScript"],
  icon: "server",
  estimatedMinutes: 5,
  scaffoldFiles,
};
