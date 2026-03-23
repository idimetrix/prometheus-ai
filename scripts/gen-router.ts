#!/usr/bin/env tsx

/**
 * Scaffolds a new tRPC router file with standard boilerplate.
 *
 * Usage: pnpm gen:router <router-name>
 * Example: pnpm gen:router notifications
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const name = process.argv[2];

if (!name) {
  console.error("Usage: pnpm gen:router <router-name>");
  console.error("Example: pnpm gen:router notifications");
  process.exit(1);
}

const routersDir = resolve(process.cwd(), "apps", "api", "src", "routers");

if (!existsSync(routersDir)) {
  mkdirSync(routersDir, { recursive: true });
}

const fileName = `${name}.ts`;
const filePath = resolve(routersDir, fileName);

if (existsSync(filePath)) {
  console.error(`Router file already exists: ${filePath}`);
  process.exit(1);
}

const camelName = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const content = `import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const ${camelName}Router = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // TODO: Implement list query
      return {
        items: [],
        nextCursor: undefined as string | undefined,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // TODO: Implement get by ID
      return null;
    }),

  create: protectedProcedure
    .input(
      z.object({
        // TODO: Define create input schema
      })
    )
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement create mutation
      return { id: "" };
    }),
});
`;

writeFileSync(filePath, content);

console.log(`Created tRPC router: ${filePath}`);
console.log("");
console.log("Next steps:");
console.log(`  1. Import and add ${camelName}Router to the app router`);
console.log("  2. Implement the query/mutation handlers");
console.log("  3. Add input validation schemas");
