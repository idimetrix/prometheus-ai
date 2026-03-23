#!/usr/bin/env tsx

/**
 * Scaffolds a new package in packages/ with standard boilerplate.
 *
 * Usage: pnpm gen:package <package-name>
 * Example: pnpm gen:package my-utils
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const name = process.argv[2];

if (!name) {
  console.error("Usage: pnpm gen:package <package-name>");
  console.error("Example: pnpm gen:package my-utils");
  process.exit(1);
}

const packageDir = resolve(process.cwd(), "packages", name);
const srcDir = resolve(packageDir, "src");

// Create directories
mkdirSync(srcDir, { recursive: true });

// package.json
const packageJson = {
  name: `@prometheus/${name}`,
  version: "0.0.1",
  private: true,
  type: "module",
  main: "./src/index.ts",
  types: "./src/index.ts",
  scripts: {
    typecheck: "tsc --noEmit",
    clean: "rm -rf dist .turbo",
  },
  devDependencies: {
    "@prometheus/config-typescript": "workspace:*",
    "@types/node": "^25.5.0",
    typescript: "^5.9.3",
  },
};

writeFileSync(
  resolve(packageDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
);

// tsconfig.json
const tsconfig = {
  extends: "@prometheus/config-typescript/base.json",
  compilerOptions: {
    rootDir: "./src",
    outDir: "./dist",
  },
  include: ["src"],
};

writeFileSync(
  resolve(packageDir, "tsconfig.json"),
  `${JSON.stringify(tsconfig, null, 2)}\n`
);

// src/index.ts
writeFileSync(
  resolve(srcDir, "index.ts"),
  `// @prometheus/${name}\n// Add your exports here.\n`
);

console.log(`Created package @prometheus/${name} at packages/${name}/`);
console.log("Files:");
console.log(`  packages/${name}/package.json`);
console.log(`  packages/${name}/tsconfig.json`);
console.log(`  packages/${name}/src/index.ts`);
console.log("");
console.log("Next steps:");
console.log("  1. Run `pnpm install` to link the new package");
console.log("  2. Add dependencies as needed");
