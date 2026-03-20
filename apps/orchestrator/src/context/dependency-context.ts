/**
 * Dependency Context Builder — Provides dependency-aware context for code
 * generation by inspecting package manifests and suggesting packages.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:dependency-context");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackageInfo {
  devDependency: boolean;
  name: string;
  version: string;
}

export interface PackageAPI {
  commonUsage: string[];
  exports: string[];
  name: string;
  version: string;
}

export interface ImportValidation {
  invalidImports: Array<{ module: string; reason: string }>;
  valid: boolean;
}

export interface PackageSuggestion {
  confidence: number;
  name: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Known package exports knowledge base
// ---------------------------------------------------------------------------

const KNOWN_PACKAGE_EXPORTS: Record<
  string,
  { commonUsage: string[]; exports: string[] }
> = {
  zod: {
    exports: ["z", "ZodSchema", "ZodType", "ZodError"],
    commonUsage: [
      "const schema = z.object({ name: z.string() })",
      "schema.parse(data)",
      "schema.safeParse(data)",
    ],
  },
  hono: {
    exports: ["Hono", "Context"],
    commonUsage: [
      "const app = new Hono()",
      "app.get('/path', (c) => c.json({}))",
      "app.post('/path', async (c) => { const body = await c.req.json() })",
    ],
  },
  "drizzle-orm": {
    exports: ["eq", "and", "or", "desc", "asc", "sql", "inArray"],
    commonUsage: [
      "db.select().from(table).where(eq(table.id, id))",
      "db.insert(table).values(data).returning()",
      "db.update(table).set(data).where(eq(table.id, id))",
    ],
  },
  ioredis: {
    exports: ["Redis"],
    commonUsage: [
      "const redis = new Redis(url)",
      "await redis.get(key)",
      "await redis.set(key, value, 'EX', ttl)",
    ],
  },
};

const NEED_TO_PACKAGE: Record<string, PackageSuggestion> = {
  validation: {
    name: "zod",
    reason: "Runtime schema validation with TypeScript inference",
    confidence: 0.95,
  },
  http: {
    name: "hono",
    reason: "Lightweight HTTP framework with TypeScript support",
    confidence: 0.9,
  },
  database: {
    name: "drizzle-orm",
    reason: "Type-safe ORM with SQL-like query builder",
    confidence: 0.9,
  },
  queue: {
    name: "bullmq",
    reason: "Redis-based job queue with reliability features",
    confidence: 0.85,
  },
  cache: {
    name: "ioredis",
    reason: "Redis client for caching and pub/sub",
    confidence: 0.85,
  },
  logging: {
    name: "pino",
    reason: "Fast structured JSON logger",
    confidence: 0.9,
  },
  testing: {
    name: "vitest",
    reason: "Fast Vite-native test runner with Jest compatibility",
    confidence: 0.9,
  },
  uuid: {
    name: "nanoid",
    reason: "Compact, URL-friendly unique ID generator",
    confidence: 0.85,
  },
  date: {
    name: "date-fns",
    reason: "Modular date utility library",
    confidence: 0.8,
  },
  encryption: {
    name: "jose",
    reason: "JWT and JWE implementation for Node.js",
    confidence: 0.85,
  },
};

// ---------------------------------------------------------------------------
// DependencyContextBuilder
// ---------------------------------------------------------------------------

export class DependencyContextBuilder {
  /**
   * Read available packages from a package.json-like manifest.
   */
  getAvailablePackages(packageJson: Record<string, unknown>): PackageInfo[] {
    const packages: PackageInfo[] = [];

    const deps = (packageJson.dependencies ?? {}) as Record<string, string>;
    for (const [name, version] of Object.entries(deps)) {
      packages.push({ name, version, devDependency: false });
    }

    const devDeps = (packageJson.devDependencies ?? {}) as Record<
      string,
      string
    >;
    for (const [name, version] of Object.entries(devDeps)) {
      packages.push({ name, version, devDependency: true });
    }

    logger.debug({ count: packages.length }, "Extracted available packages");

    return packages;
  }

  /**
   * Get known exports and usage patterns for a package.
   */
  getPackageAPI(packageName: string): PackageAPI {
    const known = KNOWN_PACKAGE_EXPORTS[packageName];

    if (known) {
      return {
        name: packageName,
        version: "latest",
        exports: known.exports,
        commonUsage: known.commonUsage,
      };
    }

    return {
      name: packageName,
      version: "unknown",
      exports: [],
      commonUsage: [],
    };
  }

  /**
   * Suggest a package for a given need.
   */
  suggestPackage(need: string): PackageSuggestion | null {
    const normalized = need.toLowerCase().trim();

    if (NEED_TO_PACKAGE[normalized]) {
      return NEED_TO_PACKAGE[normalized];
    }

    for (const [key, suggestion] of Object.entries(NEED_TO_PACKAGE)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return suggestion;
      }
    }

    logger.debug({ need }, "No package suggestion found");
    return null;
  }

  /**
   * Validate that all imports in code reference available packages.
   */
  validateImports(
    code: string,
    availablePackages: PackageInfo[]
  ): ImportValidation {
    const importPattern = /(?:import|require)\s*\(?['"]([^'"./][^'"]*)['"]\)?/g;
    const availableNames = new Set(availablePackages.map((p) => p.name));

    for (const pkg of availablePackages) {
      if (pkg.name.startsWith("@")) {
        availableNames.add(pkg.name);
      }
    }

    const invalidImports: Array<{ module: string; reason: string }> = [];

    let match = importPattern.exec(code);
    while (match) {
      const moduleName = match[1] ?? "";

      if (isNodeBuiltin(moduleName)) {
        match = importPattern.exec(code);
        continue;
      }

      const baseName = moduleName.startsWith("@")
        ? moduleName.split("/").slice(0, 2).join("/")
        : (moduleName.split("/")[0] ?? moduleName);

      if (!availableNames.has(baseName)) {
        invalidImports.push({
          module: moduleName,
          reason: `Package "${baseName}" is not listed in dependencies`,
        });
      }

      match = importPattern.exec(code);
    }

    return {
      valid: invalidImports.length === 0,
      invalidImports,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
  "node:assert",
  "node:buffer",
  "node:child_process",
  "node:crypto",
  "node:events",
  "node:fs",
  "node:http",
  "node:https",
  "node:net",
  "node:os",
  "node:path",
  "node:process",
  "node:stream",
  "node:url",
  "node:util",
  "node:worker_threads",
  "node:zlib",
]);

function isNodeBuiltin(moduleName: string): boolean {
  return NODE_BUILTINS.has(moduleName) || moduleName.startsWith("node:");
}
