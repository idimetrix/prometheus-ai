/**
 * Cross-User Learner — Anonymized pattern sharing across organizations.
 *
 * Collects anonymized, aggregated patterns from successful project sessions
 * and makes them available to other organizations. All data is stripped of
 * PII, org identifiers, and proprietary code before being stored in the
 * shared knowledge pool.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("project-brain:cross-user-learner");

/** Top-level regex for whitespace splitting (performance). */
const WHITESPACE_SPLIT = /\s+/;

/** Top-level regex for sentence splitting (performance). */
const SENTENCE_SPLIT = /[.!?]/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnonymizedPattern {
  /** Pattern category */
  category:
    | "architecture"
    | "testing"
    | "deployment"
    | "performance"
    | "security"
    | "workflow";
  /** Confidence based on how many orgs contributed */
  confidence: number;
  /** The anonymized pattern content */
  content: string;
  /** Number of organizations that contributed to this pattern */
  contributorCount: number;
  /** When the pattern was created */
  createdAt: string;
  /** Human-readable description */
  description: string;
  /** Unique pattern identifier */
  id: string;
  /** Success rate across contributing orgs */
  successRate: number;
  /** Technology stack tags */
  tags: string[];
  /** When the pattern was last updated */
  updatedAt: string;
}

export interface PatternContribution {
  /** Hashed org identifier (not reversible) */
  orgHash: string;
  /** The raw pattern before anonymization */
  rawPattern: string;
  /** Technology stack */
  stack: string[];
  /** Whether the approach was successful */
  success: boolean;
  /** Task category */
  taskCategory: string;
}

export interface CrossUserStats {
  averageConfidence: number;
  patternsByCategory: Record<string, number>;
  totalContributions: number;
  totalPatterns: number;
  uniqueOrgContributors: number;
}

// ---------------------------------------------------------------------------
// Anonymization
// ---------------------------------------------------------------------------

