/**
 * Phase 4.5: Observation Masking.
 *
 * Detects and masks sensitive data (API keys, PII, credentials) in text
 * before passing to LLMs. Uses deterministic hashing so the same input
 * always produces the same masked placeholder, enabling consistency
 * across iterations. Provides unmask() to reverse-mask in LLM output.
 */
import crypto from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:observation-masker");

// ── Types ───────────────────────────────────────────────────────────────────

/** Categories of sensitive data that can be detected and masked. */
export type SensitiveCategory =
  | "api_key"
  | "credential"
  | "pii"
  | "crypto"
  | "infrastructure";

/** Human-readable labels for specific sensitive data types. */
export type SensitiveLabel =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "ipv6_address"
  | "api_key"
  | "aws_key"
  | "aws_secret"
  | "gh_token"
  | "stripe_key"
  | "openai_key"
  | "anthropic_key"
  | "slack_token"
  | "generic_key"
  | "password"
  | "secret"
  | "db_url"
  | "jwt"
  | "bearer"
  | "private_key"
  | "generic_secret";

/** A pattern definition for detecting one kind of sensitive data. */
interface SensitivePattern {
  /** High-level category */
  category: SensitiveCategory;
  /** Specific label used in the redaction placeholder */
  label: SensitiveLabel;
  /** Regex to match the sensitive value (must have a capture group) */
  pattern: RegExp;
  /**
   * Optional transform applied to the original text when masking.
   * If provided, this function receives the full match and returns the
   * replacement string. Useful for partial masking (e.g., DB URLs where
   * only the credentials portion should be redacted).
   */
  transform?: (match: string, placeholder: string) => string;
  /** Optional validation function for reducing false positives */
  validate?: (match: string) => boolean;
}

/** Configuration for the ObservationMasker. */
export interface ObservationMaskerConfig {
  /** Allowlist of patterns that should NOT be masked (e.g., known safe values). */
  allowlist?: RegExp[];
  /** Custom additional patterns to detect. */
  customPatterns?: SensitivePattern[];
  /** Which categories to enable. Defaults to all categories. */
  enabledCategories?: SensitiveCategory[];
  /** Which specific labels to enable. If set, only these labels are masked. */
  enabledLabels?: SensitiveLabel[];
  /** Whether to mask content inside code fences. Defaults to true. */
  maskInsideCodeFences?: boolean;
}

// ── Validators ──────────────────────────────────────────────────────────────

/**
 * Validate an IPv4 address: each octet must be 0-255.
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return false;
  }
  for (const part of parts) {
    const num = Number.parseInt(part, 10);
    if (Number.isNaN(num) || num < 0 || num > 255) {
      return false;
    }
    // Reject leading zeros (e.g., 01.02.03.04) to reduce false positives
    if (part.length > 1 && part.startsWith("0")) {
      return false;
    }
  }
  // Skip common version-like patterns (e.g., 1.2.3.4 could be a version)
  // We consider it an IP if any octet > 25 (heuristic to skip semver-like)
  const octets = parts.map((p) => Number.parseInt(p, 10));
  const looksLikeVersion = octets.every((o) => o <= 25);
  // Loopback and private ranges are always valid IPs
  const isPrivateOrLoopback =
    octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 172 &&
      octets[1] !== undefined &&
      octets[1] >= 16 &&
      octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
  if (looksLikeVersion && !isPrivateOrLoopback) {
    return false;
  }
  return true;
}

const CREDIT_CARD_DIGIT_PATTERN = /^\d{13,19}$/;

/**
 * Luhn algorithm to validate credit card numbers.
 */
