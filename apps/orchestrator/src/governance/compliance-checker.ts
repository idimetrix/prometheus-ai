/**
 * Automated Compliance Checker
 *
 * Validates code and infrastructure against compliance frameworks
 * including SOC2, HIPAA, GDPR, PCI-DSS, and OWASP standards.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:compliance-checker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceFramework = "soc2" | "hipaa" | "gdpr" | "pci" | "owasp";

export type ControlStatus =
  | "compliant"
  | "non_compliant"
  | "partial"
  | "not_applicable";

export type ActionPriority = "critical" | "high" | "medium" | "low";

export interface ComplianceControl {
  evidence?: string;
  id: string;
  name: string;
  remediation?: string;
  status: ControlStatus;
}

export interface FrameworkResult {
  controls: ComplianceControl[];
  framework: string;
  overallScore: number;
}

export interface ComplianceActionItem {
  control: string;
  description: string;
  framework: string;
  priority: ActionPriority;
  suggestedFix: string;
}

export interface ComplianceCheckResult {
  actionItems: ComplianceActionItem[];
  results: FrameworkResult[];
}

interface FileInput {
  content: string;
  path: string;
}

interface ProjectContext {
  files: FileInput[];
  hasAuditLogs: boolean;
  hasAuthSystem: boolean;
  hasEncryption: boolean;
  hasInputValidation: boolean;
  hasRateLimiting: boolean;
  projectId: string;
}

// ---------------------------------------------------------------------------
// Constants & Patterns
// ---------------------------------------------------------------------------

const HARDCODED_SECRET_RE =
  /(?:password|secret|api_key|token|credential)\s*[:=]\s*['"][^'"]{8,}['"]/gi;
const SQL_INJECTION_RE =
  /(?:query|exec|execute)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"] *\+)/gi;
const XSS_RE = /dangerouslySetInnerHTML|innerHTML\s*=/gi;
const EVAL_RE = /\beval\s*\(|new\s+Function\s*\(/gi;
const HTTP_RE = /['"]http:\/\//gi;
const CONSOLE_LOG_RE = /console\.log\s*\(/gi;
const UNHANDLED_ERROR_RE = /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/gm;
const PII_FIELD_RE =
  /(?:email|phone|ssn|social_security|address|date_of_birth|dob)\b/gi;
const ENCRYPTION_RE =
  /(?:encrypt|decrypt|bcrypt|argon2|scrypt|crypto\.create|AES|RSA)\b/gi;
const AUDIT_LOG_RE = /(?:audit|log\.info|logger\.info|createLogger)\b/gi;
const AUTH_MIDDLEWARE_RE =
  /(?:auth|authenticate|authorize|isAuthenticated)\b/gi;
const RATE_LIMIT_RE = /(?:rateLimit|rateLimiter|throttle)\b/gi;
const INPUT_VALIDATION_RE = /(?:zod|yup|joi|validator|sanitize|validate)\b/gi;
const CORS_RE = /(?:cors|Access-Control-Allow-Origin)\b/gi;
const CSRF_RE = /(?:csrf|xsrf|csrfToken)\b/gi;
const HELMET_RE = /(?:helmet|security-headers|X-Content-Type|X-Frame)\b/gi;

const MAX_SCORE = 100;

// ---------------------------------------------------------------------------
// Framework control definitions
// ---------------------------------------------------------------------------

interface ControlDefinition {
  check: (ctx: ProjectContext) => {
    evidence?: string;
    remediation?: string;
    status: ControlStatus;
  };
  id: string;
  name: string;
}

function hasPattern(files: FileInput[], pattern: RegExp): boolean {
  return files.some((f) => pattern.test(f.content));
}

function countPattern(files: FileInput[], pattern: RegExp): number {
  let count = 0;
  for (const f of files) {
    const matches = f.content.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function filesWithPattern(files: FileInput[], pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(f.content)).map((f) => f.path);
}

// ---------------------------------------------------------------------------
// SOC2 Controls
// ---------------------------------------------------------------------------

const SOC2_CONTROLS: ControlDefinition[] = [
  {
    id: "SOC2-CC6.1",
    name: "Logical Access Controls",
    check: (ctx) => {
      if (ctx.hasAuthSystem && hasPattern(ctx.files, AUTH_MIDDLEWARE_RE)) {
        return {
          status: "compliant",
          evidence: "Authentication middleware detected across services",
        };
      }
      return {
        status: "non_compliant",
        remediation: "Implement authentication middleware on all API routes",
      };
    },
  },
  {
    id: "SOC2-CC6.6",
    name: "System Boundary Protection",
    check: (ctx) => {
      const hasCors = hasPattern(ctx.files, CORS_RE);
      const hasHelmet = hasPattern(ctx.files, HELMET_RE);
      if (hasCors && hasHelmet) {
        return {
          status: "compliant",
          evidence: "CORS and security headers configured",
        };
      }
      if (hasCors || hasHelmet) {
        return {
          status: "partial",
          remediation: "Ensure both CORS and security headers are configured",
        };
      }
      return {
        status: "non_compliant",
        remediation: "Add CORS configuration and security headers (helmet)",
      };
    },
  },
  {
    id: "SOC2-CC7.2",
    name: "Security Monitoring",
    check: (ctx) => {
      if (ctx.hasAuditLogs && hasPattern(ctx.files, AUDIT_LOG_RE)) {
        return {
          status: "compliant",
          evidence: "Audit logging detected across services",
        };
      }
      return {
        status: "partial",
        remediation:
          "Implement comprehensive audit logging for security events",
      };
    },
  },
  {
    id: "SOC2-CC8.1",
    name: "Change Management",
    check: (ctx) => {
      const hasCI = ctx.files.some(
        (f) =>
          f.path.includes(".github/workflows") || f.path.includes("Dockerfile")
      );
      if (hasCI) {
        return {
          status: "compliant",
          evidence: "CI/CD pipeline configuration detected",
        };
      }
      return {
        status: "non_compliant",
        remediation:
          "Set up CI/CD pipeline for automated testing and deployment",
      };
    },
  },
];

// ---------------------------------------------------------------------------
// HIPAA Controls
// ---------------------------------------------------------------------------

const HIPAA_CONTROLS: ControlDefinition[] = [
  {
    id: "HIPAA-164.312a",
    name: "Access Control",
    check: (ctx) => {
      if (ctx.hasAuthSystem) {
        return {
          status: "compliant",
          evidence: "Role-based access control system detected",
        };
      }
      return {
        status: "non_compliant",
        remediation: "Implement role-based access control for PHI access",
      };
    },
  },
  {
    id: "HIPAA-164.312b",
    name: "Audit Controls",
    check: (ctx) => {
      if (ctx.hasAuditLogs) {
        return {
          status: "compliant",
          evidence: "Audit logging system found",
        };
      }
      return {
        status: "non_compliant",
        remediation:
          "Implement audit logging for all PHI access and modifications",
      };
    },
  },
  {
    id: "HIPAA-164.312c",
    name: "Integrity Controls",
    check: (ctx) => {
      if (
        ctx.hasInputValidation &&
        hasPattern(ctx.files, INPUT_VALIDATION_RE)
      ) {
        return {
          status: "compliant",
          evidence: "Input validation detected using Zod/validation libraries",
        };
      }
      return {
        status: "partial",
        remediation:
          "Implement comprehensive input validation for all data entry points",
      };
    },
  },
  {
    id: "HIPAA-164.312e",
    name: "Transmission Security",
    check: (ctx) => {
      const hasHttp = hasPattern(ctx.files, HTTP_RE);
      if (ctx.hasEncryption && !hasHttp) {
        return {
          status: "compliant",
          evidence: "Encryption in transit detected, no plaintext HTTP found",
        };
      }
      if (hasHttp) {
        return {
          status: "non_compliant",
          remediation: "Replace all HTTP URLs with HTTPS",
        };
      }
      return {
        status: "partial",
        remediation: "Ensure all data transmission uses TLS encryption",
      };
    },
  },
];

// ---------------------------------------------------------------------------
// GDPR Controls
// ---------------------------------------------------------------------------

const GDPR_CONTROLS: ControlDefinition[] = [
  {
    id: "GDPR-Art5",
    name: "Data Processing Principles",
    check: (ctx) => {
      const piiFiles = filesWithPattern(ctx.files, PII_FIELD_RE);
      const hasValidation = hasPattern(ctx.files, INPUT_VALIDATION_RE);
      if (piiFiles.length > 0 && hasValidation) {
        return {
          status: "partial",
          evidence: `PII fields found in ${piiFiles.length} files with validation`,
          remediation: "Document data processing purposes for each PII field",
        };
      }
      if (piiFiles.length === 0) {
        return { status: "not_applicable" };
      }
      return {
        status: "non_compliant",
        remediation:
          "Add input validation and document data processing purposes",
      };
    },
  },
  {
    id: "GDPR-Art25",
    name: "Data Protection by Design",
    check: (ctx) => {
      if (ctx.hasEncryption && ctx.hasInputValidation) {
        return {
          status: "compliant",
          evidence: "Encryption and validation patterns detected",
        };
      }
      return {
        status: "partial",
        remediation:
          "Implement privacy-by-design patterns including data minimization",
      };
    },
  },
  {
    id: "GDPR-Art32",
    name: "Security of Processing",
    check: (ctx) => {
      const hasEncryption = hasPattern(ctx.files, ENCRYPTION_RE);
      const hasAuth = hasPattern(ctx.files, AUTH_MIDDLEWARE_RE);
      if (hasEncryption && hasAuth) {
        return {
          status: "compliant",
          evidence: "Encryption and authentication detected",
        };
      }
      return {
        status: "partial",
        remediation:
          "Implement encryption at rest and in transit with access controls",
      };
    },
  },
  {
    id: "GDPR-Art33",
    name: "Breach Notification",
    check: (ctx) => {
      if (ctx.hasAuditLogs) {
        return {
          status: "partial",
          evidence: "Audit logging exists for incident detection",
          remediation:
            "Implement automated breach detection and notification workflow",
        };
      }
      return {
        status: "non_compliant",
        remediation:
          "Implement breach detection and 72-hour notification process",
      };
    },
  },
];

// ---------------------------------------------------------------------------
// PCI-DSS Controls
// ---------------------------------------------------------------------------

const PCI_CONTROLS: ControlDefinition[] = [
  {
    id: "PCI-Req1",
    name: "Network Security Controls",
    check: (ctx) => {
      const hasCors = hasPattern(ctx.files, CORS_RE);
      const hasHelmet = hasPattern(ctx.files, HELMET_RE);
      if (hasCors && hasHelmet) {
        return {
          status: "compliant",
          evidence: "Network security controls found",
        };
      }
      return {
        status: "partial",
        remediation: "Implement firewall rules and network segmentation",
      };
    },
  },
  {
    id: "PCI-Req3",
    name: "Protect Stored Account Data",
    check: (ctx) => {
      const hasHardcoded = hasPattern(ctx.files, HARDCODED_SECRET_RE);
      if (hasHardcoded) {
        return {
          status: "non_compliant",
          remediation:
            "Remove hardcoded credentials and use secure vault/env management",
        };
      }
      if (ctx.hasEncryption) {
        return {
          status: "compliant",
          evidence: "Encryption detected, no hardcoded secrets",
        };
      }
      return {
        status: "partial",
        remediation: "Implement encryption for sensitive stored data",
      };
    },
  },
  {
    id: "PCI-Req6",
    name: "Secure Software Development",
    check: (ctx) => {
      const sqlInjections = countPattern(ctx.files, SQL_INJECTION_RE);
      const xssIssues = countPattern(ctx.files, XSS_RE);
      const evalUsage = countPattern(ctx.files, EVAL_RE);
      const totalIssues = sqlInjections + xssIssues + evalUsage;

      if (totalIssues === 0 && ctx.hasInputValidation) {
        return {
          status: "compliant",
          evidence:
            "No injection vulnerabilities detected, input validation present",
        };
      }
      if (totalIssues > 0) {
        return {
          status: "non_compliant",
          remediation: `Fix ${totalIssues} potential security vulnerabilities (SQL injection, XSS, eval)`,
        };
      }
      return {
        status: "partial",
        remediation: "Add input validation to prevent injection attacks",
      };
    },
  },
  {
    id: "PCI-Req10",
    name: "Logging and Monitoring",
    check: (ctx) => {
      if (ctx.hasAuditLogs) {
        return {
          status: "compliant",
          evidence: "Audit logging system detected",
        };
      }
      return {
        status: "non_compliant",
        remediation:
          "Implement comprehensive logging for all access to cardholder data",
      };
    },
  },
];

// ---------------------------------------------------------------------------
// OWASP Controls
// ---------------------------------------------------------------------------

const OWASP_CONTROLS: ControlDefinition[] = [
  {
    id: "OWASP-A01",
    name: "Broken Access Control",
    check: (ctx) => {
      if (ctx.hasAuthSystem && hasPattern(ctx.files, AUTH_MIDDLEWARE_RE)) {
        return {
          status: "compliant",
          evidence: "Access control middleware detected",
        };
      }
      return {
        status: "non_compliant",
        remediation: "Implement proper access control on all routes",
      };
    },
  },
  {
    id: "OWASP-A02",
    name: "Cryptographic Failures",
    check: (ctx) => {
      const hasHttp = hasPattern(ctx.files, HTTP_RE);
      const hasHardcoded = hasPattern(ctx.files, HARDCODED_SECRET_RE);
      if (!(hasHttp || hasHardcoded) && ctx.hasEncryption) {
        return {
          status: "compliant",
          evidence: "Proper encryption usage detected",
        };
      }
      const issues: string[] = [];
      if (hasHttp) {
        issues.push("plaintext HTTP detected");
      }
      if (hasHardcoded) {
        issues.push("hardcoded secrets found");
      }
      return {
        status: issues.length > 0 ? "non_compliant" : "partial",
        remediation:
          issues.length > 0
            ? `Fix: ${issues.join(", ")}`
            : "Implement encryption for sensitive data",
      };
    },
  },
  {
    id: "OWASP-A03",
    name: "Injection",
    check: (ctx) => {
      const sqlIssues = countPattern(ctx.files, SQL_INJECTION_RE);
      const evalIssues = countPattern(ctx.files, EVAL_RE);
      if (sqlIssues === 0 && evalIssues === 0 && ctx.hasInputValidation) {
        return { status: "compliant", evidence: "No injection patterns found" };
      }
      return {
        status: sqlIssues + evalIssues > 0 ? "non_compliant" : "partial",
        remediation:
          "Use parameterized queries and avoid eval/dynamic code execution",
      };
    },
  },
  {
    id: "OWASP-A05",
    name: "Security Misconfiguration",
    check: (ctx) => {
      const hasConsoleLog = countPattern(ctx.files, CONSOLE_LOG_RE);
      const hasUnhandled = countPattern(ctx.files, UNHANDLED_ERROR_RE);
      const issues: string[] = [];

      if (hasConsoleLog > 10) {
        issues.push(`${hasConsoleLog} console.log statements`);
      }
      if (hasUnhandled > 0) {
        issues.push(`${hasUnhandled} empty catch blocks`);
      }

      if (issues.length === 0) {
        return { status: "compliant", evidence: "No major misconfigurations" };
      }
      return {
        status: "partial",
        remediation: `Address: ${issues.join(", ")}`,
      };
    },
  },
  {
    id: "OWASP-A07",
    name: "Identification and Authentication Failures",
    check: (ctx) => {
      if (ctx.hasAuthSystem && ctx.hasRateLimiting) {
        return {
          status: "compliant",
          evidence: "Auth system with rate limiting detected",
        };
      }
      if (ctx.hasAuthSystem) {
        return {
          status: "partial",
          remediation: "Add rate limiting to authentication endpoints",
        };
      }
      return {
        status: "non_compliant",
        remediation: "Implement proper authentication with rate limiting",
      };
    },
  },
  {
    id: "OWASP-A08",
    name: "Software and Data Integrity Failures",
    check: (ctx) => {
      const hasCsrf = hasPattern(ctx.files, CSRF_RE);
      if (hasCsrf) {
        return { status: "compliant", evidence: "CSRF protection detected" };
      }
      return {
        status: "partial",
        remediation: "Implement CSRF protection for state-changing operations",
      };
    },
  },
  {
    id: "OWASP-A09",
    name: "Security Logging and Monitoring Failures",
    check: (ctx) => {
      if (ctx.hasAuditLogs) {
        return { status: "compliant", evidence: "Security logging detected" };
      }
      return {
        status: "non_compliant",
        remediation: "Implement security event logging and monitoring",
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Framework registry
// ---------------------------------------------------------------------------

const FRAMEWORK_CONTROLS: Record<ComplianceFramework, ControlDefinition[]> = {
  soc2: SOC2_CONTROLS,
  hipaa: HIPAA_CONTROLS,
  gdpr: GDPR_CONTROLS,
  pci: PCI_CONTROLS,
  owasp: OWASP_CONTROLS,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProjectContext(
  projectId: string,
  files: FileInput[]
): ProjectContext {
  return {
    projectId,
    files,
    hasAuthSystem: hasPattern(files, AUTH_MIDDLEWARE_RE),
    hasAuditLogs: hasPattern(files, AUDIT_LOG_RE),
    hasEncryption: hasPattern(files, ENCRYPTION_RE),
    hasInputValidation: hasPattern(files, INPUT_VALIDATION_RE),
    hasRateLimiting: hasPattern(files, RATE_LIMIT_RE),
  };
}

function computeFrameworkScore(controls: ComplianceControl[]): number {
  const applicable = controls.filter((c) => c.status !== "not_applicable");
  if (applicable.length === 0) {
    return MAX_SCORE;
  }

  let score = 0;
  for (const control of applicable) {
    if (control.status === "compliant") {
      score += 1;
    } else if (control.status === "partial") {
      score += 0.5;
    }
  }

  return Math.round((score / applicable.length) * MAX_SCORE);
}

function deriveActionPriority(
  status: ControlStatus,
  framework: ComplianceFramework
): ActionPriority {
  if (status === "non_compliant") {
    if (framework === "pci" || framework === "hipaa") {
      return "critical";
    }
    return "high";
  }
  if (status === "partial") {
    return "medium";
  }
  return "low";
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class ComplianceChecker {
  /**
   * Check project files against specified compliance frameworks.
   */
  check(
    projectId: string,
    frameworks: ComplianceFramework[],
    files: FileInput[] = []
  ): Promise<ComplianceCheckResult> {
    logger.info(
      { projectId, frameworks, fileCount: files.length },
      "Starting compliance check"
    );

    const ctx = buildProjectContext(projectId, files);
    const results: FrameworkResult[] = [];
    const actionItems: ComplianceActionItem[] = [];

    for (const framework of frameworks) {
      const controlDefs = FRAMEWORK_CONTROLS[framework];
      if (!controlDefs) {
        continue;
      }

      const controls: ComplianceControl[] = [];

      for (const def of controlDefs) {
        const result = def.check(ctx);
        controls.push({
          id: def.id,
          name: def.name,
          status: result.status,
          evidence: result.evidence,
          remediation: result.remediation,
        });

        // Generate action items for non-compliant or partial controls
        if (result.status === "non_compliant" || result.status === "partial") {
          actionItems.push({
            priority: deriveActionPriority(result.status, framework),
            framework,
            control: `${def.id}: ${def.name}`,
            description: `${def.name} is ${result.status === "non_compliant" ? "not compliant" : "partially compliant"}`,
            suggestedFix: result.remediation ?? "Review and remediate",
          });
        }
      }

      results.push({
        framework,
        controls,
        overallScore: computeFrameworkScore(controls),
      });
    }

    // Sort action items by priority
    const priorityOrder: Record<ActionPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    actionItems.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );

    logger.info(
      {
        projectId,
        frameworkCount: results.length,
        actionItemCount: actionItems.length,
      },
      "Compliance check complete"
    );

    return Promise.resolve({ results, actionItems });
  }
}
