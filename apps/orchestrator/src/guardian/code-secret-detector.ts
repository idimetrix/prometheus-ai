import { createLogger } from "@prometheus/logger";
import type { SemgrepResult } from "./semgrep-scanner";

const logger = createLogger("orchestrator:code-secret-detector");

// ─── Types ────────────────────────────────────────────────────────────────────

export type SecretSeverity = "low" | "medium" | "high" | "critical";

export interface SecretFinding {
  column: number;
  file?: string;
  line: number;
  match: string;
  severity: SecretSeverity;
  suggestion: string;
  type: string;
}

export interface SecretScanResult {
  blocked: boolean;
  findings: SecretFinding[];
  summary: {
    critical: number;
    high: number;
    low: number;
    medium: number;
  };
}

export interface SecretNotification {
  file: string;
  findings: SecretFinding[];
  message: string;
}

// ─── Detection Rules ──────────────────────────────────────────────────────────

interface DetectionRule {
  name: string;
  pattern: RegExp;
  severity: SecretSeverity;
  suggestion: string;
}

const DETECTION_RULES: DetectionRule[] = [
  // AWS
  {
    name: "aws_access_key",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    severity: "critical",
    suggestion: "Use process.env.AWS_ACCESS_KEY_ID instead",
  },
  {
    name: "aws_secret_key",
    pattern:
      /(?:aws_secret_access_key|AWS_SECRET)['":\s=]+([A-Za-z0-9/+=]{40})/g,
    severity: "critical",
    suggestion: "Use process.env.AWS_SECRET_ACCESS_KEY instead",
  },
  // Google Cloud
  {
    name: "gcp_service_account",
    pattern: /"type"\s*:\s*"service_account"/g,
    severity: "critical",
    suggestion:
      "Store GCP service account keys in environment variables or secret manager",
  },
  {
    name: "gcp_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "high",
    suggestion: "Use process.env.GOOGLE_API_KEY instead",
  },
  // Azure
  {
    name: "azure_connection_string",
    pattern:
      /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/g,
    severity: "critical",
    suggestion: "Use process.env for Azure connection strings",
  },
  // Generic API keys
  {
    name: "generic_api_key",
    pattern:
      /(?:api[_-]?key|apikey|api_secret)['":\s=]+['"]([a-zA-Z0-9_-]{20,})['"]/gi,
    severity: "high",
    suggestion: "Store API keys in environment variables",
  },
  // Tokens
  {
    name: "bearer_token",
    pattern: /(?:bearer|token|auth)['":\s=]+['"]([a-zA-Z0-9_\-.]{20,})['"]/gi,
    severity: "high",
    suggestion: "Use process.env for token storage",
  },
  // Private keys
  {
    name: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    severity: "critical",
    suggestion:
      "Load private keys from files or environment variables, never hardcode",
  },
  // Passwords
  {
    name: "password_assignment",
    pattern: /(?:password|passwd|pwd)['":\s=]+['"]([^'"]{8,})['"]/gi,
    severity: "high",
    suggestion: "Use process.env for password storage",
  },
  // Database URLs
  {
    name: "database_url",
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s'"]+/g,
    severity: "critical",
    suggestion: "Use process.env.DATABASE_URL instead",
  },
  // GitHub tokens
  {
    name: "github_token",
    pattern:
      /\b(ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{22,})\b/g,
    severity: "critical",
    suggestion: "Use process.env.GITHUB_TOKEN instead",
  },
  // Stripe keys
  {
    name: "stripe_key",
    pattern: /\b(sk_live_[a-zA-Z0-9]{20,}|pk_live_[a-zA-Z0-9]{20,})\b/g,
    severity: "critical",
    suggestion: "Use process.env.STRIPE_SECRET_KEY instead",
  },
  // Slack tokens
  {
    name: "slack_token",
    pattern: /\b(xoxb-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24})\b/g,
    severity: "high",
    suggestion: "Use process.env.SLACK_TOKEN instead",
  },
  // JWT secrets
  {
    name: "jwt_secret",
    pattern: /(?:jwt[_-]?secret|JWT_SECRET)['":\s=]+['"]([^'"]{16,})['"]/gi,
    severity: "high",
    suggestion: "Use process.env.JWT_SECRET instead",
  },
  // SendGrid API key
  {
    name: "sendgrid_key",
    pattern: /\bSG\.[a-zA-Z0-9_-]{22,}\.[a-zA-Z0-9_-]{22,}\b/g,
    severity: "critical",
    suggestion: "Use process.env.SENDGRID_API_KEY instead",
  },
  // Twilio
  {
    name: "twilio_key",
    pattern: /\bSK[a-f0-9]{32}\b/g,
    severity: "high",
    suggestion: "Use process.env for Twilio credentials",
  },
  // NPM tokens
  {
    name: "npm_token",
    pattern: /\bnpm_[a-zA-Z0-9]{36}\b/g,
    severity: "critical",
    suggestion: "Use .npmrc with env variable substitution",
  },
  // Heroku API key
  {
    name: "heroku_api_key",
    pattern:
      /(?:heroku[_-]?api[_-]?key|HEROKU_API_KEY)['":\s=]+['"]([a-f0-9-]{36})['"]/gi,
    severity: "high",
    suggestion: "Use process.env.HEROKU_API_KEY instead",
  },
];

