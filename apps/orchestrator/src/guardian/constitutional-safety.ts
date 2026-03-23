/**
 * Constitutional safety framework that enforces a set of rules at the
 * execution engine level. Every tool call passes through this layer before
 * execution so dangerous, out-of-scope, or convention-violating operations
 * can be blocked, warned about, or annotated.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:constitutional-safety");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConstitutionalRule {
  check: (context: SafetyContext) => SafetyViolation | null;
  description: string;
  enabled: boolean;
  id: string;
  name: string;
  severity: "block" | "warn" | "info";
}

export interface SafetyContext {
  agentRole: string;
  fileContent?: string;
  filePath?: string;
  previousActions: Array<{ tool: string; file?: string }>;
  /** Allowed file paths for the current project scope. */
  projectScope: string[];
  toolArgs: Record<string, unknown>;
  toolName: string;
}

export interface SafetyViolation {
  message: string;
  ruleId: string;
  ruleName: string;
  severity: "block" | "warn" | "info";
  suggestedAction?: string;
}

export interface SafetyReport {
  blocked: boolean;
  checkedRules: number;
  /** Compliance score from 0 (all rules violated) to 1 (fully compliant). */
  complianceScore: number;
  violations: SafetyViolation[];
}

// ---------------------------------------------------------------------------
// Secret detection patterns
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "AWS Access Key",
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: "AWS Secret Key",
    pattern:
      /(?:aws_secret_access_key|AWS_SECRET)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/,
  },
  {
    name: "Generic API Key",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}/i,
  },
  {
    name: "Generic Secret",
    pattern:
      /(?:secret|password|passwd|token)\s*[:=]\s*['"]?[A-Za-z0-9_\-!@#$%^&*]{8,}/i,
  },
  {
    name: "GitHub Token",
    pattern: /gh[ps]_[A-Za-z0-9_]{36,}/,
  },
  {
    name: "Private Key Block",
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
  },
  {
    name: "Slack Token",
    pattern: /xox[bporas]-[0-9]{10,}-[A-Za-z0-9-]+/,
  },
  {
    name: "Bearer Token",
    pattern: /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/,
  },
];

// ---------------------------------------------------------------------------
// Naming convention patterns
// ---------------------------------------------------------------------------

const NAMING_CONVENTIONS: Array<{
  description: string;
  pattern: RegExp;
  type: string;
}> = [
  {
    type: "component",
    pattern: /\/components\/[A-Z][a-zA-Z]*\.tsx$/,
    description: "React components should be PascalCase .tsx files",
  },
  {
    type: "hook",
    pattern: /\/hooks\/use[A-Z][a-zA-Z]*\.ts$/,
    description: "Hooks should be camelCase starting with 'use'",
  },
  {
    type: "util",
    pattern: /\/utils\/[a-z][a-z-]*\.ts$/,
    description: "Utility files should be kebab-case .ts files",
  },
];

// ---------------------------------------------------------------------------
// Destructive SQL patterns
// ---------------------------------------------------------------------------

const DESTRUCTIVE_SQL_PATTERNS = [
  /DROP\s+TABLE/i,
  /DROP\s+DATABASE/i,
  /TRUNCATE\s+/i,
  /DELETE\s+FROM\s+\w+\s*(?:;|$)/i, // DELETE without WHERE
];

// ---------------------------------------------------------------------------
// Security bypass patterns
// ---------------------------------------------------------------------------

