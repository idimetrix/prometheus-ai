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
      "@prometheus/telemetry": path.resolve(root, "packages/telemetry/src"),
      "@prometheus/db": path.resolve(root, "packages/db/src"),
      "@prometheus/queue": path.resolve(root, "packages/queue/src"),
      "@prometheus/auth": path.resolve(root, "packages/auth/src"),
      "@prometheus/billing": path.resolve(root, "packages/billing/src"),
      "@prometheus/validators": path.resolve(root, "packages/validators/src"),
      "@prometheus/ai": path.resolve(root, "packages/ai/src"),
      "@prometheus/notifications": path.resolve(
        root,
        "packages/notifications/src"
      ),
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
