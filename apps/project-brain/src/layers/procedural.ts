/**
 * Procedural Memory Layer - Phase 9.7 Enhanced with Cross-Session Learning.
 *
 * Enhancements:
 *  - Extract successful approaches as procedural memory
 *  - Similarity matching for tasks (find relevant procedures by task description)
 *  - Learning rate decay (new learnings have high weight, older ones decay)
 *  - Success/failure tracking with effectiveness scoring
 *  - Task-to-procedure mapping for automatic procedure suggestion
 */
import { db, proceduralMemories } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";

const logger = createLogger("project-brain:procedural");

const WHITESPACE_RE = /\s+/;

/** Half-life for learning rate decay in days. */
const LEARNING_DECAY_HALF_LIFE_DAYS = 60;

/** Minimum effectiveness score before a procedure is considered unreliable. */
const MIN_EFFECTIVENESS = 0.2;

export interface Procedure {
  description: string;
  id: string;
  lastUsed: Date | null;
  name: string;
  projectId: string;
  steps: string[];
}

export interface EnhancedProcedure extends Procedure {
  /** Effectiveness score (0-1), decayed over time. */
  effectiveness: number;
  /** Number of times this procedure was used and failed. */
  failureCount: number;
  /** When the procedure was first learned. */
  learnedAt: Date;
  /** Number of times this procedure was used successfully. */
  successCount: number;
  /** Tags for categorization. */
  tags: string[];
  /** Task patterns that matched this procedure. */
  taskPatterns: string[];
}

/**
 * Metadata stored in the JSONB steps field alongside actual steps.
 * We store extended metadata as a special entry at the end of the steps array.
 */
interface ProcedureMetadata {
  __meta: true;
  description: string;
  failureCount: number;
  learnedAt: string;
  successCount: number;
  tags: string[];
  taskPatterns: string[];
}

export class ProceduralLayer {
  // ─── Core CRUD ───────────────────────────────────────────────────

