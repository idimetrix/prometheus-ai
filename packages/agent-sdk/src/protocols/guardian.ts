import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:protocol:guardian");

const TECH_STACK_SECTION_RE = /## Tech Stack\n([\s\S]*?)(?=\n##|$)/;
const TSX_EXTENSION_RE = /\.tsx$/;
const PASCAL_CASE_RE = /^[A-Z]/;
const CONSOLE_LOG_RE = /console\.log\(/g;
const EVAL_RE = /eval\(/g;
const INNER_HTML_RE = /innerHTML\s*=/g;
// This regex is for *detecting* usage, not for rendering untrusted HTML
const DANGEROUSLY_SET_INNER_HTML_RE = /dangerouslySetInnerHTML/g;
const PROCESS_ENV_RE = /process\.env\.\w+/g;
const TEMPLATE_LITERAL_INTERPOLATION_RE = /`.*\$\{.*\}.*`/;
const BOLD_MARKDOWN_PREFIX_RE = /- \*\*.*?\*\*:\s*/;
const FILE_EXTENSION_RE = /\.[^.]+$/;

export interface GuardianViolation {
  file?: string;
  line?: number;
  message: string;
  severity: "error" | "warning" | "info";
  suggestion?: string;
  type: "tech_stack" | "naming" | "architecture" | "security" | "compliance";
}

export interface GuardianResult {
  checkedAt: string;
  passed: boolean;
  violations: GuardianViolation[];
}

export interface BlueprintRules {
  forbidden: string[];
  namingConventions: {
    files: string; // e.g., "kebab-case"
    components: string; // e.g., "PascalCase"
    functions: string; // e.g., "camelCase"
    constants: string; // e.g., "UPPER_SNAKE_CASE"
  };
  patterns: {
    stateManagement: string;
    dataFetching: string;
    authentication: string;
    errorHandling: string;
  };
  required: string[];
  techStack: string[];
}

export class BusinessLogicGuardian {
  private rules: BlueprintRules | null = null;

  setRules(rules: BlueprintRules): void {
    this.rules = rules;
    logger.info("Guardian rules updated");
  }

  extractRulesFromBlueprint(blueprintContent: string): BlueprintRules {
    // Parse blueprint markdown to extract rules
    const rules: BlueprintRules = {
      techStack: [],
      namingConventions: {
        files: "kebab-case",
        components: "PascalCase",
        functions: "camelCase",
        constants: "UPPER_SNAKE_CASE",
      },
      patterns: {
        stateManagement: "",
        dataFetching: "",
        authentication: "",
        errorHandling: "",
      },
      forbidden: [],
      required: [],
    };

    // Extract tech stack from blueprint
    const techStackMatch = blueprintContent.match(TECH_STACK_SECTION_RE);
    if (techStackMatch) {
      const lines = techStackMatch[1]
        ?.split("\n")
        .filter((l) => l.startsWith("- **"));
      rules.techStack = (lines ?? []).map((l) =>
        l.replace(BOLD_MARKDOWN_PREFIX_RE, "").trim()
      );
    }

    this.rules = rules;
    return rules;
  }

  checkFileChange(filePath: string, content: string): GuardianResult {
    const violations: GuardianViolation[] = [];

    if (!this.rules) {
      return {
        passed: true,
        violations: [],
        checkedAt: new Date().toISOString(),
      };
    }

    // Check naming conventions
    this.checkNaming(filePath, violations);

    // Check for forbidden patterns
    this.checkForbiddenPatterns(content, filePath, violations);

    // Check security patterns
    this.checkSecurityPatterns(content, filePath, violations);

    // Check GDPR/compliance patterns
    this.checkCompliancePatterns(content, filePath, violations);

    const hasErrors = violations.some((v) => v.severity === "error");

    return {
      passed: !hasErrors,
      violations,
      checkedAt: new Date().toISOString(),
    };
  }

  private checkNaming(filePath: string, violations: GuardianViolation[]): void {
    const fileName = filePath.split("/").pop() ?? "";
    const baseName = fileName.replace(FILE_EXTENSION_RE, "");

    // React components should be PascalCase
    if (
      filePath.includes("/components/") &&
      TSX_EXTENSION_RE.test(fileName) &&
      !(PASCAL_CASE_RE.test(baseName) || baseName.includes("."))
    ) {
      violations.push({
        type: "naming",
        severity: "warning",
        message: `Component file "${fileName}" should use PascalCase`,
        file: filePath,
        suggestion: `Rename to ${baseName.charAt(0).toUpperCase() + baseName.slice(1)}.tsx`,
      });
    }
  }

  private checkForbiddenPatterns(
    content: string,
    filePath: string,
    violations: GuardianViolation[]
  ): void {
    const forbidden = [
      {
        pattern: CONSOLE_LOG_RE,
        message: "Use structured logger instead of console.log",
        severity: "warning" as const,
      },
      {
        pattern: EVAL_RE,
        message: "eval() is forbidden for security reasons",
        severity: "error" as const,
      },
      {
        pattern: INNER_HTML_RE,
        message: "Direct innerHTML assignment is an XSS risk",
        severity: "error" as const,
      },
      {
        pattern: DANGEROUSLY_SET_INNER_HTML_RE,
        message: "dangerouslySetInnerHTML requires security review",
        severity: "warning" as const,
      },
      {
        pattern: PROCESS_ENV_RE,
        message: "Direct process.env access; use typed config instead",
        severity: "info" as const,
      },
    ];

    for (const rule of forbidden) {
      const matches = content.match(rule.pattern);
      if (matches) {
        violations.push({
          type: "security",
          severity: rule.severity,
          message: rule.message,
          file: filePath,
        });
      }
    }
  }

  private checkSecurityPatterns(
    content: string,
    filePath: string,
    violations: GuardianViolation[]
  ): void {
    // SQL injection check
    if (
      (TEMPLATE_LITERAL_INTERPOLATION_RE.test(content) &&
        content.includes("query")) ||
      content.includes("sql")
    ) {
      violations.push({
        type: "security",
        severity: "error",
        message: "Potential SQL injection: use parameterized queries",
        file: filePath,
        suggestion: "Use Drizzle ORM query builder or prepared statements",
      });
    }

    // Secret in code check
    const secretPatterns = [
      /(?:password|secret|api_key|apikey|token)\s*[:=]\s*["'][^"']{8,}/gi,
      /sk[-_](?:live|test)[-_]\w{20,}/g,
      /ghp_\w{36}/g,
    ];

    for (const pattern of secretPatterns) {
      if (pattern.test(content)) {
        violations.push({
          type: "security",
          severity: "error",
          message: "Potential hardcoded secret detected",
          file: filePath,
          suggestion: "Use environment variables for secrets",
        });
      }
    }
  }

  private checkCompliancePatterns(
    content: string,
    filePath: string,
    violations: GuardianViolation[]
  ): void {
    // Check for PII logging
    if (content.includes("logger") || content.includes("console")) {
      const piiFields = ["email", "password", "ssn", "credit_card", "phone"];
      for (const field of piiFields) {
        const pattern = new RegExp(
          `(?:log|info|debug|warn|error).*${field}`,
          "i"
        );
        if (pattern.test(content)) {
          violations.push({
            type: "compliance",
            severity: "warning",
            message: `Potential PII (${field}) in log output`,
            file: filePath,
            suggestion: "Redact PII before logging",
          });
        }
      }
    }
  }
}
