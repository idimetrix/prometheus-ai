import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:code-secret-detector");

// ─── Types ────────────────────────────────────────────────────────────────────

export type SecretSeverity = "low" | "medium" | "high" | "critical";

export interface SecretFinding {
  column: number;
  line: number;
  match: string;
  severity: SecretSeverity;
  suggestion: string;
  type: string;
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

// ─── Code Secret Detector ─────────────────────────────────────────────────────

export class CodeSecretDetector {
  /**
   * Scan code for potential secrets using regex patterns and entropy analysis.
   */
  scan(code: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = code.split("\n");

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
        });
      }
    }

    // Entropy-based detection for string literals
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
        },
        "Secrets detected in generated code"
      );
    }

    return findings;
  }

  private getLineInfo(
    code: string,
    index: number
  ): { line: number; column: number } {
    const upToIndex = code.slice(0, index);
    const lines = upToIndex.split("\n");
    return {
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
    };
  }
}