/** Regex patterns for common PII/sensitive data */
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const IP_PATTERN = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const URL_PATTERN = /https?:\/\/[^\s"']+/g;
const API_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|auth)\s*[:=]\s*["']?[\w\-./+=]+["']?/gi;
const ORG_NAME_PATTERN =
  /(?:org|organization|company|team)\s*[:=]\s*["']?[\w\s]+["']?/gi;

function anonymize(text: string): string {
  return text
    .replace(EMAIL_PATTERN, "[EMAIL]")
    .replace(IP_PATTERN, "[IP]")
    .replace(API_KEY_PATTERN, "[REDACTED_SECRET]")
    .replace(ORG_NAME_PATTERN, "[ORG]")
    .replace(URL_PATTERN, "[URL]");
}

/**
 * One-way hash for org identifiers so contributions can be deduplicated
 * without revealing the original org.
 */
function hashOrgId(orgId: string): string {
  // Simple non-crypto hash for anonymization (FNV-1a variant)
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < orgId.length; i++) {
    hash ^= orgId.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return `org_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// CrossUserLearner
// ---------------------------------------------------------------------------

export class CrossUserLearner {
  private readonly patterns: AnonymizedPattern[] = [];
  private readonly contributions: PatternContribution[] = [];
  private readonly orgHashes = new Set<string>();

  /**
   * Contribute a pattern from an organization's session.
   * Data is anonymized before storage.
   */
  contribute(
    orgId: string,
    contribution: {
      pattern: string;
      stack: string[];
      success: boolean;
      taskCategory: string;
    }
  ): AnonymizedPattern | null {
    const orgHash = hashOrgId(orgId);
    this.orgHashes.add(orgHash);

    const anonymizedContent = anonymize(contribution.pattern);

    const record: PatternContribution = {
      orgHash,
      rawPattern: anonymizedContent,
      stack: contribution.stack,
      success: contribution.success,
      taskCategory: contribution.taskCategory,
    };

    this.contributions.push(record);

    logger.info(
      {
        orgHash,
        taskCategory: contribution.taskCategory,
        success: contribution.success,
        stackTags: contribution.stack.length,
      },
      "Received cross-user contribution"
    );

    // Try to merge into existing pattern or create new one
    const existing = this.findSimilarPattern(
      anonymizedContent,
      contribution.taskCategory
    );

    if (existing) {
      existing.contributorCount += 1;
      existing.successRate = this.computeSuccessRate(
        existing.category,
        existing.tags
      );
      existing.confidence = Math.min(0.95, existing.contributorCount * 0.15);
      existing.updatedAt = new Date().toISOString();
      return existing;
    }

    // Create new pattern only from successful contributions
    if (!contribution.success) {
      return null;
    }

    const newPattern: AnonymizedPattern = {
      id: generateId("cxp"),
      category: this.inferCategory(contribution.taskCategory),
      tags: contribution.stack,
      description: this.summarize(anonymizedContent),
      content: anonymizedContent,
      confidence: 0.15,
      contributorCount: 1,
      successRate: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.patterns.push(newPattern);

    logger.info(
      { patternId: newPattern.id, category: newPattern.category },
      "Created new cross-user pattern"
    );

    return newPattern;
  }

  /**
   * Query shared patterns relevant to a technology stack and task type.
   */
  queryPatterns(options: {
    stack?: string[];
    category?: AnonymizedPattern["category"];
    minConfidence?: number;
    limit?: number;
  }): AnonymizedPattern[] {
    let results = [...this.patterns];

    if (options.category) {
      results = results.filter((p) => p.category === options.category);
    }

    if (options.minConfidence) {
      results = results.filter(
        (p) => p.confidence >= (options.minConfidence ?? 0)
      );
    }

    if (options.stack && options.stack.length > 0) {
      const stackSet = new Set(options.stack.map((s) => s.toLowerCase()));
      results = results.filter((p) =>
        p.tags.some((t) => stackSet.has(t.toLowerCase()))
      );
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);

    return results.slice(0, options.limit ?? 20);
  }

  /**
   * Get aggregate statistics about the shared knowledge pool.
   */
  getStats(): CrossUserStats {
    const patternsByCategory: Record<string, number> = {};
    let totalConfidence = 0;

    for (const pattern of this.patterns) {
      patternsByCategory[pattern.category] =
        (patternsByCategory[pattern.category] ?? 0) + 1;
      totalConfidence += pattern.confidence;
    }

    return {
      totalPatterns: this.patterns.length,
      totalContributions: this.contributions.length,
      uniqueOrgContributors: this.orgHashes.size,
      patternsByCategory,
      averageConfidence:
        this.patterns.length > 0 ? totalConfidence / this.patterns.length : 0,
    };
  }

  /**
   * Get all patterns (for inspection/testing).
   */
  getPatterns(): readonly AnonymizedPattern[] {
    return this.patterns;
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.patterns.length = 0;
    this.contributions.length = 0;
    this.orgHashes.clear();
    logger.info("Cleared all cross-user learning data");
  }

  // ── Private helpers ──

  private findSimilarPattern(
    content: string,
    taskCategory: string
  ): AnonymizedPattern | null {
    const category = this.inferCategory(taskCategory);
    const contentWords = new Set(content.toLowerCase().split(WHITESPACE_SPLIT));

    for (const pattern of this.patterns) {
      if (pattern.category !== category) {
        continue;
      }

      // Simple word overlap similarity
      const patternWords = new Set(
        pattern.content.toLowerCase().split(WHITESPACE_SPLIT)
      );
      let overlap = 0;
      for (const word of contentWords) {
        if (patternWords.has(word)) {
          overlap += 1;
        }
      }

      const similarity =
        overlap / Math.max(contentWords.size, patternWords.size);
      if (similarity > 0.6) {
        return pattern;
      }
    }

    return null;
  }

  private inferCategory(taskCategory: string): AnonymizedPattern["category"] {
    const lower = taskCategory.toLowerCase();
    if (lower.includes("test")) {
      return "testing";
    }
    if (
      lower.includes("deploy") ||
      lower.includes("ci") ||
      lower.includes("cd")
    ) {
      return "deployment";
    }
    if (lower.includes("perf") || lower.includes("optim")) {
      return "performance";
    }
    if (lower.includes("secur") || lower.includes("auth")) {
      return "security";
    }
    if (lower.includes("arch") || lower.includes("design")) {
      return "architecture";
    }
    return "workflow";
  }

  private summarize(content: string): string {
    // Take first sentence or first 120 chars
    const firstSentence = content.split(SENTENCE_SPLIT)[0] ?? "";
    if (firstSentence.length > 10 && firstSentence.length <= 120) {
      return firstSentence.trim();
    }
    return content.slice(0, 120).trim();
  }

  private computeSuccessRate(category: string, tags: string[]): number {
    const relevant = this.contributions.filter((c) => {
      const cat = this.inferCategory(c.taskCategory);
      if (cat !== category) {
        return false;
      }
      if (tags.length === 0) {
        return true;
      }
      return c.stack.some((s) => tags.includes(s));
    });

    if (relevant.length === 0) {
      return 0;
    }
    const successes = relevant.filter((c) => c.success).length;
    return successes / relevant.length;
  }
}
