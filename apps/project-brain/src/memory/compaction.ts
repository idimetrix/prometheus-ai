/**
 * Phase 7.11: Memory Compaction.
 *
 * Merges near-duplicate memories (cosine similarity > 0.95)
 * and compacts episodic memories into generalized rules.
 * Designed to run as a nightly BullMQ job.
 */
import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, sql } from "drizzle-orm";

const logger = createLogger("project-brain:memory-compaction");

const DUPLICATE_THRESHOLD = 0.95;
const WHITESPACE_RE = /\s+/;

export interface CompactionResult {
  duplicatesMerged: number;
  episodicCompacted: number;
  totalProcessed: number;
}

/**
 * MemoryCompactor merges near-duplicate memories and compacts
 * episodic sequences into generalized rules.
 */
export class MemoryCompactor {
  /**
   * Run compaction for a project.
   * 1. Find and merge near-duplicate memories (cosine > 0.95)
   * 2. Compact episodic sequences into rules
   */
  async compact(projectId: string): Promise<CompactionResult> {
    let duplicatesMerged = 0;
    let episodicCompacted = 0;

    // Step 1: Find near-duplicate memories using vector similarity
    const memories = await db
      .select({
        id: agentMemories.id,
        content: agentMemories.content,
        memoryType: agentMemories.memoryType,
        createdAt: agentMemories.createdAt,
      })
      .from(agentMemories)
      .where(eq(agentMemories.projectId, projectId));

    const totalProcessed = memories.length;

    if (memories.length < 2) {
      return { duplicatesMerged: 0, episodicCompacted: 0, totalProcessed };
    }

    // Find duplicates by comparing each memory against others using pgvector
    const toDelete = new Set<string>();

    for (const mem of memories) {
      if (toDelete.has(mem.id)) {
        continue;
      }

      // Find similar memories using vector search
      try {
        const similar = await db
          .select({
            id: agentMemories.id,
            content: agentMemories.content,
            similarity: sql<number>`1 - (${agentMemories.embedding} <=> (
              SELECT embedding FROM agent_memories WHERE id = ${mem.id}
            ))`,
          })
          .from(agentMemories)
          .where(
            and(
              eq(agentMemories.projectId, projectId),
              sql`${agentMemories.id} != ${mem.id}`,
              sql`${agentMemories.embedding} IS NOT NULL`
            )
          )
          .orderBy(
            sql`${agentMemories.embedding} <=> (
              SELECT embedding FROM agent_memories WHERE id = ${mem.id}
            )`
          )
          .limit(5);

        for (const dup of similar) {
          if (
            dup.similarity >= DUPLICATE_THRESHOLD &&
            !toDelete.has(dup.id) &&
            !toDelete.has(mem.id)
          ) {
            // Keep the original (older), mark duplicate for deletion
            toDelete.add(dup.id);
            duplicatesMerged++;
          }
        }
      } catch {
        // Vector search not available, skip duplicate detection
        break;
      }
    }

    // Delete duplicates
    for (const id of toDelete) {
      await db.delete(agentMemories).where(eq(agentMemories.id, id));
    }

    // Step 2: Compact episodic memories into generalized rules
    const episodicMemories = memories.filter(
      (m) => m.memoryType === "episodic" && !toDelete.has(m.id)
    );

    if (episodicMemories.length >= 5) {
      // Group similar episodic memories and create summary rules
      const groups = this.groupByContentSimilarity(episodicMemories);

      for (const group of groups) {
        if (group.length >= 3) {
          // Create a compacted rule from the group
          const compactedContent = this.createCompactedRule(group);

          // Update the first memory with compacted content
          const keepId = (group[0] as (typeof group)[0]).id;
          await db
            .update(agentMemories)
            .set({ content: compactedContent })
            .where(eq(agentMemories.id, keepId));

          // Delete the rest of the group
          for (let i = 1; i < group.length; i++) {
            const mem = group[i] as (typeof group)[0];
            await db.delete(agentMemories).where(eq(agentMemories.id, mem.id));
            episodicCompacted++;
          }
        }
      }
    }

    logger.info(
      { projectId, totalProcessed, duplicatesMerged, episodicCompacted },
      "Memory compaction completed"
    );

    return { duplicatesMerged, episodicCompacted, totalProcessed };
  }

  /**
   * Group memories by text content similarity using simple overlap.
   */
  private groupByContentSimilarity(
    memories: Array<{ id: string; content: string }>
  ): Array<Array<{ id: string; content: string }>> {
    const groups: Array<Array<{ id: string; content: string }>> = [];
    const assigned = new Set<string>();

    for (const mem of memories) {
      if (assigned.has(mem.id)) {
        continue;
      }

      const group = [mem];
      assigned.add(mem.id);

      for (const other of memories) {
        if (assigned.has(other.id)) {
          continue;
        }

        if (this.textSimilarity(mem.content, other.content) > 0.7) {
          group.push(other);
          assigned.add(other.id);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Simple Jaccard similarity on word sets.
   */
  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(WHITESPACE_RE));
    const wordsB = new Set(b.toLowerCase().split(WHITESPACE_RE));

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) {
        intersection++;
      }
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Create a compacted rule from a group of similar episodic memories.
   */
  private createCompactedRule(
    group: Array<{ id: string; content: string }>
  ): string {
    const contents = group.map((m) => m.content);
    const commonWords = this.findCommonWords(contents);
    return `[Compacted from ${group.length} episodes] ${commonWords.join(" ")}`;
  }

  /**
   * Find the most common words across a set of content strings.
   */
  private findCommonWords(contents: string[]): string[] {
    const wordCounts = new Map<string, number>();

    for (const content of contents) {
      const words = new Set(content.toLowerCase().split(WHITESPACE_RE));
      for (const word of words) {
        if (word.length > 3) {
          wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
        }
      }
    }

    // Return words that appear in more than half of contents
    const threshold = Math.floor(contents.length / 2);
    return Array.from(wordCounts.entries())
      .filter(([, count]) => count > threshold)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 30)
      .map(([word]) => word);
  }
}
