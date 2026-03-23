/**
 * OWASP Top 10 vulnerability detection patterns.
 * Provides regex-based scanning for common security vulnerabilities
 * and license compliance issues in source code.
 *
 * NOTE: The regex patterns below intentionally reference dangerous functions
 * like eval, innerHTML, and command execution — these are DETECTION patterns
 * used by the security auditor agent to find vulnerabilities in reviewed code.
 */

export type OWASPSeverity = "critical" | "high" | "medium" | "low";

export interface OWASPPattern {
  /** Suggested fix description */
  fix: string;
  /** OWASP category ID, e.g., "A01:2021" */
  id: string;
  /** Human-readable vulnerability name */
  name: string;
  /** Regex patterns that may indicate this vulnerability */
  patterns: RegExp[];
  /** Severity level */
  severity: OWASPSeverity;
}

export interface OWASPFinding {
  /** Suggested fix description */
  fix: string;
  /** OWASP category ID */
  id: string;
  /** Line number where the match was found (1-based) */
  line: number;
  /** The matched pattern */
  match: string;
  /** Human-readable vulnerability name */
  name: string;
  /** Severity level */
  severity: OWASPSeverity;
}

export const OWASP_PATTERNS: OWASPPattern[] = [
  // A01:2021 — Broken Access Control
  {
    id: "A01:2021",
    name: "Broken Access Control",
    patterns: [
      /publicProcedure\s*\.\s*mutation/g,
      /\.from\(\w+\)(?![\s\S]{0,100}orgId)/g,
      /res\.send\((?:req\.)?user/g,
      /path\.join\([^)]*\.\./g,
    ],
    severity: "critical",
    fix: "Ensure all mutations use protectedProcedure. All tenant-scoped queries must include orgId filtering. Validate path parameters to prevent directory traversal.",
  },

  // A02:2021 — Cryptographic Failures
  {
    id: "A02:2021",
    name: "Cryptographic Failures",
    patterns: [
      /(?:password|secret|api_key|apiKey|token)\s*[:=]\s*["'][^"']{4,}["']/gi,
      /(?:MD5|SHA1)\s*\(/gi,
      /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)/gi,
      /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/gi,
    ],
    severity: "critical",
    fix: "Never hardcode secrets in source code. Use environment variables or a secrets manager. Use SHA-256+ or bcrypt for hashing. Always use HTTPS for external connections.",
  },

  // A03:2021 — Injection
  {
    id: "A03:2021",
    name: "Injection",
    patterns: [
      /\$\{[^}]*\}\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|FROM|WHERE)/gi,
      /`\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^`]*\$\{/gi,
      /\beval\s*\(/g,
      /new\s+Function\s*\(/g,
      /\.query\s*\(\s*`[^`]*\$\{/g,
      /innerHTML\s*=/g,
      /dangerouslySetInnerHTML/g,
      /document\.write\s*\(/g,
    ],
    severity: "critical",
    fix: "Use parameterized queries (Drizzle ORM, prepared statements). Never use eval() or Function constructor with user input. Use textContent instead of innerHTML. Validate and sanitize all user input.",
  },

  // A04:2021 — Insecure Design
  {
    id: "A04:2021",
    name: "Insecure Design",
    patterns: [
      /TODO.*(?:auth|secur|valid)/gi,
      /FIXME.*(?:auth|secur|valid)/gi,
      /\/\/\s*(?:no auth|skip auth|bypass|disable.*check)/gi,
    ],
    severity: "medium",
    fix: "Address security-related TODOs and FIXMEs. Implement proper authentication and authorization. Do not bypass security checks even temporarily.",
  },

  // A05:2021 — Security Misconfiguration
  {
    id: "A05:2021",
    name: "Security Misconfiguration",
    patterns: [
      /NEXT_PUBLIC_.*(?:SECRET|KEY|TOKEN|PASSWORD)/gi,
      /cors\(\s*\{\s*origin\s*:\s*(?:true|["']\*["'])/gi,
      /Access-Control-Allow-Origin.*\*/g,
      /DEBUG\s*[:=]\s*(?:true|1|["']true["'])/gi,
      /NODE_ENV.*development.*production/gi,
    ],
    severity: "high",
    fix: "Never expose secrets in NEXT_PUBLIC_ env vars. Restrict CORS to specific origins. Disable debug mode in production. Ensure proper environment configuration.",
  },

  // A06:2021 — Vulnerable and Outdated Components
  {
    id: "A06:2021",
    name: "Vulnerable and Outdated Components",
    patterns: [
      /require\s*\(\s*["'](?:express|lodash|moment)["']\s*\)/g,
      /FROM\s+(?:node|python|ruby|golang)(?:\s*:\s*latest|\s+AS)/gi,
    ],
    severity: "medium",
    fix: "Pin Docker base images to specific versions. Run pnpm audit regularly. Replace deprecated packages (moment -> date-fns/luxon). Keep dependencies updated.",
  },

  // A07:2021 — Identification and Authentication Failures
  {
    id: "A07:2021",
    name: "Identification and Authentication Failures",
    patterns: [
      /jwt\.sign\([^)]*algorithm\s*:\s*["'](?:HS256|none)["']/gi,
      /session.*(?:httpOnly|secure)\s*:\s*false/gi,
      /cookie.*(?:httpOnly|secure)\s*:\s*false/gi,
      /maxAge\s*:\s*\d{10,}/g,
    ],
    severity: "high",
    fix: "Use RS256/ES256 for JWT signing. Set httpOnly, secure, and sameSite on session cookies. Use reasonable session expiry times. Implement proper logout.",
  },

  // A08:2021 — Software and Data Integrity Failures
  {
    id: "A08:2021",
    name: "Software and Data Integrity Failures",
    patterns: [
      /JSON\.parse\s*\(\s*(?:req\.body|request\.body|data)\s*\)/g,
      /deserialize\s*\(\s*(?:req|request|data|input)/gi,
      /\.fromJSON\s*\(\s*(?:req|request|data|input)/gi,
    ],
    severity: "medium",
    fix: "Validate and sanitize all deserialized data. Use Zod schemas for input validation. Verify integrity of external data sources.",
  },

  // A09:2021 — Security Logging and Monitoring Failures
  {
    id: "A09:2021",
    name: "Security Logging and Monitoring Failures",
    patterns: [
      /console\.\s*(?:log|warn|error)\s*\(/g,
      /catch\s*\([^)]*\)\s*\{\s*\}/g,
      /catch\s*\{\s*\}/g,
      /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g,
    ],
    severity: "low",
    fix: "Use structured logging (@prometheus/logger) instead of console.log. Never swallow errors silently. Log authentication failures and security events with context.",
  },

  // A10:2021 — Server-Side Request Forgery (SSRF)
  {
    id: "A10:2021",
    name: "Server-Side Request Forgery (SSRF)",
    patterns: [
      /fetch\s*\(\s*(?:req\.|request\.|input\.|args\.)/g,
      /axios\s*\.\s*(?:get|post|put|delete)\s*\(\s*(?:req\.|request\.|input\.|args\.)/g,
      /(?:http|https)\.(?:get|request)\s*\(\s*(?:req\.|input\.|args\.)/g,
      /new\s+URL\s*\(\s*(?:req\.|request\.|input\.|args\.)/g,
    ],
    severity: "high",
    fix: "Validate all user-provided URLs against an allowlist. Block requests to internal networks (10.x, 172.16-31.x, 192.168.x, 127.x, localhost). Use a URL validation library.",
  },
];

/** License compliance patterns for detecting restrictive open-source licenses */
export interface LicenseFinding {
  /** The detected license type */
  license: string;
  /** Line number (1-based) */
  line: number;
  /** The matched import or reference */
  match: string;
  /** Risk description */
  risk: string;
}

const LICENSE_PATTERNS: Array<{
  license: string;
  patterns: RegExp[];
  risk: string;
}> = [
  {
    license: "GPL-3.0",
    patterns: [
      /(?:^|\s)(?:require|import).*(?:gpl|gnu-public)/gi,
      /License:\s*GPL/gi,
      /SPDX-License-Identifier:\s*GPL/gi,
    ],
    risk: "GPL-3.0 is a copyleft license that requires derivative works to be released under the same license. This may conflict with proprietary distribution.",
  },
  {
    license: "AGPL-3.0",
    patterns: [
      /(?:^|\s)(?:require|import).*agpl/gi,
      /License:\s*AGPL/gi,
      /SPDX-License-Identifier:\s*AGPL/gi,
    ],
    risk: "AGPL-3.0 extends GPL to network use. Any service using AGPL code must make source available to all network users. Critical risk for SaaS.",
  },
];

/**
 * Scans code for OWASP Top 10 vulnerability patterns.
 *
 * Note: This is a heuristic regex-based scan and may produce
 * false positives. Findings should be reviewed by a security auditor.
 *
 * @param code - Source code string to analyze
 * @returns Array of findings with severity, location, and fix suggestions
 */
export function checkForVulnerabilities(code: string): OWASPFinding[] {
  const findings: OWASPFinding[] = [];
  const lines = code.split("\n");

  for (const pattern of OWASP_PATTERNS) {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }

      for (const regex of pattern.patterns) {
        // Reset regex state for global patterns
        const localRegex = new RegExp(regex.source, regex.flags);
        let match = localRegex.exec(line);

        while (match) {
          findings.push({
            id: pattern.id,
            name: pattern.name,
            severity: pattern.severity,
            match: match[0].slice(0, 120),
            line: lineIndex + 1,
            fix: pattern.fix,
          });
          match = localRegex.exec(line);
        }
      }
    }
  }

  // Sort by severity: critical > high > medium > low
  const severityOrder: Record<OWASPSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  findings.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  return findings;
}

/**
 * Scans code for restrictive license references (GPL, AGPL).
 *
 * @param code - Source code string to analyze
 * @returns Array of license compliance findings
 */
export function checkLicenseCompliance(code: string): LicenseFinding[] {
  const findings: LicenseFinding[] = [];
  const lines = code.split("\n");

  for (const licensePattern of LICENSE_PATTERNS) {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }

      for (const regex of licensePattern.patterns) {
        const localRegex = new RegExp(regex.source, regex.flags);
        const match = localRegex.exec(line);

        if (match) {
          findings.push({
            license: licensePattern.license,
            match: match[0].slice(0, 120),
            line: lineIndex + 1,
            risk: licensePattern.risk,
          });
        }
      }
    }
  }

  return findings;
}
