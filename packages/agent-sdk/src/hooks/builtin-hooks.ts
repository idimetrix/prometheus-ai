import { createLogger } from "@prometheus/logger";
import type { HookContext, HookHandler, HookResult } from "./hook-engine";

const logger = createLogger("agent-sdk:builtin-hooks");

const PROCEED: HookResult = { proceed: true };

const FILE_WRITE_TOOLS = new Set([
  "file_write",
  "file_edit",
  "file_create",
  "openhands_edit",
]);

// Top-level regex patterns for security scan
const PASSWORD_SECRET_RE =
  /(?:password|secret|token|api_key|apikey)\s*[:=]\s*["'][^"']+["']/i;
const PRIVATE_KEY_RE = /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/;
const GITHUB_TOKEN_RE = /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/;
const OPENAI_KEY_RE = /sk-[A-Za-z0-9]{20,}/;

const SENSITIVE_PATTERNS = [
  PASSWORD_SECRET_RE,
  PRIVATE_KEY_RE,
  GITHUB_TOKEN_RE,
  OPENAI_KEY_RE,
];

/**
 * AutoLint: After file writes, suggest running the linter on changed files.
 * Injects a context reminder to run lint/format checks.
 */
export const autoLintHook: HookHandler = (
  ctx: HookContext
): Promise<HookResult> => {
  if (!(ctx.toolName && FILE_WRITE_TOOLS.has(ctx.toolName))) {
    return Promise.resolve(PROCEED);
  }

  if (!ctx.toolResult?.success) {
    return Promise.resolve(PROCEED);
  }

  const changedFiles = ctx.filesChanged ?? [];
  if (changedFiles.length === 0) {
    return Promise.resolve(PROCEED);
  }

  logger.info(
    { toolName: ctx.toolName, filesChanged: changedFiles },
    "AutoLint: file write detected, suggesting lint"
  );

  return Promise.resolve({
    proceed: true,
    contextInjection: `[AutoLint] Files were modified (${changedFiles.join(", ")}). Consider running the linter to ensure code style compliance.`,
  });
};

/**
 * SecurityScan: After file writes, check for common security issues
 * such as hardcoded secrets, unsafe patterns, or exposed credentials.
 */
export const securityScanHook: HookHandler = (
  ctx: HookContext
): Promise<HookResult> => {
  if (!(ctx.toolName && FILE_WRITE_TOOLS.has(ctx.toolName))) {
    return Promise.resolve(PROCEED);
  }

  if (!ctx.toolResult?.success) {
    return Promise.resolve(PROCEED);
  }

  const output = ctx.toolResult.output ?? "";

  const warnings: string[] = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(output)) {
      warnings.push(
        `Potential secret detected matching pattern: ${pattern.source}`
      );
    }
  }

  if (warnings.length === 0) {
    return Promise.resolve(PROCEED);
  }

  logger.warn(
    { toolName: ctx.toolName, warningCount: warnings.length },
    "SecurityScan: potential secrets detected in file write"
  );

  return Promise.resolve({
    proceed: true,
    contextInjection: `[SecurityScan] Warning: ${warnings.join("; ")}. Please review the written content for hardcoded secrets or credentials.`,
    userMessage:
      "Security scan detected potential secrets in written files. Please review.",
  });
};

/**
 * BlueprintGuard: Before file writes, validate that the target file
 * aligns with the project architecture conventions.
 */
