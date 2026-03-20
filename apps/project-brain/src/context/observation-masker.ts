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

// ── Sensitive data patterns ──────────────────────────────────────────────────

interface SensitivePattern {
  /** Human-readable category label */
  category: string;
  /** Prefix for the masked placeholder */
  label: string;
  /** Regex to match the sensitive value */
  pattern: RegExp;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // API Keys
  {
    category: "api_key",
    label: "AWS_KEY",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  {
    category: "api_key",
    label: "AWS_SECRET",
    pattern:
      /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/g,
  },
  {
    category: "api_key",
    label: "GH_TOKEN",
    pattern: /\b(ghp_[A-Za-z0-9]{36})\b/g,
  },
  {
    category: "api_key",
    label: "GH_TOKEN",
    pattern: /\b(github_pat_[A-Za-z0-9_]{82})\b/g,
  },
  {
    category: "api_key",
    label: "STRIPE_KEY",
    pattern: /\b(sk_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
  },
  {
    category: "api_key",
    label: "STRIPE_KEY",
    pattern: /\b(pk_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
  },
  {
    category: "api_key",
    label: "OPENAI_KEY",
    pattern: /\b(sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\b/g,
  },
  {
    category: "api_key",
    label: "OPENAI_KEY",
    pattern: /\b(sk-proj-[A-Za-z0-9_-]{40,})\b/g,
  },
  {
    category: "api_key",
    label: "ANTHROPIC_KEY",
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{40,})\b/g,
  },
  {
    category: "api_key",
    label: "SLACK_TOKEN",
    pattern: /\b(xox[bpors]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    category: "api_key",
    label: "GENERIC_KEY",
    pattern:
      /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?([A-Za-z0-9_\-/.+=]{20,})["']?/gi,
  },

  // Credentials
  {
    category: "credential",
    label: "PASSWORD",
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']?([^\s"']{8,})["']?/gi,
  },
  {
    category: "credential",
    label: "SECRET",
    pattern: /(?:secret|private[_-]?key)\s*[=:]\s*["']?([^\s"']{8,})["']?/gi,
  },
  {
    category: "credential",
    label: "DB_URL",
    pattern: /\b((?:postgres|mysql|mongodb|redis):\/\/[^\s"']+)\b/gi,
  },
  {
    category: "credential",
    label: "JWT",
    pattern:
      /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)\b/g,
  },
  {
    category: "credential",
    label: "BEARER",
    pattern: /Bearer\s+([A-Za-z0-9_\-/.+=]{20,})/g,
  },

  // PII
  {
    category: "pii",
    label: "EMAIL",
    pattern: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
  },
  {
    category: "pii",
    label: "SSN",
    pattern: /\b(\d{3}-\d{2}-\d{4})\b/g,
  },
  {
    category: "pii",
    label: "PHONE",
    pattern: /\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g,
  },
  {
    category: "pii",
    label: "IP_ADDR",
    pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
  },
];

/**
 * A masked value entry storing the original and its placeholder.
 */
interface MaskedEntry {
  category: string;
  label: string;
  original: string;
  placeholder: string;
}

/**
 * Generate a deterministic short hash for a given input string.
 * Same input always yields the same hash, enabling consistency across iterations.
 */
function deterministicHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 6);
}

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
 * // "API key: [MASKED_OPENAI_KEY_e3b0c4]"
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

  /**
   * Mask all detected sensitive data in the input text.
   *
   * @param text - Input text potentially containing sensitive data
   * @returns Text with sensitive values replaced by deterministic placeholders
   */
  mask(text: string): string {
    let result = text;

    for (const rule of SENSITIVE_PATTERNS) {
      // Create a fresh regex instance to reset lastIndex
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null = regex.exec(result);

      while (match !== null) {
        const sensitiveValue = match[1];
        if (sensitiveValue && sensitiveValue.length > 0) {
          const placeholder = this.getOrCreatePlaceholder(
            sensitiveValue,
            rule.label,
            rule.category
          );
          result = result.replaceAll(sensitiveValue, placeholder);
          // Reset regex since we modified the string
          regex.lastIndex = 0;
        }
        match = regex.exec(result);
        // Safety: break if regex is not advancing
        if (match !== null && match.index === regex.lastIndex) {
          break;
        }
      }
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
    let result = text;

    for (const [placeholder, entry] of this.maskMap) {
      if (result.includes(placeholder)) {
        result = result.replaceAll(placeholder, entry.original);
      }
    }

    return result;
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
    for (const rule of SENSITIVE_PATTERNS) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      if (regex.test(text)) {
        return true;
      }
    }
    return false;
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
   * Get or create a deterministic placeholder for a sensitive value.
   * Same input always yields the same placeholder.
   */
  private getOrCreatePlaceholder(
    original: string,
    label: string,
    category: string
  ): string {
    const existing = this.reverseMap.get(original);
    if (existing) {
      return existing;
    }

    const hash = deterministicHash(original);
    const placeholder = `[MASKED_${label}_${hash}]`;

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
