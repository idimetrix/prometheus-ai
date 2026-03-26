import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [
      // ExecutionEngine integration tests require a running model-router and
      // database — they time out in unit-test CI. Tracked as a known issue.
      "src/engine/__tests__/execution-engine.test.ts",
    ],
  },
});
