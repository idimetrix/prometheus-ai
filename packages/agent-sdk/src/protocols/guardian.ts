import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:protocol:guardian");

export interface GuardianViolation {
  type: "tech_stack" | "naming" | "architecture" | "security" | "compliance";
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface GuardianResult {
  passed: boolean;
  violations: GuardianViolation[];
  checkedAt: string;
}

export interface BlueprintRules {
  techStack: string[];
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
  forbidden: string[];
  required: string[];
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
    const techStackMatch = blueprintContent.match(/## Tech Stack\n([\s\S]*?)(?=\n##|$)/);
    if (techStackMatch) {
      const lines = techStackMatch[1]!.split("\n").filter((l) => l.startsWith("- **"));
      rules.techStack = lines.map((l) => l.replace(/- \*\*.*?\*\*:\s*/, "").trim());
    }

    this.rules = rules;
    return rules;
  }

  checkFileChange(filePath: string, content: string): GuardianResult {
    const violations: GuardianViolation[] = [];

    if (!this.rules) {
      return { passed: true, violations: [], checkedAt: new Date().toISOString() };
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
    const baseName = fileName.replace(/\.[^.]+$/, "");

    // React components should be PascalCase
    if (filePath.includes("/components/") && /\.tsx$/.test(fileName)) {
      if (!/^[A-Z]/.test(baseName) && !baseName.includes(".")) {
        violations.push({
          type: "naming",
          severity: "warning",
          message: `Component file "${fileName}" should use PascalCase`,
          file: filePath,
          suggestion: `Rename to ${baseName.charAt(0).toUpperCase() + baseName.slice(1)}.tsx`,
        });
      }
    }
  }

  private checkForbiddenPatterns(content: string, filePath: string, violations: GuardianViolation[]): void {
    const forbidden = [
      { pattern: /console\.log\(/g, message: "Use structured logger instead of console.log", severity: "warning" as const },
      { pattern: /eval\(/g, message: "eval() is forbidden for security reasons", severity: "error" as const },
      { pattern: /innerHTML\s*=/g, message: "Direct innerHTML assignment is an XSS risk", severity: "error" as const },
      { pattern: /dangerouslySetInnerHTML/g, message: "dangerouslySetInnerHTML requires security review", severity: "warning" as const },
      { pattern: /process\.env\.\w+/g, message: "Direct process.env access; use typed config instead", severity: "info" as const },
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

  private checkSecurityPatterns(content: string, filePath: string, violations: GuardianViolation[]): void {
    // SQL injection check
    if (/`.*\$\{.*\}.*`/.test(content) && content.includes("query") || content.includes("sql")) {
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

  private checkCompliancePatterns(content: string, filePath: string, violations: GuardianViolation[]): void {
    // Check for PII logging
    if (content.includes("logger") || content.includes("console")) {
      const piiFields = ["email", "password", "ssn", "credit_card", "phone"];
      for (const field of piiFields) {
        const pattern = new RegExp(`(?:log|info|debug|warn|error).*${field}`, "i");
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