function isValidLuhn(digits: string): boolean {
  const cleaned = digits.replace(/[\s-]/g, "");
  if (!CREDIT_CARD_DIGIT_PATTERN.test(cleaned)) {
    return false;
  }

  let sum = 0;
  let alternate = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let n = Number.parseInt(cleaned[i] as string, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Validate that a phone number has the right digit count (10-15 digits).
 */
function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

// ── Sensitive data patterns ─────────────────────────────────────────────────

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // ── API Keys ──────────────────────────────────────────────────────────────
  {
    category: "api_key",
    label: "aws_key",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  {
    category: "api_key",
    label: "aws_secret",
    pattern:
      /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/g,
  },
  {
    category: "api_key",
    label: "gh_token",
    pattern: /\b(ghp_[A-Za-z0-9]{36})\b/g,
  },
  {
    category: "api_key",
    label: "gh_token",
    pattern: /\b(gho_[A-Za-z0-9]{36})\b/g,
  },
  {
    category: "api_key",
    label: "gh_token",
    pattern: /\b(ghs_[A-Za-z0-9]{36})\b/g,
  },
  {
    category: "api_key",
    label: "gh_token",
    pattern: /\b(ghu_[A-Za-z0-9]{36})\b/g,
  },
  {
    category: "api_key",
    label: "gh_token",
    pattern: /\b(github_pat_[A-Za-z0-9_]{82})\b/g,
  },
  {
    category: "api_key",
    label: "stripe_key",
    pattern: /\b(sk_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
  },
  {
    category: "api_key",
    label: "stripe_key",
    pattern: /\b(pk_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
  },
  {
    category: "api_key",
    label: "openai_key",
    pattern: /\b(sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\b/g,
  },
  {
    category: "api_key",
    label: "openai_key",
    pattern: /\b(sk-proj-[A-Za-z0-9_-]{40,})\b/g,
  },
  {
    category: "api_key",
    label: "anthropic_key",
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{40,})\b/g,
  },
  {
    category: "api_key",
    label: "slack_token",
    pattern: /\b(xox[bpors]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    category: "api_key",
    label: "generic_key",
    pattern:
      /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?([A-Za-z0-9_\-/.+=]{20,})["']?/gi,
  },

  // ── Credentials ───────────────────────────────────────────────────────────
  {
    category: "credential",
    label: "password",
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']?([^\s"']{8,})["']?/gi,
  },
  {
    category: "credential",
    label: "secret",
    pattern:
      /(?:secret|private[_-]?key|client[_-]?secret)\s*[=:]\s*["']?([^\s"']{8,})["']?/gi,
  },
  {
    category: "credential",
    label: "db_url",
    pattern:
      /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|mariadb):\/\/[^\s"']+)\b/gi,
    transform: (original: string, placeholder: string): string => {
      // Mask only the credentials in the DB URL, preserve host/db structure
      try {
        const url = new URL(original);
        if (url.username || url.password) {
          // Return the URL with credentials replaced
          const masked = original.replace(
            `${url.username}:${url.password}@`,
            `${placeholder}@`
          );
          return masked;
        }
      } catch {
        // If URL parsing fails, mask the entire thing
      }
      return placeholder;
    },
  },
  {
    category: "credential",
    label: "jwt",
    pattern:
      /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)\b/g,
  },
  {
    category: "credential",
    label: "bearer",
    pattern: /Bearer\s+([A-Za-z0-9_\-/.+=]{20,})/g,
  },

  // ── Crypto / Private Keys ─────────────────────────────────────────────────
  {
    category: "crypto",
    label: "private_key",
    pattern:
      /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----)/g,
  },
  {
    category: "crypto",
    label: "generic_secret",
    pattern:
      /(-----BEGIN (?:CERTIFICATE|PUBLIC KEY|ENCRYPTED PRIVATE KEY)-----[\s\S]*?-----END (?:CERTIFICATE|PUBLIC KEY|ENCRYPTED PRIVATE KEY)-----)/g,
  },

  // ── PII ───────────────────────────────────────────────────────────────────
  {
    category: "pii",
    label: "email",
    pattern: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
  },
  {
    category: "pii",
    label: "ssn",
    pattern: /\b(\d{3}-\d{2}-\d{4})\b/g,
  },
  {
    category: "pii",
    label: "credit_card",
    pattern: /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/g,
    validate: isValidLuhn,
  },
  {
    category: "pii",
    label: "credit_card",
    pattern: /\b(\d{4}[\s-]?\d{6}[\s-]?\d{5})\b/g,
    validate: isValidLuhn,
  },
  {
    category: "pii",
    label: "phone",
    pattern:
      /(?<![.\d])(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?![.\d])/g,
    validate: isValidPhone,
  },
  {
    category: "pii",
    label: "phone",
    pattern:
      /(?<![.\d])(\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9})(?![.\d])/g,
    validate: isValidPhone,
  },

  // ── Infrastructure ────────────────────────────────────────────────────────
  {
    category: "infrastructure",
    label: "ip_address",
    pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    validate: isValidIPv4,
  },
  {
    category: "infrastructure",
    label: "ipv6_address",
    pattern:
      /\b((?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|::(?:[fF]{4}:)?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::)\b/g,
  },
];

// ── Masked entry type ───────────────────────────────────────────────────────

/**
 * A masked value entry storing the original and its placeholder.
 */
interface MaskedEntry {
  category: SensitiveCategory;
  label: SensitiveLabel;
  original: string;
  placeholder: string;
}

// ── Utility ─────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic short hash for a given input string.
 * Same input always yields the same hash, enabling consistency across iterations.
 */
function deterministicHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 8);
}

/**
 * Default placeholder format: [REDACTED:<type>]
 * A hash suffix is appended to ensure distinct placeholders when multiple
 * values share the same type (e.g., two different emails).
 */
function formatPlaceholder(label: string, hash: string): string {
  return `[REDACTED:${label}:${hash}]`;
}

// ── ObservationMasker ───────────────────────────────────────────────────────

/**
 * ObservationMasker detects and replaces sensitive data in text with
 * deterministic hash-based placeholders. The same sensitive value always
 * maps to the same placeholder, preserving referential consistency
 * across multiple masking calls.
 *
 * @example
 * ```ts
 * const masker = new ObservationMasker();
 * const masked = masker.mask("API key: sk-proj-abc123...");
 * // "API key: [REDACTED:openai_key:a1b2c3d4]"
 *
 * const output = masker.unmask(llmResponse);
 * // Restores original values in LLM output
 * ```
 */
export class ObservationMasker {
  /** Map from placeholder to original value for unmasking */
  private readonly maskMap = new Map<string, MaskedEntry>();
  /** Map from original value to placeholder for deterministic re-masking */
  private readonly reverseMap = new Map<string, string>();
  /** Active configuration */
  private readonly config: Required<
    Omit<ObservationMaskerConfig, "customPatterns">
  > & {
    customPatterns: SensitivePattern[];
  };
  /** Merged pattern list (built-in + custom) */
  private readonly patterns: SensitivePattern[];

  constructor(config?: ObservationMaskerConfig) {
    this.config = {
      enabledCategories: config?.enabledCategories ?? [
        "api_key",
        "credential",
        "pii",
        "crypto",
        "infrastructure",
      ],
      enabledLabels: config?.enabledLabels ?? [],
      allowlist: config?.allowlist ?? [],
      maskInsideCodeFences: config?.maskInsideCodeFences ?? true,
      customPatterns: config?.customPatterns ?? [],
    };

    // Merge built-in + custom patterns, filtered by enabled categories/labels
    this.patterns = [
      ...SENSITIVE_PATTERNS,
      ...this.config.customPatterns,
    ].filter((p) => {
      if (!this.config.enabledCategories.includes(p.category)) {
        return false;
      }
      if (
        this.config.enabledLabels.length > 0 &&
        !this.config.enabledLabels.includes(p.label)
      ) {
        return false;
      }
      return true;
    });

    logger.debug(
      { patternCount: this.patterns.length },
      "ObservationMasker initialized"
    );
  }

  /**
   * Mask all detected sensitive data in the input text.
   *
   * @param text - Input text potentially containing sensitive data
   * @returns Text with sensitive values replaced by deterministic placeholders
   */
  mask(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    let result = text;

    for (const rule of this.patterns) {
      result = this.applyRule(result, rule);
    }

    return result;
  }

  /**
   * Unmask placeholders in text, restoring original sensitive values.
   * Useful for reverse-masking LLM output that references masked values.
   *
   * @param text - Text potentially containing masked placeholders
   * @returns Text with placeholders replaced by original values
   */
  unmask(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    let result = text;

    for (const [placeholder, entry] of this.maskMap) {
      if (result.includes(placeholder)) {
        result = result.replaceAll(placeholder, entry.original);
      }
    }

    return result;
  }

  /**
   * Partially mask a value, showing only the first and last few characters.
   * Useful for logging where you want a hint of the value without full exposure.
   *
   * @param text - Input text to partially mask
   * @param visibleChars - Number of characters to show at start and end (default 4)
   * @returns Partially masked text
   */
  partialMask(text: string, visibleChars = 4): string {
    if (text.length <= visibleChars * 2 + 3) {
      return "***";
    }
    return `${text.slice(0, visibleChars)}***${text.slice(-visibleChars)}`;
  }

  /**
   * Get the number of currently tracked masked values.
   */
  get size(): number {
    return this.maskMap.size;
  }

  /**
   * Get all masked entries for inspection or logging (without originals).
   */
  getMaskedSummary(): Array<{
    category: string;
    label: string;
    placeholder: string;
  }> {
    return Array.from(this.maskMap.values()).map((entry) => ({
      placeholder: entry.placeholder,
      label: entry.label,
      category: entry.category,
    }));
  }

  /**
   * Check whether text contains any detectable sensitive data.
   */
  containsSensitiveData(text: string): boolean {
    for (const rule of this.patterns) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      const match = regex.exec(text);
      if (match) {
        const value = match[1];
        if (!value) {
          continue;
        }
        // Validate if there's a validator
        if (rule.validate && !rule.validate(value)) {
          continue;
        }
        // Check allowlist
        if (this.isAllowlisted(value)) {
          continue;
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Scan text and return a report of all detected sensitive data without masking.
   * Useful for auditing text before deciding whether to mask.
   */
  scan(text: string): Array<{
    category: SensitiveCategory;
    label: SensitiveLabel;
    index: number;
    length: number;
    preview: string;
  }> {
    const findings: Array<{
      category: SensitiveCategory;
      label: SensitiveLabel;
      index: number;
      length: number;
      preview: string;
    }> = [];

    for (const rule of this.patterns) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match = regex.exec(text);

      while (match !== null) {
        const value = match[1];
        if (
          value &&
          value.length > 0 &&
          !this.isAllowlisted(value) &&
          (!rule.validate || rule.validate(value))
        ) {
          findings.push({
            category: rule.category,
            label: rule.label,
            index: match.index,
            length: value.length,
            preview: this.partialMask(value, 3),
          });
        }
        match = regex.exec(text);
        if (match !== null && match.index === regex.lastIndex) {
          regex.lastIndex++;
          if (regex.lastIndex > text.length) {
            break;
          }
        }
      }
    }

    return findings;
  }

  /**
   * Create a child masker that inherits this masker's state and config.
   * Useful for creating scoped masking contexts that share the same
   * placeholder mappings.
   */
  fork(): ObservationMasker {
    const child = new ObservationMasker({
      enabledCategories: this.config.enabledCategories,
      enabledLabels: this.config.enabledLabels,
      allowlist: this.config.allowlist,
      maskInsideCodeFences: this.config.maskInsideCodeFences,
      customPatterns: this.config.customPatterns,
    });

    // Copy existing mappings
    for (const [placeholder, entry] of this.maskMap) {
      child.maskMap.set(placeholder, { ...entry });
    }
    for (const [original, placeholder] of this.reverseMap) {
      child.reverseMap.set(original, placeholder);
    }

    return child;
  }

  /**
   * Reset the masker, clearing all tracked mappings.
   */
  reset(): void {
    this.maskMap.clear();
    this.reverseMap.clear();
    logger.debug("Observation masker reset");
  }

  /**
   * Add a value to the allowlist at runtime.
   */
  addAllowlistPattern(pattern: RegExp): void {
    this.config.allowlist.push(pattern);
  }

  /**
   * Manually register a sensitive value so it will be masked in future calls.
   * Useful for masking values discovered through other means (e.g., env vars).
   */
  registerSensitiveValue(
    value: string,
    label: SensitiveLabel,
    category: SensitiveCategory
  ): string {
    return this.getOrCreatePlaceholder(value, label, category);
  }

  /**
   * Mask all environment-variable-like values from a key=value block.
   * Detects lines like `SECRET_KEY=abc123` and masks the value portion.
   */
  maskEnvBlock(text: string): string {
    let result = text;

    // Match KEY=VALUE patterns common in .env files and shell exports
    const envPattern =
      /^(export\s+)?([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|CREDENTIAL|AUTH|API))\s*=\s*["']?([^\s"']+)["']?$/gm;

    let match = envPattern.exec(result);
    while (match !== null) {
      const value = match[3];
      if (value && value.length >= 8) {
        const placeholder = this.getOrCreatePlaceholder(
          value,
          "generic_key",
          "credential"
        );
        result = result.replaceAll(value, placeholder);
        envPattern.lastIndex = 0;
      }
      match = envPattern.exec(result);
      if (match !== null && match.index === envPattern.lastIndex) {
        envPattern.lastIndex++;
        if (envPattern.lastIndex > result.length) {
          break;
        }
      }
    }

    // Also run standard masking
    return this.mask(result);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Apply a single pattern rule across the text, replacing all matches.
   */
  private applyRule(text: string, rule: SensitivePattern): string {
    let result = text;
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null = regex.exec(result);

    while (match !== null) {
      const sensitiveValue = match[1];
      if (sensitiveValue && sensitiveValue.length > 0) {
        const replaced = this.processMatch(result, match, sensitiveValue, rule);
        if (replaced !== null) {
          result = replaced;
          regex.lastIndex = 0;
        }
      }

      match = regex.exec(result);
      if (match !== null && match.index === regex.lastIndex) {
        regex.lastIndex++;
        if (regex.lastIndex > result.length) {
          break;
        }
      }
    }

    return result;
  }

  /**
   * Process a single regex match, returning the updated text or null if skipped.
   */
  private processMatch(
    text: string,
    match: RegExpExecArray,
    sensitiveValue: string,
    rule: SensitivePattern
  ): string | null {
    if (this.isAllowlisted(sensitiveValue)) {
      return null;
    }
    if (rule.validate && !rule.validate(sensitiveValue)) {
      return null;
    }

    const placeholder = this.getOrCreatePlaceholder(
      sensitiveValue,
      rule.label,
      rule.category
    );

    if (rule.transform) {
      const fullMatch = match[0];
      const transformed = rule.transform(sensitiveValue, placeholder);
      return text.replace(
        fullMatch,
        fullMatch.replace(sensitiveValue, transformed)
      );
    }

    return text.replaceAll(sensitiveValue, placeholder);
  }

  /**
   * Check whether a value matches any allowlist pattern.
   */
  private isAllowlisted(value: string): boolean {
    for (const pattern of this.config.allowlist) {
      if (pattern.test(value)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get or create a deterministic placeholder for a sensitive value.
   * Same input always yields the same placeholder.
   */
  private getOrCreatePlaceholder(
    original: string,
    label: SensitiveLabel,
    category: SensitiveCategory
  ): string {
    const existing = this.reverseMap.get(original);
    if (existing) {
      return existing;
    }

    const hash = deterministicHash(original);
    const placeholder = formatPlaceholder(label, hash);

    this.maskMap.set(placeholder, {
      original,
      placeholder,
      label,
      category,
    });
    this.reverseMap.set(original, placeholder);

    logger.debug({ placeholder, category, label }, "Sensitive value masked");

    return placeholder;
  }
}
