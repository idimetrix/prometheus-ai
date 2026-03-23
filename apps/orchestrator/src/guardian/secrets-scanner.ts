import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:secrets-scanner");

export interface SecretMatch {
  description: string;
  line: number;
  matched: string;
  pattern: string;
}

export interface ScanResult {
  blocked: boolean;
  matches: SecretMatch[];
  message: string;
}

/**
 * Regex patterns that detect common secrets and credentials in source code.
 * Each pattern has a name and description for clear reporting.
 */
const SECRET_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  description: string;
}> = [
  {
    name: "AWS Access Key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    description: "AWS Access Key ID detected",
  },
  {
    name: "AWS Secret Key",
    pattern: /\b[A-Za-z0-9/+=]{40}\b(?=.*(?:aws|secret|key))/i,
    description: "Possible AWS Secret Access Key",
  },
  {
    name: "GitHub Token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/,
    description: "GitHub personal access token or OAuth token",
  },
  {
    name: "GitHub Classic Token",
    pattern: /\bghp_[A-Za-z0-9]{36}\b/,
    description: "GitHub classic personal access token",
  },
  {
    name: "Stripe Secret Key",
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/,
    description: "Stripe secret API key",
  },
  {
    name: "Stripe Publishable Key",
    pattern: /\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b/,
    description: "Stripe publishable key (consider using env var)",
  },
  {
    name: "Generic API Key Assignment",
    pattern:
      /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_\-/.+=]{20,}["']/i,
    description: "Hardcoded API key assignment",
  },
  {
    name: "Generic Secret Assignment",
    pattern:
      /(?:secret|password|passwd|pwd|token|auth[_-]?token|access[_-]?token)\s*[:=]\s*["'][^"']{8,}["']/i,
    description: "Hardcoded secret or password assignment",
  },
  {
    name: "Database Connection String",
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^/\s"']+/i,
    description: "Database connection string with credentials",
  },
  {
    name: "Private Key",
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
    description: "Private key embedded in source code",
  },
  {
    name: "JWT Token",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    description: "Hardcoded JWT token",
  },
  {
    name: "Slack Webhook",
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
    description: "Slack webhook URL",
  },
  {
    name: "SendGrid API Key",
    pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
    description: "SendGrid API key",
  },
  {
    name: "OpenAI API Key",
    pattern: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/,
    description: "OpenAI API key",
  },
  {
    name: "Anthropic API Key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/,
    description: "Anthropic API key",
  },
  {
    name: "GCP Service Account Key",
    pattern: /"type"\s*:\s*"service_account"/,
    description: "Google Cloud service account key file detected",
  },
  {
    name: "SSH Private Key",
    pattern: /-----BEGIN (?:OPENSSH |EC )?PRIVATE KEY-----/,
    description: "SSH private key embedded in source code",
  },
  {
    name: "Twilio Auth Token",
    pattern: /\b[0-9a-f]{32}\b(?=.*twilio)/i,
    description: "Possible Twilio auth token",
  },
  {
    name: "Mailgun API Key",
    pattern: /\bkey-[0-9a-zA-Z]{32}\b/,
    description: "Mailgun API key detected",
  },
  {
    name: "Heroku API Key",
    pattern:
      /(?:heroku[_-]?api[_-]?key|HEROKU_API_KEY)\s*[:=]\s*["'][a-f0-9-]{36}["']/i,
    description: "Heroku API key detected",
  },
  {
    name: "NPM Token",
    pattern: /\bnpm_[a-zA-Z0-9]{36}\b/,
    description: "NPM access token detected",
  },
];

/**
 * Paths/patterns that are exempt from secret scanning (e.g., .env.example files,
 * test fixtures, documentation).
 */
const EXEMPT_PATHS = [
  /\.env\.example$/,
  /\.env\.template$/,
  /\.env\.sample$/,
  /__tests__\//,
  /\.test\./,
  /\.spec\./,
  /fixtures?\//,
  /mocks?\//,
  /README\.md$/i,
  /CONTRIBUTING\.md$/i,
];

/**
 * SecretsScanner checks file content for hardcoded secrets before
 * allowing file_write operations. If secrets are found, the write
 * is blocked and the agent is instructed to use environment variables.
 */
export class SecretsScanner {
  /**
   * Scan file content for secrets. Returns a ScanResult indicating
   * whether the write should be blocked.
   */
  scan(filePath: string, content: string): ScanResult {
    // Skip scanning for exempt paths
    if (EXEMPT_PATHS.some((re) => re.test(filePath))) {
      return { blocked: false, matches: [], message: "" };
    }

    const matches: SecretMatch[] = [];
    const lines = content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx] as string;

      // Skip comments that discuss secrets conceptually
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("*")
      ) {
        continue;
      }

      for (const { name, pattern, description } of SECRET_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          // Mask the matched value for logging
          const matchedValue = match[0];
          const masked =
            matchedValue.length > 8
              ? `${matchedValue.slice(0, 4)}...${matchedValue.slice(-4)}`
              : "****";

          matches.push({
            pattern: name,
            description,
            line: lineIdx + 1,
            matched: masked,
          });
        }
      }
    }

    if (matches.length === 0) {
      return { blocked: false, matches: [], message: "" };
    }

    const message = this.buildBlockMessage(filePath, matches);
    logger.warn(
      { filePath, secretCount: matches.length },
      "Secrets detected in file content — blocking write"
    );

    return { blocked: true, matches, message };
  }

  /**
   * Scan an entire directory of file contents for secrets. Accepts
   * a map of filePath -> content for batch scanning.
   */
  scanDirectory(files: Record<string, string>): Record<string, ScanResult> {
    const results: Record<string, ScanResult> = {};

    for (const [filePath, content] of Object.entries(files)) {
      results[filePath] = this.scan(filePath, content);
    }

    const blockedCount = Object.values(results).filter((r) => r.blocked).length;

    if (blockedCount > 0) {
      logger.warn(
        {
          totalFiles: Object.keys(files).length,
          blockedFiles: blockedCount,
        },
        "Secrets detected during directory scan"
      );
    }

    return results;
  }

  /**
   * Get all secret types that this scanner can detect.
   */
  getSecretTypes(): Array<{ description: string; name: string }> {
    return SECRET_PATTERNS.map((p) => ({
      name: p.name,
      description: p.description,
    }));
  }

  private buildBlockMessage(filePath: string, matches: SecretMatch[]): string {
    const details = matches
      .map(
        (m) =>
          `  - Line ${m.line}: ${m.description} (${m.pattern}: ${m.matched})`
      )
      .join("\n");

    return (
      `BLOCKED: Potential secrets detected in ${filePath}:\n${details}\n\n` +
      "Do NOT hardcode secrets in source code. Instead:\n" +
      "1. Use environment variables (process.env.YOUR_SECRET)\n" +
      "2. Add the variable name to .env.example with a placeholder value\n" +
      "3. Document the required env var in the README or deployment docs\n" +
      "4. Re-write the file using environment variable references"
    );
  }
}
