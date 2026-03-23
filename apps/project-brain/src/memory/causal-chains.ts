/**
 * Phase 7.13: Episodic Causal Chains.
 *
 * Links episodic memories in decision -> outcome chains
 * using a parentId relationship. Enables retrieval of full
 * causal chains for richer context.
 */
import { db, episodicMemories } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { desc, eq } from "drizzle-orm";

const logger = createLogger("project-brain:causal-chains");

export interface EpisodicMemory {
  createdAt: Date;
  decision: string;
  eventType: string;
  id: string;
  outcome: string | null;
  parentId: string | null;
  projectId: string;
  reasoning: string | null;
}

const CHAIN_PREFIX_RE = /^\[chain:([^\]]+)\]/;

/**
 * CausalChainManager links episodic memories into
 * decision -> outcome causal chains.
 */
export class CausalChainManager {
  /**
   * Add a new memory as a child in an existing causal chain.
   */
  async addToChain(
    parentId: string,
    memory: {
      projectId: string;
      eventType: string;
      decision: string;
      reasoning?: string;
      outcome?: string;
    }
  ): Promise<EpisodicMemory> {
    // Verify parent exists
    const parent = await db
      .select({
        id: episodicMemories.id,
        projectId: episodicMemories.projectId,
      })
      .from(episodicMemories)
      .where(eq(episodicMemories.id, parentId))
      .limit(1);

    if (parent.length === 0) {
      throw new Error(`Parent memory ${parentId} not found`);
    }

    const id = generateId("ep");

    const [inserted] = await db
      .insert(episodicMemories)
      .values({
        id,
        projectId: memory.projectId,
        eventType: memory.eventType,
        decision: `[chain:${parentId}] ${memory.decision}`,
        reasoning: memory.reasoning ?? null,
        outcome: memory.outcome ?? null,
      })
      .returning();

    const record = inserted as NonNullable<typeof inserted>;

    logger.debug(
      { parentId, childId: id, projectId: memory.projectId },
      "Added memory to causal chain"
    );

    return {
      id: record.id,
      projectId: record.projectId,
      eventType: record.eventType,
      decision: record.decision,
      reasoning: record.reasoning,
      outcome: record.outcome,
      parentId,
      createdAt: record.createdAt,
    };
  }

  /**
   * Retrieve the full causal chain starting from a given memory.
   * Walks both up (to root) and down (to leaves) from the specified memory.
   */
  async getChain(memoryId: string): Promise<EpisodicMemory[]> {
    const chain: EpisodicMemory[] = [];
    const visited = new Set<string>();

    // Get the starting memory
    const startRows = await db
      .select()
      .from(episodicMemories)
      .where(eq(episodicMemories.id, memoryId))
      .limit(1);

    if (startRows.length === 0) {
      return chain;
    }

    const startMemory = startRows[0] as (typeof startRows)[0];

    // Walk up to find root
    const parentId = this.findParentId(startMemory.decision);
    if (parentId) {
      const ancestors = await this.walkUp(parentId, visited);
      chain.push(...ancestors);
    }

    // Add current memory
    visited.add(memoryId);
    chain.push({
      id: startMemory.id,
      projectId: startMemory.projectId,
      eventType: startMemory.eventType,
      decision: startMemory.decision,
      reasoning: startMemory.reasoning,
      outcome: startMemory.outcome,
      parentId,
      createdAt: startMemory.createdAt,
    });

    // Walk down to find children
    const children = await this.walkDown(
      memoryId,
      startMemory.projectId,
      visited
    );
    chain.push(...children);

    logger.debug(
      { memoryId, chainLength: chain.length },
      "Retrieved causal chain"
    );

    return chain;
  }

  /**
   * Get all root memories (memories without parents) for a project.
   * These are the starting points of causal chains.
   */
  async getRoots(projectId: string, limit = 20): Promise<EpisodicMemory[]> {
    const rows = await db
      .select()
      .from(episodicMemories)
      .where(eq(episodicMemories.projectId, projectId))
      .orderBy(desc(episodicMemories.createdAt))
      .limit(limit * 3);

    return rows
      .filter((r) => !this.findParentId(r.decision))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        projectId: r.projectId,
        eventType: r.eventType,
        decision: r.decision,
        reasoning: r.reasoning,
        outcome: r.outcome,
        parentId: null,
        createdAt: r.createdAt,
      }));
  }

  private async walkUp(
    memoryId: string,
    visited: Set<string>
  ): Promise<EpisodicMemory[]> {
    const ancestors: EpisodicMemory[] = [];

    if (visited.has(memoryId)) {
      return ancestors;
    }

    const rows = await db
      .select()
      .from(episodicMemories)
      .where(eq(episodicMemories.id, memoryId))
      .limit(1);

    if (rows.length === 0) {
      return ancestors;
    }

    const mem = rows[0] as (typeof rows)[0];
    visited.add(memoryId);

    const parentId = this.findParentId(mem.decision);
    if (parentId && !visited.has(parentId)) {
      const upper = await this.walkUp(parentId, visited);
      ancestors.push(...upper);
    }

    ancestors.push({
      id: mem.id,
      projectId: mem.projectId,
      eventType: mem.eventType,
      decision: mem.decision,
      reasoning: mem.reasoning,
      outcome: mem.outcome,
      parentId,
      createdAt: mem.createdAt,
    });

    return ancestors;
  }

  private async walkDown(
    parentId: string,
    projectId: string,
    visited: Set<string>
  ): Promise<EpisodicMemory[]> {
    const children: EpisodicMemory[] = [];

    const rows = await db
      .select()
      .from(episodicMemories)
      .where(eq(episodicMemories.projectId, projectId))
      .orderBy(episodicMemories.createdAt)
      .limit(100);

    const childRows = rows.filter(
      (r) => this.findParentId(r.decision) === parentId && !visited.has(r.id)
    );

    for (const child of childRows) {
      visited.add(child.id);
      children.push({
        id: child.id,
        projectId: child.projectId,
        eventType: child.eventType,
        decision: child.decision,
        reasoning: child.reasoning,
        outcome: child.outcome,
        parentId,
        createdAt: child.createdAt,
      });

      const grandchildren = await this.walkDown(child.id, projectId, visited);
      children.push(...grandchildren);
    }

    return children;
  }

  private findParentId(decision: string): string | null {
    const match = CHAIN_PREFIX_RE.exec(decision);
    return match?.[1] ?? null;
  }
}
