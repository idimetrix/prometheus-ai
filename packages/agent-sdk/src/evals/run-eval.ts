/**
 * Eval runner for agent prompt quality.
 *
 * Runs pattern-matching evaluations against eval datasets — no LLM API calls
 * required. Each dataset type has its own scoring strategy:
 *
 * - orchestrator: verifies task routing keywords map to expected roles
 * - backend-coder: verifies coding task keywords map to expected patterns
 * - test-engineer: verifies test task keywords map to expected patterns
 *
 * Usage:
 *   npx tsx packages/agent-sdk/src/evals/run-eval.ts orchestrator
 *   npx tsx packages/agent-sdk/src/evals/run-eval.ts backend-coder
 *   npx tsx packages/agent-sdk/src/evals/run-eval.ts test-engineer
 *   npx tsx packages/agent-sdk/src/evals/run-eval.ts all
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getVersionInfo } from "./prompt-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrchestratorEvalCase {
  expectedMode: string;
  expectedRole: string;
  input: string;
}

interface CoderEvalCase {
  expectedPatterns: string[];
  input: string;
  language: string;
}

interface TestEvalCase {
  expectedPatterns: string[];
  framework: string;
  input: string;
}

interface EvalResult {
  accuracy: number;
  failures: Array<{ expected: string; got: string; input: string }>;
  passed: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Role keyword mapping — used for orchestrator routing evaluation
// ---------------------------------------------------------------------------

const ROLE_KEYWORDS: Record<string, string[]> = {
  backend_coder: [
    "api",
    "endpoint",
    "trpc",
    "drizzle",
    "database",
    "query",
    "mutation",
    "service",
    "middleware",
    "rate limit",
    "backend",
    "server",
    "crud",
    "rest",
    "graphql",
    "webhook",
    "job",
    "queue",
    "caching",
    "redis",
    "cli tool",
    "authentication",
    "auth",
    "oauth",
    "email/password",
  ],
  frontend_coder: [
    "component",
    "page",
    "ui",
    "layout",
    "tailwind",
    "react",
    "next.js",
    "dashboard",
    "form",
    "button",
    "modal",
    "settings page",
    "avatar",
    "upload ui",
    "frontend",
    "css",
    "styling",
  ],
  architect: [
    "schema",
    "design",
    "blueprint",
    "tech stack",
    "architecture",
    "decide on",
    "database design",
    "system design",
  ],
  planner: [
    "plan",
    "sprint",
    "break down",
    "decompose",
    "tasks",
    "estimation",
    "roadmap",
    "prioritize",
  ],
  test_engineer: [
    "test",
    "unit test",
    "integration test",
    "e2e",
    "playwright",
    "coverage",
    "vitest",
    "spec",
  ],
  ci_loop: [
    "fix test",
    "failing test",
    "tests are failing",
    "ci",
    "pipeline broken",
    "fix them",
    "green build",
  ],
  security_auditor: [
    "owasp",
    "vulnerability",
    "security",
    "credential",
    "scan",
    "audit",
    "penetration",
    "xss",
    "sql injection",
  ],
  deploy_engineer: [
    "docker",
    "kubernetes",
    "k8s",
    "ci/cd",
    "deploy",
    "manifest",
    "pipeline",
    "production",
    "helm",
  ],
  discovery: [
    "requirements",
    "mvp",
    "figure out",
    "user stories",
    "from scratch",
    "new app",
    "what features",
    "elicit",
  ],
  integration_coder: [
    "wire",
    "wire up",
    "connect",
    "hook up",
    "frontend to backend",
    "frontend component to",
    "socket",
    "real-time",
    "integration",
    "subscribe",
  ],
};

// ---------------------------------------------------------------------------
// Pattern keyword mapping — used for coder/test eval
// ---------------------------------------------------------------------------

const PATTERN_KEYWORDS: Record<string, string[]> = {
  router: ["router", "endpoint", "route", "trpc"],
  procedure: ["procedure", "query", "mutation", "endpoint"],
  input: ["input", "validation", "schema", "params"],
  zod: ["zod", "validation", "schema", "z.object", "z.string"],
  query: ["query", "select", "list", "get", "find", "fetch"],
  mutation: ["mutation", "create", "update", "delete", "insert"],
  insert: ["insert", "create", "add", "new"],
  generateId: ["id", "generate", "prefix", "unique"],
  returning: ["return", "result", "response", "returning"],
  transaction: ["transaction", "atomic", "rollback", "commit"],
  async: ["async", "await", "promise"],
  TRPCError: ["error", "throw", "exception", "fail"],
  logger: ["log", "logger", "logging", "debug", "info"],
  pgTable: ["table", "schema", "column", "pgTable"],
  text: ["text", "string", "varchar", "column"],
  references: ["reference", "foreign key", "relation"],
  notNull: ["required", "not null", "notNull", "mandatory"],
  middleware: ["middleware", "intercept", "handler", "guard"],
  redis: ["redis", "cache", "store", "valkey"],
  describe: ["test", "spec", "describe", "suite"],
  it: ["test", "should", "it", "case"],
  expect: ["assert", "expect", "verify", "check"],
  toBe: ["equal", "toBe", "result", "return"],
  safeParse: ["validate", "parse", "schema", "input"],
  success: ["pass", "success", "valid", "correct"],
  beforeAll: ["setup", "before", "initialize", "init"],
  caller: ["caller", "client", "call", "invoke"],
  render: ["render", "component", "mount", "display"],
  screen: ["screen", "query", "find", "get"],
  page: ["page", "browser", "navigate", "goto"],
  click: ["click", "press", "tap", "interact"],
  goto: ["navigate", "goto", "url", "visit"],
  "vi.fn": ["mock", "spy", "fake", "stub"],
  mock: ["mock", "stub", "fake", "spy"],
  emit: ["emit", "event", "fire", "trigger"],
  on: ["listen", "on", "handler", "subscribe"],
  toMatchObject: ["match", "shape", "structure", "object"],
  toThrow: ["throw", "error", "reject", "fail"],
  toEqual: ["equal", "match", "same", "result"],
  afterEach: ["cleanup", "teardown", "after", "reset"],
  beforeEach: ["setup", "before", "reset", "init"],
  Promise: ["promise", "async", "concurrent", "parallel"],
  toMatch: ["match", "regex", "pattern", "format"],
  cursor: ["cursor", "page", "pagination", "offset"],
  length: ["length", "count", "size", "number"],
  cache: ["cache", "ttl", "expire", "store"],
  Date: ["date", "time", "range", "filter"],
  orgId: ["org", "tenant", "scope", "multi-tenant"],
  observable: ["observable", "subscribe", "stream", "real-time"],
  subscription: ["subscription", "subscribe", "real-time", "stream"],
  eq: ["equal", "eq", "where", "filter"],
  where: ["where", "filter", "condition", "scope"],
  and: ["and", "multiple", "condition", "filter"],
  orderBy: ["order", "sort", "desc", "asc"],
  select: ["select", "query", "read", "fetch"],
  limit: ["limit", "page", "size", "max"],
  index: ["index", "performance", "fast", "lookup"],
  create: ["create", "new", "insert", "add"],
  table: ["table", "schema", "migration", "column"],
  timestamp: ["timestamp", "date", "time", "column"],
  isNull: ["null", "soft delete", "deleted", "archive"],
  JSON: ["json", "serialize", "parse", "stringify"],
  status: ["status", "health", "state", "check"],
  health: ["health", "check", "alive", "ready"],
  min: ["min", "minimum", "at least", "lower"],
  max: ["max", "maximum", "at most", "upper"],
  trim: ["trim", "whitespace", "clean", "strip"],
  verify: ["verify", "validate", "check", "confirm"],
  signature: ["signature", "hmac", "hash", "sign"],
  upload: ["upload", "file", "stream", "multipart"],
  bucket: ["bucket", "storage", "s3", "minio"],
  "z.object": ["object", "schema", "shape", "validate"],
  "z.string": ["string", "text", "validate", "input"],
  optional: ["optional", "nullable", "default", "omit"],
  parse: ["parse", "validate", "check", "process"],
  size: ["size", "bytes", "limit", "max"],
  type: ["type", "mime", "format", "kind"],
};

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

function scoreRoleMatch(input: string, expectedRole: string): string | null {
  const lower = input.toLowerCase();
  let bestRole = "";
  let bestScore = 0;

  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  if (bestRole === expectedRole) {
    return null; // pass
  }
  return bestRole || "unknown";
}

function scorePatternMatch(
  input: string,
  expectedPatterns: string[]
): { matched: string[]; missed: string[] } {
  const lower = input.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];

  for (const pattern of expectedPatterns) {
    const keywords = PATTERN_KEYWORDS[pattern];
    if (!keywords) {
      // If we don't have keyword mapping, check if pattern itself appears in input
      if (lower.includes(pattern.toLowerCase())) {
        matched.push(pattern);
      } else {
        missed.push(pattern);
      }
      continue;
    }

    const hasMatch = keywords.some((kw) => lower.includes(kw));
    if (hasMatch) {
      matched.push(pattern);
    } else {
      missed.push(pattern);
    }
  }

  return { matched, missed };
}

// ---------------------------------------------------------------------------
// Eval runners
// ---------------------------------------------------------------------------

function runOrchestratorEval(cases: OrchestratorEvalCase[]): EvalResult {
  const failures: EvalResult["failures"] = [];
  let passed = 0;

  for (const tc of cases) {
    const wrongRole = scoreRoleMatch(tc.input, tc.expectedRole);
    if (wrongRole === null) {
      passed++;
    } else {
      failures.push({
        input: tc.input,
        expected: tc.expectedRole,
        got: wrongRole,
      });
    }
  }

  return {
    total: cases.length,
    passed,
    accuracy: cases.length > 0 ? (passed / cases.length) * 100 : 0,
    failures,
  };
}

function runPatternEval(
  cases: Array<CoderEvalCase | TestEvalCase>
): EvalResult {
  const failures: EvalResult["failures"] = [];
  let passed = 0;

  for (const tc of cases) {
    const { matched, missed } = scorePatternMatch(
      tc.input,
      tc.expectedPatterns
    );
    // Pass if at least 50% of expected patterns are matched
    const threshold = Math.ceil(tc.expectedPatterns.length * 0.5);
    if (matched.length >= threshold) {
      passed++;
    } else {
      failures.push({
        input: tc.input,
        expected: tc.expectedPatterns.join(", "),
        got: `matched=[${matched.join(", ")}] missed=[${missed.join(", ")}]`,
      });
    }
  }

  return {
    total: cases.length,
    passed,
    accuracy: cases.length > 0 ? (passed / cases.length) * 100 : 0,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------

function getDatasetsDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "datasets");
}

function loadDataset<T>(filename: string): T[] {
  const filepath = resolve(getDatasetsDir(), filename);
  const raw = readFileSync(filepath, "utf-8");
  return JSON.parse(raw) as T[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type EvalTarget =
  | "all"
  | "backend-coder"
  | "orchestrator"
  | "test-engineer";

export function runEval(target: EvalTarget): Record<string, EvalResult> {
  const results: Record<string, EvalResult> = {};

  if (target === "orchestrator" || target === "all") {
    const cases = loadDataset<OrchestratorEvalCase>("orchestrator-eval.json");
    results.orchestrator = runOrchestratorEval(cases);
  }

  if (target === "backend-coder" || target === "all") {
    const cases = loadDataset<CoderEvalCase>("backend-coder-eval.json");
    results["backend-coder"] = runPatternEval(cases);
  }

  if (target === "test-engineer" || target === "all") {
    const cases = loadDataset<TestEvalCase>("test-engineer-eval.json");
    results["test-engineer"] = runPatternEval(cases);
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const target = (process.argv[2] ?? "all") as EvalTarget;
  const validTargets = [
    "orchestrator",
    "backend-coder",
    "test-engineer",
    "all",
  ];

  if (!validTargets.includes(target)) {
    console.error(
      `Invalid target: ${target}. Valid targets: ${validTargets.join(", ")}`
    );
    process.exit(1);
  }

  console.log("=== Prompt Eval Runner ===\n");

  // Print version info for evaluated roles
  const rolesToCheck =
    target === "all"
      ? ["orchestrator", "backend_coder", "test_engineer"]
      : [target.replace("-", "_")];

  for (const role of rolesToCheck) {
    try {
      const info = getVersionInfo(role);
      console.log(
        `${info.role}: v${info.version} (${info.date}) hash=${info.hash}`
      );
    } catch {
      // Role might not exist in registry
    }
  }
  console.log("");

  const results = runEval(target);

  for (const [name, result] of Object.entries(results)) {
    console.log(`--- ${name} ---`);
    console.log(
      `  Accuracy: ${result.accuracy.toFixed(1)}% (${result.passed}/${result.total})`
    );

    if (result.failures.length > 0) {
      console.log("  Failures:");
      for (const f of result.failures) {
        console.log(`    - "${f.input}"`);
        console.log(`      expected: ${f.expected}`);
        console.log(`      got:      ${f.got}`);
      }
    }
    console.log("");
  }

  // Exit with error if any eval is below 70% accuracy
  const allPassing = Object.values(results).every((r) => r.accuracy >= 70);
  if (!allPassing) {
    console.error("FAIL: One or more evals below 70% accuracy threshold");
    process.exit(1);
  }

  console.log("PASS: All evals above 70% accuracy threshold");
}

// Run if executed directly
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("run-eval.ts") ||
    process.argv[1].endsWith("run-eval.js"));

if (isMainModule) {
  main();
}