export const blueprintGuardHook: HookHandler = (
  ctx: HookContext
): Promise<HookResult> => {
  if (!(ctx.toolName && FILE_WRITE_TOOLS.has(ctx.toolName))) {
    return Promise.resolve(PROCEED);
  }

  const filePath = ctx.toolArgs?.path as string | undefined;
  if (!filePath) {
    return Promise.resolve(PROCEED);
  }

  const violations: string[] = [];

  if (filePath.includes("node_modules/")) {
    violations.push("Writing to node_modules is not allowed");
  }

  if (filePath.endsWith(".env") || filePath.includes(".env.local")) {
    violations.push(
      "Writing to .env files may expose secrets; use environment variables instead"
    );
  }

  if (filePath.includes("dist/") || filePath.includes("build/")) {
    violations.push(
      "Writing to build output directories is discouraged; modify source files instead"
    );
  }

  if (violations.length === 0) {
    logger.debug({ filePath }, "BlueprintGuard: file path passes checks");
    return Promise.resolve(PROCEED);
  }

  logger.warn(
    { filePath, violations },
    "BlueprintGuard: architecture violations detected"
  );

  const isBlocking = violations.some((v) => v.includes("node_modules"));

  return Promise.resolve({
    proceed: !isBlocking,
    blocked: isBlocking,
    blockReason: isBlocking
      ? `Blueprint violation: ${violations.join("; ")}`
      : undefined,
    contextInjection: `[BlueprintGuard] Warnings for ${filePath}: ${violations.join("; ")}`,
  });
};

/**
 * CostGuard: Before iterations, check that the agent hasn't exceeded
 * a reasonable iteration count, helping prevent runaway credit consumption.
 */
export const costGuardHook: HookHandler = (
  ctx: HookContext
): Promise<HookResult> => {
  const MAX_ITERATIONS = 200;
  const WARNING_THRESHOLD = 150;

  const iteration = ctx.iteration ?? 0;

  if (iteration >= MAX_ITERATIONS) {
    logger.warn(
      { iteration, agentRole: ctx.agentRole, taskId: ctx.taskId },
      "CostGuard: max iterations reached, blocking"
    );

    return Promise.resolve({
      proceed: false,
      blocked: true,
      blockReason: `Agent exceeded maximum iteration limit (${MAX_ITERATIONS}). Stopping to prevent excessive credit consumption.`,
      userMessage: `Agent reached the ${MAX_ITERATIONS}-iteration safety limit. Please review progress and restart if needed.`,
    });
  }

  if (iteration >= WARNING_THRESHOLD) {
    logger.info(
      { iteration, remaining: MAX_ITERATIONS - iteration },
      "CostGuard: approaching iteration limit"
    );

    return Promise.resolve({
      proceed: true,
      contextInjection: `[CostGuard] Warning: ${MAX_ITERATIONS - iteration} iterations remaining before safety cutoff. Prioritize completing the current task efficiently.`,
    });
  }

  return Promise.resolve(PROCEED);
};

/**
 * DependencyAudit: After file writes that introduce new imports,
 * flag newly added dependencies for review.
 */
export const dependencyAuditHook: HookHandler = (
  ctx: HookContext
): Promise<HookResult> => {
  if (!(ctx.toolName && FILE_WRITE_TOOLS.has(ctx.toolName))) {
    return Promise.resolve(PROCEED);
  }

  if (!ctx.toolResult?.success) {
    return Promise.resolve(PROCEED);
  }

  const output = ctx.toolResult.output ?? "";

  const importMatches: string[] = [];
  const importRegex = /import\s+.*\s+from\s+["']([^"'./][^"']*)["']/g;
  let match = importRegex.exec(output);
  while (match) {
    if (match[1]) {
      importMatches.push(match[1]);
    }
    match = importRegex.exec(output);
  }

  const newDeps = new Set<string>();
  for (const dep of importMatches) {
    const packageName = dep.startsWith("@")
      ? dep.split("/").slice(0, 2).join("/")
      : dep.split("/")[0];
    if (packageName) {
      newDeps.add(packageName);
    }
  }

  if (newDeps.size === 0) {
    return Promise.resolve(PROCEED);
  }

  const depList = [...newDeps].join(", ");

  logger.info(
    { dependencies: depList, toolName: ctx.toolName },
    "DependencyAudit: new imports detected"
  );

  return Promise.resolve({
    proceed: true,
    contextInjection: `[DependencyAudit] New external dependencies detected: ${depList}. Verify these packages are approved and check for known CVEs before merging.`,
  });
};
