import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@prometheus/test-utils": path.resolve(root, "packages/test-utils/src"),
      "@prometheus/utils": path.resolve(root, "packages/utils/src"),
      "@prometheus/logger": path.resolve(root, "packages/logger/src"),
      "@prometheus/types": path.resolve(root, "packages/types/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 30_000,
    root: path.resolve(import.meta.dirname),
  },
});