const SECURITY_BYPASS_PATTERNS = [
  /(?:disable|bypass|skip).*(?:auth|authentication)/i,
  /cors\s*:\s*(?:true|\*|['"]?\*['"]?)/i,
  /(?:disable|bypass|skip).*rls/i,
  /\.rls\s*\(\s*false\s*\)/i,
  /security\s*[:=]\s*false/i,
];

// ---------------------------------------------------------------------------
// Git branch patterns
// ---------------------------------------------------------------------------

const MAIN_BRANCH_PATTERN = /\b(main|master)\b/;

// ---------------------------------------------------------------------------
// CI/CD file patterns
// ---------------------------------------------------------------------------

const CI_FILE_PATTERNS = [
  /\.github\/workflows\//,
  /\.gitlab-ci\.yml$/,
  /Jenkinsfile$/,
  /\.circleci\//,
  /bitbucket-pipelines\.yml$/,
  /\.travis\.yml$/,
  /Dockerfile$/,
  /docker-compose\.ya?ml$/,
  /\.dockerignore$/,
  /infra\//,
];

// ---------------------------------------------------------------------------
// Test file pattern
// ---------------------------------------------------------------------------

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

// ---------------------------------------------------------------------------
// ConstitutionalSafety
// ---------------------------------------------------------------------------

export class ConstitutionalSafety {
  private readonly rules: ConstitutionalRule[] = [];

  constructor() {
    this.registerDefaultRules();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Check a tool call against all enabled rules and return a safety report.
   */
  check(context: SafetyContext): SafetyReport {
    const violations: SafetyViolation[] = [];
    let checkedRules = 0;

    for (const rule of this.rules) {
      if (!rule.enabled) {
        continue;
      }
      checkedRules += 1;

      const violation = rule.check(context);
      if (violation) {
        violations.push(violation);
      }
    }

    const blocked = violations.some((v) => v.severity === "block");
    const complianceScore =
      checkedRules > 0 ? (checkedRules - violations.length) / checkedRules : 1;

    if (violations.length > 0) {
      logger.warn(
        {
          toolName: context.toolName,
          agentRole: context.agentRole,
          violations: violations.length,
          blocked,
        },
        "Safety violations detected"
      );
    }

    return {
      violations,
      blocked,
      complianceScore: Math.max(0, complianceScore),
      checkedRules,
    };
  }

  /**
   * Register a custom constitutional rule.
   */
  registerRule(rule: ConstitutionalRule): void {
    this.rules.push(rule);
    logger.info(
      { ruleId: rule.id, severity: rule.severity },
      "Registered constitutional rule"
    );
  }

  /**
   * Enable or disable a rule by id.
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
      logger.info({ ruleId, enabled }, "Updated rule status");
    }
  }

  /**
   * Return all registered rules.
   */
  getRules(): ConstitutionalRule[] {
    return [...this.rules];
  }

  // -----------------------------------------------------------------------
  // Default rules
  // -----------------------------------------------------------------------

  private registerDefaultRules(): void {
    // 1. No file deletion without explicit approval
    this.rules.push({
      id: "no-file-delete",
      name: "No File Deletion",
      description:
        "Block file deletion operations unless an explicit approval flag is set",
      severity: "block",
      enabled: true,
      check: (ctx) => {
        const isDelete =
          ctx.toolName === "deleteFile" ||
          ctx.toolName === "removeFile" ||
          ctx.toolName === "rm";
        const hasApproval = ctx.toolArgs.approved === true;

        if (isDelete && !hasApproval) {
          return {
            ruleId: "no-file-delete",
            ruleName: "No File Deletion",
            severity: "block",
            message: `File deletion blocked: ${ctx.filePath ?? "unknown file"}. Set approved=true to proceed.`,
            suggestedAction:
              "Add approved: true to tool args or use a safer alternative",
          };
        }
        return null;
      },
    });

    // 2. No scope violation
    this.rules.push({
      id: "no-scope-violation",
      name: "No Scope Violation",
      description: "Block modifications to files outside the project scope",
      severity: "block",
      enabled: true,
      check: (ctx) => {
        if (!ctx.filePath || ctx.projectScope.length === 0) {
          return null;
        }

        const inScope = ctx.projectScope.some((scope) =>
          ctx.filePath?.startsWith(scope)
        );

        if (!inScope) {
          return {
            ruleId: "no-scope-violation",
            ruleName: "No Scope Violation",
            severity: "block",
            message: `File ${ctx.filePath} is outside the allowed project scope`,
            suggestedAction: "Only modify files within the project directory",
          };
        }
        return null;
      },
    });

    // 3. No secrets in code
    this.rules.push({
      id: "no-secrets",
      name: "No Secrets in Code",
      description:
        "Block commits containing API keys, passwords, tokens, or private keys",
      severity: "block",
      enabled: true,
      check: (ctx) => {
        const content = ctx.fileContent ?? "";
        if (!content) {
          return null;
        }

        for (const { name, pattern } of SECRET_PATTERNS) {
          if (pattern.test(content)) {
            return {
              ruleId: "no-secrets",
              ruleName: "No Secrets in Code",
              severity: "block",
              message: `Potential ${name} detected in ${ctx.filePath ?? "file content"}`,
              suggestedAction:
                "Move secrets to environment variables or a secrets manager",
            };
          }
        }
        return null;
      },
    });

    // 4. No vulnerable dependencies
    this.rules.push({
      id: "no-vulnerable-deps",
      name: "No Unvetted Dependencies",
      description:
        "Warn when adding dependencies that are not in the project allowlist",
      severity: "warn",
      enabled: true,
      check: (ctx) => {
        const isInstall =
          ctx.toolName === "npmInstall" ||
          ctx.toolName === "addDependency" ||
          ctx.toolName === "exec";
        const command = String(ctx.toolArgs.command ?? "");
        const isPackageInstall =
          isInstall &&
          (command.includes("npm install") ||
            command.includes("pnpm add") ||
            command.includes("yarn add"));

        if (isPackageInstall) {
          return {
            ruleId: "no-vulnerable-deps",
            ruleName: "No Unvetted Dependencies",
            severity: "warn",
            message:
              "Adding a new dependency — ensure it has been vetted for security vulnerabilities",
            suggestedAction:
              "Run a vulnerability scan on the new dependency before proceeding",
          };
        }
        return null;
      },
    });

    // 5. No security bypass
    this.rules.push({
      id: "no-security-bypass",
      name: "No Security Bypass",
      description:
        "Block disabling authentication, CORS protections, or Row Level Security",
      severity: "block",
      enabled: true,
      check: (ctx) => {
        const content = ctx.fileContent ?? "";
        if (!content) {
          return null;
        }

        for (const pattern of SECURITY_BYPASS_PATTERNS) {
          if (pattern.test(content)) {
            return {
              ruleId: "no-security-bypass",
              ruleName: "No Security Bypass",
              severity: "block",
              message: `Security bypass detected in ${ctx.filePath ?? "file content"}: disabling auth, CORS, or RLS`,
              suggestedAction:
                "Keep security mechanisms enabled; configure them properly instead of disabling",
            };
          }
        }
        return null;
      },
    });

    // 6. No destructive database operations
    this.rules.push({
      id: "no-destructive-db",
      name: "No Destructive DB Operations",
      description:
        "Block DROP TABLE, TRUNCATE, and DELETE without WHERE clause",
      severity: "block",
      enabled: true,
      check: (ctx) => {
        const content = ctx.fileContent ?? "";
        const argsStr = JSON.stringify(ctx.toolArgs);
        const combined = `${content}\n${argsStr}`;

        for (const pattern of DESTRUCTIVE_SQL_PATTERNS) {
          if (pattern.test(combined)) {
            return {
              ruleId: "no-destructive-db",
              ruleName: "No Destructive DB Operations",
              severity: "block",
              message:
                "Destructive database operation detected (DROP, TRUNCATE, or DELETE without WHERE)",
              suggestedAction:
                "Use targeted DELETE with WHERE clause, or use migrations for schema changes",
            };
          }
        }
        return null;
      },
    });

    // 7. No direct push to main/master
    this.rules.push({
      id: "no-direct-push",
      name: "No Direct Push to Main",
      description: "Block git push operations targeting main or master",
      severity: "block",
      enabled: true,
      check: (ctx) => {
        const isGitPush = ctx.toolName === "exec" || ctx.toolName === "gitPush";
        const command = String(ctx.toolArgs.command ?? "");
        const branch = String(ctx.toolArgs.branch ?? "");

        const pushToMain =
          isGitPush &&
          (command.includes("git push") || ctx.toolName === "gitPush") &&
          (MAIN_BRANCH_PATTERN.test(command) ||
            MAIN_BRANCH_PATTERN.test(branch));

        if (pushToMain) {
          return {
            ruleId: "no-direct-push",
            ruleName: "No Direct Push to Main",
            severity: "block",
            message:
              "Direct push to main/master is blocked — use a feature branch and pull request",
            suggestedAction:
              "Create a feature branch and open a pull request instead",
          };
        }
        return null;
      },
    });

    // 8. No CI/CD modification without warning
    this.rules.push({
      id: "no-ci-modification",
      name: "CI/CD Modification Warning",
      description: "Warn when modifying CI/CD configuration files",
      severity: "warn",
      enabled: true,
      check: (ctx) => {
        if (!ctx.filePath) {
          return null;
        }

        const isCiFile = CI_FILE_PATTERNS.some((p) =>
          p.test(ctx.filePath ?? "")
        );

        if (isCiFile) {
          return {
            ruleId: "no-ci-modification",
            ruleName: "CI/CD Modification Warning",
            severity: "warn",
            message: `CI/CD file modification detected: ${ctx.filePath}`,
            suggestedAction:
              "Ensure CI/CD changes are reviewed by a platform engineer",
          };
        }
        return null;
      },
    });

    // 9. Maintain test coverage
    this.rules.push({
      id: "maintain-test-coverage",
      name: "Maintain Test Coverage",
      description: "Warn if deleting or significantly reducing test files",
      severity: "warn",
      enabled: true,
      check: (ctx) => {
        if (!ctx.filePath) {
          return null;
        }

        const isTestFile =
          TEST_FILE_PATTERN.test(ctx.filePath) ||
          ctx.filePath.includes("__tests__");

        const isDelete =
          ctx.toolName === "deleteFile" ||
          ctx.toolName === "removeFile" ||
          ctx.toolName === "rm";

        if (isTestFile && isDelete) {
          return {
            ruleId: "maintain-test-coverage",
            ruleName: "Maintain Test Coverage",
            severity: "warn",
            message: `Deleting test file: ${ctx.filePath}`,
            suggestedAction:
              "Ensure corresponding replacement tests exist before deleting",
          };
        }
        return null;
      },
    });

    // 10. Follow naming conventions
    this.rules.push({
      id: "follow-conventions",
      name: "Follow Naming Conventions",
      description:
        "Info when a file does not match the project naming conventions",
      severity: "info",
      enabled: true,
      check: (ctx) => {
        if (!ctx.filePath) {
          return null;
        }

        const isCreate =
          ctx.toolName === "createFile" ||
          ctx.toolName === "writeFile" ||
          ctx.toolName === "write";

        if (!isCreate) {
          return null;
        }

        for (const convention of NAMING_CONVENTIONS) {
          // Check if the file is in a matching directory but doesn't follow the convention
          const dirPattern = convention.pattern.source.split("/")[1];
          if (
            dirPattern &&
            ctx.filePath.includes(`/${dirPattern}/`) &&
            !convention.pattern.test(ctx.filePath)
          ) {
            return {
              ruleId: "follow-conventions",
              ruleName: "Follow Naming Conventions",
              severity: "info",
              message: `File ${ctx.filePath} may not follow conventions: ${convention.description}`,
              suggestedAction: convention.description,
            };
          }
        }
        return null;
      },
    });

    logger.info(
      { ruleCount: this.rules.length },
      "Registered default constitutional rules"
    );
  }
}
