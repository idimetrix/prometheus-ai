/**
 * MOON-059: Cross-Session Learning Transfer
 *
 * Extracts learnings (patterns, conventions, pitfalls, preferences)
 * from completed sessions and transfers them to future sessions
 * on the same project. Tracks learning effectiveness over time
 * and provides project-level learning aggregation.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("project-brain:learning:cross-session-transfer");

const SENTENCE_SPLIT_RE = /[.!?\n]+/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LearningType = "pattern" | "convention" | "pitfall" | "preference";

export interface SessionLearning {
  /** Confidence in this learning (0-1) */
  confidence: number;
  /** What context this learning applies to */
  context: string;
  /** Description of what was learned */
  description: string;
  /** Unique identifier */
  id: string;
  /** When this learning was extracted */
  timestamp: string;
  /** Category of learning */
  type: LearningType;
}

export interface AppliedLearning {
  /** How the learning was applied in the new session */
  appliedAs: string;
  /** Description of the learning */
  description: string;
}

export interface ApplyResult {
  /** Number of learnings successfully applied */
  applied: number;
  /** Details of each applied learning */
  learnings: AppliedLearning[];
}

export interface ProjectLearning {
  /** Effectiveness measured by reuse frequency and positive outcomes (0-1) */
  effectivenessScore: number;
  /** How often this learning has been used */
  frequency: number;
  /** When the learning was last applied */
  lastUsed: Date;
  /** The learning description */
  learning: string;
}

// ---------------------------------------------------------------------------
// Internal storage types
// ---------------------------------------------------------------------------

interface StoredLearning {
  appliedCount: number;
  confidence: number;
  context: string;
  description: string;
  id: string;
  lastApplied: Date | null;
  positiveOutcomes: number;
  projectId: string;
  sessionId: string;
  timestamp: string;
  type: LearningType;
}

// ---------------------------------------------------------------------------
// Learning extraction patterns
// ---------------------------------------------------------------------------

const PATTERN_INDICATORS = [
  /\b(always|consistently|every time)\s+(?:use|apply|follow)\b/i,
  /\b(pattern|approach|technique|method)\s+(?:that|which)\s+works\b/i,
  /\b(best practice|recommended|standard)\b/i,
];

const CONVENTION_INDICATORS = [
  /\b(naming|convention|format|style|structure)\b/i,
  /\b(prefix|suffix|camelCase|PascalCase|kebab-case|snake_case)\b/i,
  /\b(file|folder|directory)\s+(structure|organization|layout)\b/i,
];

