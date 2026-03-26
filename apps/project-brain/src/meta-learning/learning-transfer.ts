/**
 * Learning Transfer
 *
 * Transfers high-confidence patterns between similar projects
 * based on language, framework, and project structure similarity.
 * Only transfers patterns with confidence > 0.8.
 */

import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:learning-transfer");

const CONFIDENCE_THRESHOLD = 0.8;

const BRAIN_BASE_URL = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectProfile {
  frameworks: string[];
  languages: string[];
  projectId: string;
  structure: string[];
}

export interface TransferablePattern {
  agentRole: string;
  confidence: number;
  pattern: string;
  sourceProjectId: string;
  taskType: string;
  type: string;
}

interface SimilarityScore {
  frameworkOverlap: number;
  languageOverlap: number;
  projectId: string;
  structureOverlap: number;
  totalScore: number;
}

// ---------------------------------------------------------------------------
// LearningTransfer
// ---------------------------------------------------------------------------

export class LearningTransfer {
  private readonly projectProfiles = new Map<string, ProjectProfile>();
  private readonly patterns = new Map<string, TransferablePattern[]>();

  /**
   * Register a project profile for similarity matching.
   */
  registerProject(profile: ProjectProfile): void {
    this.projectProfiles.set(profile.projectId, profile);
  }

  /**
   * Find projects similar to the given project.
   */
  findSimilarProjects(projectId: string): SimilarityScore[] {
    const source = this.projectProfiles.get(projectId);
    if (!source) {
      return [];
    }

    const scores: SimilarityScore[] = [];

    for (const [candidateId, candidate] of this.projectProfiles) {
      if (candidateId === projectId) {
        continue;
      }

      const langOverlap = this.jaccardSimilarity(
        source.languages,
        candidate.languages
      );
      const fwOverlap = this.jaccardSimilarity(
        source.frameworks,
        candidate.frameworks
      );
      const structOverlap = this.jaccardSimilarity(
        source.structure,
        candidate.structure
      );

      const total = langOverlap * 0.4 + fwOverlap * 0.4 + structOverlap * 0.2;

      if (total > 0.3) {
        scores.push({
          projectId: candidateId,
          languageOverlap: langOverlap,
          frameworkOverlap: fwOverlap,
          structureOverlap: structOverlap,
          totalScore: total,
        });
      }
    }

    return scores.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * Transfer applicable learnings from one project to another.
   * Only transfers patterns with confidence above the threshold.
   */
  async transferLearnings(
    fromProjectId: string,
    toProjectId: string,
    type?: string
  ): Promise<TransferablePattern[]> {
    const sourcePatterns = this.patterns.get(fromProjectId) ?? [];

    const transferable = sourcePatterns.filter(
      (p) => p.confidence >= CONFIDENCE_THRESHOLD && (!type || p.type === type)
    );

    if (transferable.length === 0) {
      logger.info(
        { fromProjectId, toProjectId },
        "No transferable patterns found"
      );
      return [];
    }

    // Persist transferred patterns
    for (const pattern of transferable) {
      try {
        await fetch(`${BRAIN_BASE_URL}/memory/store`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalAuthHeaders(),
          },
          body: JSON.stringify({
            projectId: toProjectId,
            type: "procedural",
            data: {
              patternType: pattern.type,
              agentRole: pattern.agentRole,
              taskType: pattern.taskType,
              decision: `[Transferred from ${fromProjectId}] ${pattern.pattern}`,
              reasoning: `confidence=${pattern.confidence}, transferred`,
              outcome: "transferred",
            },
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { error: msg, pattern: pattern.pattern.slice(0, 50) },
          "Failed to persist transferred pattern"
        );
      }
    }

    logger.info(
      {
        fromProjectId,
        toProjectId,
        transferred: transferable.length,
      },
      "Learning transfer complete"
    );

    return transferable;
  }

  /**
   * Get patterns from a project that are transferable to other projects.
   */
  getTransferablePatterns(projectId: string): TransferablePattern[] {
    const allPatterns = this.patterns.get(projectId) ?? [];
    return allPatterns.filter((p) => p.confidence >= CONFIDENCE_THRESHOLD);
  }

  /**
   * Store a pattern for a project.
   */
  addPattern(projectId: string, pattern: TransferablePattern): void {
    if (!this.patterns.has(projectId)) {
      this.patterns.set(projectId, []);
    }
    (this.patterns.get(projectId) as TransferablePattern[]).push(pattern);
  }

  // -----------------------------------------------------------------------
  // Internal Helpers
  // -----------------------------------------------------------------------

  private jaccardSimilarity(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) {
      return 0;
    }

    const setA = new Set(a.map((s) => s.toLowerCase()));
    const setB = new Set(b.map((s) => s.toLowerCase()));

    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) {
        intersection++;
      }
    }

    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
  }
}
