import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@prometheus/utils": path.resolve(
        import.meta.dirname,
        "../utils/src/index.ts"
      ),
    },
  },
  test: {
    globals: true,
  },
});