// ─── Entropy Analysis ─────────────────────────────────────────────────────────

function calculateShannonEntropy(str: string): number {
  const len = str.length;
  if (len === 0) {
    return 0;
  }

  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const HIGH_ENTROPY_THRESHOLD = 4.5;
const MIN_ENTROPY_LENGTH = 20;

// ─── Semgrep Integration Rules ───────────────────────────────────────────────

/**
 * Semgrep rule IDs that indicate secret/credential findings.
 * These are matched against the Semgrep scan results.
 */
const SEMGREP_SECRET_RULES = new Set([
  "generic.secrets.security.detected-generic-secret",
  "generic.secrets.security.detected-aws-account-key",
  "generic.secrets.security.detected-private-key",
  "javascript.lang.security.hardcoded-credential",
  "typescript.lang.security.hardcoded-credential",
  "generic.secrets.security.detected-api-key",
]);

// ─── Code Secret Detector ─────────────────────────────────────────────────────

export class CodeSecretDetector {
  /**
   * Scan code for potential secrets using regex patterns and entropy analysis.
   * Optionally integrates Semgrep findings to enrich the results.
   */
  scan(code: string, fileName?: string): SecretFinding[] {
    const findings: SecretFinding[] = [];

    // Pattern-based detection
    for (const rule of DETECTION_RULES) {
      // Reset regex state for global patterns
      rule.pattern.lastIndex = 0;

      let match: RegExpExecArray | null = null;
      while (true) {
        match = rule.pattern.exec(code);
        if (!match) {
          break;
        }

        const matchStart = match.index;
        const lineInfo = this.getLineInfo(code, matchStart);
        const matchText =
          match[0].length > 40
            ? `${match[0].slice(0, 20)}...${match[0].slice(-10)}`
            : match[0];

        findings.push({
          type: rule.name,
          severity: rule.severity,
          line: lineInfo.line,
          column: lineInfo.column,
          match: matchText,
          suggestion: rule.suggestion,
          file: fileName,
        });
      }
    }

    // Entropy-based detection for string literals
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const stringMatches = line.matchAll(
        /['"]([a-zA-Z0-9+/=_-]{20,})['"]|`([a-zA-Z0-9+/=_-]{20,})`/g
      );

      for (const sm of stringMatches) {
        const value = sm[1] ?? sm[2] ?? "";
        if (value.length < MIN_ENTROPY_LENGTH) {
          continue;
        }

        const entropy = calculateShannonEntropy(value);
        if (entropy >= HIGH_ENTROPY_THRESHOLD) {
          // Check it wasn't already caught by a pattern rule
          const alreadyFound = findings.some(
            (f) => f.line === i + 1 && f.match.includes(value.slice(0, 10))
          );
          if (!alreadyFound) {
            findings.push({
              type: "high_entropy_string",
              severity: "medium",
              line: i + 1,
              column: (sm.index ?? 0) + 1,
              match: value.length > 40 ? `${value.slice(0, 20)}...` : value,
              suggestion:
                "High-entropy string detected. If this is a secret, use an environment variable instead.",
              file: fileName,
            });
          }
        }
      }
    }

    if (findings.length > 0) {
      logger.warn(
        {
          findingCount: findings.length,
          types: [...new Set(findings.map((f) => f.type))],
          file: fileName,
        },
        "Secrets detected in generated code"
      );
    }

    return findings;
  }

  /**
   * Merge Semgrep scan results with regex/entropy findings.
   * This enriches the detection pipeline with Semgrep's rules.
   */
  mergeWithSemgrep(
    regexFindings: SecretFinding[],
    semgrepResult: SemgrepResult
  ): SecretFinding[] {
    const merged = [...regexFindings];

    for (const finding of semgrepResult.findings) {
      // Only include findings from secret-related rules
      if (!SEMGREP_SECRET_RULES.has(finding.ruleId)) {
        continue;
      }

      // Deduplicate against existing regex findings (same file + line)
      const isDuplicate = merged.some(
        (f) => f.file === finding.filePath && f.line === finding.line
      );

      if (!isDuplicate) {
        merged.push({
          type: `semgrep:${finding.ruleId}`,
          severity: this.mapSemgrepSeverity(finding.severity),
          line: finding.line,
          column: finding.column,
          match: finding.message.slice(0, 60),
          suggestion: finding.message,
          file: finding.filePath,
        });
      }
    }

    return merged;
  }

  /**
   * Determine whether findings should block the commit.
   * Any critical or high severity finding blocks.
   */
  shouldBlock(findings: SecretFinding[]): boolean {
    return findings.some(
      (f) => f.severity === "critical" || f.severity === "high"
    );
  }

  /**
   * Perform a full scan and return structured results with blocking decision.
   */
  fullScan(
    code: string,
    fileName?: string,
    semgrepResult?: SemgrepResult
  ): SecretScanResult {
    let findings = this.scan(code, fileName);

    if (semgrepResult) {
      findings = this.mergeWithSemgrep(findings, semgrepResult);
    }

    const summary = {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
    };

    const blocked = this.shouldBlock(findings);

    if (blocked) {
      logger.error(
        {
          fileName,
          critical: summary.critical,
          high: summary.high,
          total: findings.length,
        },
        "Commit blocked: secrets detected"
      );
    }

    return { findings, summary, blocked };
  }

  /**
   * Build user-friendly notification about detected secrets.
   */
  buildNotification(
    findings: SecretFinding[],
    fileName: string
  ): SecretNotification {
    const lines: string[] = [
      `Secret detection found ${findings.length} potential secret(s) in ${fileName}:`,
      "",
    ];

    for (const finding of findings) {
      const severity = finding.severity.toUpperCase();
      lines.push(
        `  [${severity}] ${finding.type} at line ${finding.line}:${finding.column}`
      );
      lines.push(`    Match: ${finding.match}`);
      lines.push(`    Fix: ${finding.suggestion}`);
      lines.push("");
    }

    if (this.shouldBlock(findings)) {
      lines.push(
        "BLOCKED: This commit has been blocked because it contains critical or high severity secrets."
      );
      lines.push(
        "Please remove the secrets and use environment variables instead."
      );
    }

    return {
      file: fileName,
      findings,
      message: lines.join("\n"),
    };
  }

  private getLineInfo(
    code: string,
    index: number
  ): { column: number; line: number } {
    const upToIndex = code.slice(0, index);
    const lines = upToIndex.split("\n");
    return {
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
    };
  }

  private mapSemgrepSeverity(
    severity: "HIGH" | "MEDIUM" | "LOW"
  ): SecretSeverity {
    switch (severity) {
      case "HIGH":
        return "critical";
      case "MEDIUM":
        return "high";
      case "LOW":
        return "medium";
      default:
        return "low";
    }
  }
}