const PITFALL_INDICATORS = [
  /\b(avoid|don't|do not|never|warning|careful|gotcha)\b/i,
  /\b(bug|issue|problem|error)\s+(with|when|if|caused)\b/i,
  /\b(breaks|fails|crashes)\s+(when|if)\b/i,
];

const PREFERENCE_INDICATORS = [
  /\b(prefer|rather|instead of|use .+ over)\b/i,
  /\b(like|want|choose|opt for)\b/i,
  /\b(configured|set up|setup)\s+(to|with|as)\b/i,
];

// ---------------------------------------------------------------------------
// CrossSessionTransfer
// ---------------------------------------------------------------------------

export class CrossSessionTransfer {
  /** In-memory store keyed by projectId -> learnings */
  private readonly learningStore = new Map<string, StoredLearning[]>();

  /**
   * Extract learnings from a completed session by analyzing
   * the session's output/conversation for patterns, conventions,
   * pitfalls, and preferences.
   */
  extractLearnings(
    sessionId: string,
    sessionContent?: string
  ): SessionLearning[] {
    logger.info({ sessionId }, "Extracting learnings from session");

    const learnings: SessionLearning[] = [];
    const content = sessionContent ?? "";

    // Extract different types of learnings
    const patternLearnings = this.extractByType(
      content,
      "pattern",
      PATTERN_INDICATORS
    );
    const conventionLearnings = this.extractByType(
      content,
      "convention",
      CONVENTION_INDICATORS
    );
    const pitfallLearnings = this.extractByType(
      content,
      "pitfall",
      PITFALL_INDICATORS
    );
    const preferenceLearnings = this.extractByType(
      content,
      "preference",
      PREFERENCE_INDICATORS
    );

    for (const learning of [
      ...patternLearnings,
      ...conventionLearnings,
      ...pitfallLearnings,
      ...preferenceLearnings,
    ]) {
      learnings.push(learning);
    }

    logger.info(
      { sessionId, learningCount: learnings.length },
      "Learning extraction complete"
    );

    return learnings;
  }

  /**
   * Apply relevant learnings from previous sessions to a new session.
   * Returns the learnings that were applied and how.
   */
  applyLearnings(sessionId: string, projectId: string): ApplyResult {
    logger.info({ sessionId, projectId }, "Applying learnings to session");

    const projectLearnings = this.learningStore.get(projectId) ?? [];

    // Filter to high-confidence learnings
    const applicable = projectLearnings.filter((l) => l.confidence >= 0.5);

    // Sort by confidence * effectiveness
    const sorted = [...applicable].sort((a, b) => {
      const scoreA =
        a.confidence *
        (a.appliedCount > 0 ? a.positiveOutcomes / a.appliedCount : 0.5);
      const scoreB =
        b.confidence *
        (b.appliedCount > 0 ? b.positiveOutcomes / b.appliedCount : 0.5);
      return scoreB - scoreA;
    });

    // Apply top learnings (max 20)
    const applied: AppliedLearning[] = [];

    for (const learning of sorted.slice(0, 20)) {
      const appliedAs = this.describeApplication(learning);
      applied.push({
        description: learning.description,
        appliedAs,
      });

      // Update tracking
      learning.appliedCount++;
      learning.lastApplied = new Date();
    }

    logger.info(
      { sessionId, projectId, appliedCount: applied.length },
      "Learnings applied"
    );

    return { applied: applied.length, learnings: applied };
  }

  /**
   * Get aggregated learnings for a project, including frequency
   * and effectiveness scores.
   */
  getProjectLearnings(projectId: string): ProjectLearning[] {
    const stored = this.learningStore.get(projectId) ?? [];

    return stored.map((learning) => {
      const effectivenessScore =
        learning.appliedCount > 0
          ? learning.positiveOutcomes / learning.appliedCount
          : 0;

      return {
        learning: learning.description,
        frequency: learning.appliedCount,
        lastUsed: learning.lastApplied ?? new Date(learning.timestamp),
        effectivenessScore,
      };
    });
  }

  /**
   * Store extracted learnings for a project.
   */
  storeLearnings(
    projectId: string,
    sessionId: string,
    learnings: SessionLearning[]
  ): void {
    const existing = this.learningStore.get(projectId) ?? [];

    for (const learning of learnings) {
      // Check for duplicate descriptions
      const isDuplicate = existing.some(
        (e) =>
          e.description.toLowerCase() === learning.description.toLowerCase()
      );

      if (isDuplicate) {
        // Boost confidence of existing learning
        const match = existing.find(
          (e) =>
            e.description.toLowerCase() === learning.description.toLowerCase()
        );
        if (match) {
          match.confidence = Math.min(1, match.confidence + 0.1);
        }
        continue;
      }

      existing.push({
        id: learning.id,
        sessionId,
        projectId,
        type: learning.type,
        description: learning.description,
        context: learning.context,
        confidence: learning.confidence,
        timestamp: learning.timestamp,
        appliedCount: 0,
        positiveOutcomes: 0,
        lastApplied: null,
      });
    }

    this.learningStore.set(projectId, existing);

    logger.debug(
      { projectId, stored: learnings.length, total: existing.length },
      "Learnings stored"
    );
  }

  /**
   * Record that a learning was successfully applied (positive outcome).
   */
  recordOutcome(
    projectId: string,
    learningId: string,
    positive: boolean
  ): void {
    const learnings = this.learningStore.get(projectId) ?? [];
    const learning = learnings.find((l) => l.id === learningId);

    if (learning && positive) {
      learning.positiveOutcomes++;
      learning.confidence = Math.min(1, learning.confidence + 0.05);
    } else if (learning) {
      learning.confidence = Math.max(0, learning.confidence - 0.05);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private extractByType(
    content: string,
    type: LearningType,
    indicators: RegExp[]
  ): SessionLearning[] {
    if (!content || content.length === 0) {
      return [];
    }

    const learnings: SessionLearning[] = [];
    const sentences = content
      .split(SENTENCE_SPLIT_RE)
      .filter((s) => s.trim().length > 10);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      const matchCount = indicators.filter((pattern) =>
        pattern.test(trimmed)
      ).length;

      if (matchCount === 0) {
        continue;
      }

      // Confidence based on how many indicator patterns matched
      const confidence = Math.min(0.5 + matchCount * 0.15, 0.95);

      learnings.push({
        id: generateId(`learning-${type}`),
        type,
        description: trimmed.slice(0, 200),
        context: this.extractContext(content, trimmed),
        confidence,
        timestamp: new Date().toISOString(),
      });
    }

    // Deduplicate and take top 5 per type
    return this.deduplicateLearnings(learnings).slice(0, 5);
  }

  private extractContext(fullContent: string, sentence: string): string {
    const idx = fullContent.indexOf(sentence);
    if (idx === -1) {
      return "";
    }

    const start = Math.max(0, idx - 100);
    const end = Math.min(fullContent.length, idx + sentence.length + 100);
    return fullContent.slice(start, end).trim();
  }

  private deduplicateLearnings(
    learnings: SessionLearning[]
  ): SessionLearning[] {
    const seen = new Set<string>();
    const unique: SessionLearning[] = [];

    for (const learning of learnings) {
      const key = learning.description.toLowerCase().slice(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(learning);
      }
    }

    return unique;
  }

  private describeApplication(learning: StoredLearning): string {
    switch (learning.type) {
      case "pattern":
        return `Applied pattern: ${learning.description.slice(0, 80)}`;
      case "convention":
        return `Following convention: ${learning.description.slice(0, 80)}`;
      case "pitfall":
        return `Avoiding known pitfall: ${learning.description.slice(0, 80)}`;
      case "preference":
        return `Respecting preference: ${learning.description.slice(0, 80)}`;
      default:
        return `Applied learning: ${learning.description.slice(0, 80)}`;
    }
  }
}