  async store(
    projectId: string,
    data: {
      name: string;
      description: string;
      steps: string[];
      tags?: string[];
      taskPattern?: string;
    }
  ): Promise<Procedure> {
    // Upsert: check if a procedure with this name already exists
    const existing = await db
      .select()
      .from(proceduralMemories)
      .where(
        and(
          eq(proceduralMemories.projectId, projectId),
          eq(proceduralMemories.procedureName, data.name)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const record = existing[0] as (typeof existing)[0];
      const prevMeta = this.extractMetadata(record.steps as string[]);

      // Merge new task pattern with existing patterns
      const taskPatterns = prevMeta?.taskPatterns ?? [];
      if (data.taskPattern && !taskPatterns.includes(data.taskPattern)) {
        taskPatterns.push(data.taskPattern);
      }

      const metadata: ProcedureMetadata = {
        __meta: true,
        description: data.description,
        successCount: prevMeta?.successCount ?? 0,
        failureCount: prevMeta?.failureCount ?? 0,
        tags: data.tags ?? prevMeta?.tags ?? [],
        taskPatterns,
        learnedAt: prevMeta?.learnedAt ?? new Date().toISOString(),
      };

      const steps = [...data.steps, JSON.stringify(metadata)];

      await db
        .update(proceduralMemories)
        .set({
          steps,
          lastUsed: new Date(),
        })
        .where(eq(proceduralMemories.id, record.id));

      logger.debug({ projectId, procedure: data.name }, "Procedure updated");
      return {
        id: record.id,
        projectId,
        name: data.name,
        description: data.description,
        steps: data.steps,
        lastUsed: new Date(),
      };
    }

    const id = generateId("proc");
    const metadata: ProcedureMetadata = {
      __meta: true,
      description: data.description,
      successCount: 0,
      failureCount: 0,
      tags: data.tags ?? [],
      taskPatterns: data.taskPattern ? [data.taskPattern] : [],
      learnedAt: new Date().toISOString(),
    };

    const steps = [...data.steps, JSON.stringify(metadata)];

    await db.insert(proceduralMemories).values({
      id,
      projectId,
      procedureName: data.name,
      steps,
      lastUsed: new Date(),
    });

    logger.debug({ projectId, procedure: data.name }, "Procedure stored");
    return {
      id,
      projectId,
      name: data.name,
      description: data.description,
      steps: data.steps,
      lastUsed: new Date(),
    };
  }

  async get(projectId: string, name: string): Promise<Procedure | null> {
    const results = await db
      .select()
      .from(proceduralMemories)
      .where(
        and(
          eq(proceduralMemories.projectId, projectId),
          eq(proceduralMemories.procedureName, name)
        )
      )
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    const r = results[0] as (typeof results)[0];
    const { steps, metadata } = this.separateMetadata(r.steps as string[]);

    return {
      id: r.id,
      projectId: r.projectId,
      name: r.procedureName,
      description: metadata?.description ?? r.procedureName,
      steps,
      lastUsed: r.lastUsed,
    };
  }

  async list(projectId: string): Promise<Procedure[]> {
    const results = await db
      .select()
      .from(proceduralMemories)
      .where(eq(proceduralMemories.projectId, projectId));

    return results.map((r) => {
      const { steps, metadata } = this.separateMetadata(r.steps as string[]);
      return {
        id: r.id,
        projectId: r.projectId,
        name: r.procedureName,
        description: metadata?.description ?? r.procedureName,
        steps,
        lastUsed: r.lastUsed,
      };
    });
  }

  async recordSuccess(projectId: string, name: string): Promise<void> {
    const results = await db
      .select()
      .from(proceduralMemories)
      .where(
        and(
          eq(proceduralMemories.projectId, projectId),
          eq(proceduralMemories.procedureName, name)
        )
      )
      .limit(1);

    if (results.length === 0) {
      return;
    }

    const record = results[0] as (typeof results)[0];
    const allSteps = record.steps as string[];
    const meta = this.extractMetadata(allSteps);

    if (meta) {
      meta.successCount += 1;
      // Replace the metadata entry
      allSteps[allSteps.length - 1] = JSON.stringify(meta);
    }

    await db
      .update(proceduralMemories)
      .set({
        steps: allSteps,
        lastUsed: new Date(),
      })
      .where(eq(proceduralMemories.id, record.id));

    logger.debug({ projectId, procedure: name }, "Procedure success recorded");
  }

  // ─── Phase 9.7: Cross-Session Learning ───────────────────────────

  /**
   * Record a failure for a procedure, decreasing its effectiveness score.
   */
  async recordFailure(projectId: string, name: string): Promise<void> {
    const results = await db
      .select()
      .from(proceduralMemories)
      .where(
        and(
          eq(proceduralMemories.projectId, projectId),
          eq(proceduralMemories.procedureName, name)
        )
      )
      .limit(1);

    if (results.length === 0) {
      return;
    }

    const record = results[0] as (typeof results)[0];
    const allSteps = record.steps as string[];
    const meta = this.extractMetadata(allSteps);

    if (meta) {
      meta.failureCount += 1;
      allSteps[allSteps.length - 1] = JSON.stringify(meta);
    }

    await db
      .update(proceduralMemories)
      .set({ steps: allSteps })
      .where(eq(proceduralMemories.id, record.id));

    logger.debug({ projectId, procedure: name }, "Procedure failure recorded");
  }

  /**
   * Find procedures that match a task description by similarity.
   * Uses keyword matching against stored task patterns and procedure names/descriptions.
   */
  async findRelevantProcedures(
    projectId: string,
    taskDescription: string,
    limit = 5
  ): Promise<EnhancedProcedure[]> {
    const allProcedures = await db
      .select()
      .from(proceduralMemories)
      .where(eq(proceduralMemories.projectId, projectId));

    const now = new Date();
    const scored: Array<EnhancedProcedure & { relevanceScore: number }> = [];

    const taskLower = taskDescription.toLowerCase();
    const taskWords = taskLower
      .split(WHITESPACE_RE)
      .filter((w) => w.length > 3);

    for (const record of allProcedures) {
      const allSteps = record.steps as string[];
      const { steps, metadata } = this.separateMetadata(allSteps);

      // Calculate relevance score
      let relevance = 0;

      // Match against procedure name
      const nameLower = record.procedureName.toLowerCase();
      for (const word of taskWords) {
        if (nameLower.includes(word)) {
          relevance += 0.3;
        }
      }

      // Match against description
      if (metadata?.description) {
        const descLower = metadata.description.toLowerCase();
        for (const word of taskWords) {
          if (descLower.includes(word)) {
            relevance += 0.2;
          }
        }
      }

      // Match against task patterns
      if (metadata?.taskPatterns) {
        for (const pattern of metadata.taskPatterns) {
          const patternLower = pattern.toLowerCase();
          for (const word of taskWords) {
            if (patternLower.includes(word)) {
              relevance += 0.4;
            }
          }

          // Exact or near-exact pattern match gets a big boost
          if (this.calculateSimilarity(patternLower, taskLower) > 0.6) {
            relevance += 1.0;
          }
        }
      }

      if (relevance <= 0) {
        continue;
      }

      // Calculate effectiveness with decay
      const effectiveness = this.calculateEffectiveness(metadata, now);

      // Scale relevance by effectiveness
      const finalRelevance = relevance * (0.5 + 0.5 * effectiveness);

      scored.push({
        id: record.id,
        projectId: record.projectId,
        name: record.procedureName,
        description: metadata?.description ?? record.procedureName,
        steps,
        lastUsed: record.lastUsed,
        successCount: metadata?.successCount ?? 0,
        failureCount: metadata?.failureCount ?? 0,
        effectiveness,
        tags: metadata?.tags ?? [],
        taskPatterns: metadata?.taskPatterns ?? [],
        learnedAt: metadata?.learnedAt
          ? new Date(metadata.learnedAt)
          : new Date(),
        relevanceScore: finalRelevance,
      });
    }

    // Sort by relevance score, descending
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return scored.slice(0, limit);
  }

  /**
   * Extract a successful approach from a completed task and store it
   * as a new procedural memory.
   */
  async learnFromSuccess(
    projectId: string,
    data: {
      taskDescription: string;
      stepsPerformed: string[];
      toolsUsed: string[];
      filesChanged: string[];
      agentRole: string;
    }
  ): Promise<Procedure> {
    // Create a descriptive name from the task
    const name = this.generateProcedureName(
      data.taskDescription,
      data.agentRole
    );

    // Build steps including tool information
    const steps = [`Agent role: ${data.agentRole}`, ...data.stepsPerformed];

    if (data.toolsUsed.length > 0) {
      steps.push(`Tools used: ${data.toolsUsed.join(", ")}`);
    }
    if (data.filesChanged.length > 0) {
      steps.push(`Files changed: ${data.filesChanged.join(", ")}`);
    }

    const procedure = await this.store(projectId, {
      name,
      description: data.taskDescription,
      steps,
      tags: [data.agentRole, "auto-learned"],
      taskPattern: data.taskDescription,
    });

    // Record initial success
    await this.recordSuccess(projectId, name);

    logger.info(
      { projectId, procedure: name, stepsCount: steps.length },
      "Procedure learned from successful task"
    );

    return procedure;
  }

  /**
   * Get the most effective procedures for a project, ranked by
   * effectiveness score with decay applied.
   */
  async getTopProcedures(
    projectId: string,
    limit = 10
  ): Promise<EnhancedProcedure[]> {
    const all = await db
      .select()
      .from(proceduralMemories)
      .where(eq(proceduralMemories.projectId, projectId));

    const now = new Date();
    const enhanced: Array<EnhancedProcedure & { _sortScore: number }> = [];

    for (const record of all) {
      const allSteps = record.steps as string[];
      const { steps, metadata } = this.separateMetadata(allSteps);
      const effectiveness = this.calculateEffectiveness(metadata, now);

      if (effectiveness < MIN_EFFECTIVENESS) {
        continue;
      }

      enhanced.push({
        id: record.id,
        projectId: record.projectId,
        name: record.procedureName,
        description: metadata?.description ?? record.procedureName,
        steps,
        lastUsed: record.lastUsed,
        successCount: metadata?.successCount ?? 0,
        failureCount: metadata?.failureCount ?? 0,
        effectiveness,
        tags: metadata?.tags ?? [],
        taskPatterns: metadata?.taskPatterns ?? [],
        learnedAt: metadata?.learnedAt
          ? new Date(metadata.learnedAt)
          : new Date(),
        _sortScore: effectiveness,
      });
    }

    enhanced.sort((a, b) => b._sortScore - a._sortScore);
    return enhanced.slice(0, limit);
  }

  /**
   * Prune ineffective procedures (low effectiveness after decay).
   */
  async pruneIneffective(projectId: string): Promise<number> {
    const all = await db
      .select()
      .from(proceduralMemories)
      .where(eq(proceduralMemories.projectId, projectId));

    const now = new Date();
    let pruned = 0;

    for (const record of all) {
      const meta = this.extractMetadata(record.steps as string[]);
      const effectiveness = this.calculateEffectiveness(meta, now);

      // Only prune auto-learned procedures with low effectiveness
      if (
        effectiveness < MIN_EFFECTIVENESS &&
        meta?.tags?.includes("auto-learned")
      ) {
        await db
          .delete(proceduralMemories)
          .where(eq(proceduralMemories.id, record.id));
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.info({ projectId, pruned }, "Pruned ineffective procedures");
    }
    return pruned;
  }

  // ─── Extract from Config (unchanged) ─────────────────────────────

  async extractFromConfig(
    projectId: string,
    packageJson: Record<string, unknown>
  ): Promise<void> {
    const scripts = packageJson.scripts as Record<string, string> | undefined;
    if (!scripts) {
      return;
    }

    for (const [name, command] of Object.entries(scripts)) {
      await this.store(projectId, {
        name: `run:${name}`,
        description: `Run ${name} script`,
        steps: [`pnpm ${name}`, `Command: ${command}`],
        tags: ["config", "script"],
      });
    }

    logger.info(
      { projectId, scriptCount: Object.keys(scripts).length },
      "Procedures extracted from package.json"
    );
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  /**
   * Extract metadata from the steps array (last element if it's JSON with __meta).
   */
  private extractMetadata(steps: string[]): ProcedureMetadata | null {
    if (steps.length === 0) {
      return null;
    }
    const last = steps.at(-1);
    if (!last) {
      return null;
    }

    try {
      const parsed = JSON.parse(last);
      if (parsed.__meta === true) {
        return parsed as ProcedureMetadata;
      }
    } catch {
      // Not metadata
    }
    return null;
  }

  /**
   * Separate metadata from actual steps.
   */
  private separateMetadata(allSteps: string[]): {
    steps: string[];
    metadata: ProcedureMetadata | null;
  } {
    if (allSteps.length === 0) {
      return { steps: [], metadata: null };
    }

    const meta = this.extractMetadata(allSteps);
    if (meta) {
      return { steps: allSteps.slice(0, -1), metadata: meta };
    }
    return { steps: allSteps, metadata: null };
  }

  /**
   * Calculate effectiveness score with learning rate decay.
   * Recently used/learned procedures score higher.
   */
  private calculateEffectiveness(
    metadata: ProcedureMetadata | null,
    now: Date
  ): number {
    if (!metadata) {
      return 0.5; // Unknown effectiveness
    }

    const { successCount, failureCount, learnedAt } = metadata;
    const totalAttempts = successCount + failureCount;

    // Base effectiveness from success rate
    let baseEffectiveness: number;
    if (totalAttempts === 0) {
      baseEffectiveness = 0.5; // Unknown, neutral
    } else {
      // Wilson score interval lower bound for confidence-adjusted rate
      const successRate = successCount / totalAttempts;
      const z = 1.96; // 95% confidence
      const denominator = 1 + (z * z) / totalAttempts;
      const center = successRate + (z * z) / (2 * totalAttempts);
      const spread =
        z *
        Math.sqrt(
          (successRate * (1 - successRate) + (z * z) / (4 * totalAttempts)) /
            totalAttempts
        );
      baseEffectiveness = (center - spread) / denominator;
    }

    // Apply learning rate decay
    const learnedDate = new Date(learnedAt);
    const ageDays =
      (now.getTime() - learnedDate.getTime()) / (1000 * 60 * 60 * 24);
    const decayFactor = 0.5 ** (ageDays / LEARNING_DECAY_HALF_LIFE_DAYS);

    // Usage recency boost
    const recencyBoost =
      totalAttempts > 0 ? Math.min(totalAttempts * 0.02, 0.2) : 0;

    return Math.max(
      0,
      Math.min(1, baseEffectiveness * decayFactor + recencyBoost)
    );
  }

  /**
   * Simple word-overlap similarity between two strings.
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(WHITESPACE_RE).filter((w) => w.length > 2));
    const wordsB = new Set(b.split(WHITESPACE_RE).filter((w) => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) {
      return 0;
    }

    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) {
        overlap++;
      }
    }

    return (2 * overlap) / (wordsA.size + wordsB.size);
  }

  /**
   * Generate a descriptive procedure name from a task description.
   */
  private generateProcedureName(
    taskDescription: string,
    agentRole: string
  ): string {
    // Take the first ~50 chars and clean up
    const cleaned = taskDescription
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50)
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();

    return `${agentRole}:${cleaned || "task"}-${Date.now().toString(36)}`;
  }
}
