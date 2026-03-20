/**
 * Phase 7.17: Memory Analytics.
 *
 * Track memory hit/miss rates and usefulness per project.
 * Exposes Prometheus-compatible metrics for observability.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:memory-analytics");

export interface MemoryStats {
  averageUsefulness: number;
  hitRate: number;
  missRate: number;
  projectId: string;
  totalHits: number;
  totalMisses: number;
  totalQueries: number;
}

interface HitRecord {
  memoryId: string;
  timestamp: number;
  usefulness: number;
}

interface MissRecord {
  query: string;
  timestamp: number;
}

/**
 * MemoryAnalytics tracks memory retrieval performance
 * including hit/miss rates and usefulness scores.
 */
export class MemoryAnalytics {
  private readonly hits: Map<string, HitRecord[]> = new Map();
  private readonly misses: Map<string, MissRecord[]> = new Map();

  /**
   * Record a memory hit (successful retrieval used by agent).
   */
  recordHit(memoryId: string, projectId: string, usefulness = 1.0): void {
    const records = this.hits.get(projectId) ?? [];
    records.push({
      memoryId,
      timestamp: Date.now(),
      usefulness: Math.max(0, Math.min(1, usefulness)),
    });
    this.hits.set(projectId, records);

    logger.debug({ memoryId, projectId, usefulness }, "Memory hit recorded");
  }

  /**
   * Record a memory miss (query returned no useful results).
   */
  recordMiss(query: string, projectId: string): void {
    const records = this.misses.get(projectId) ?? [];
    records.push({
      query,
      timestamp: Date.now(),
    });
    this.misses.set(projectId, records);

    logger.debug(
      { query: query.slice(0, 50), projectId },
      "Memory miss recorded"
    );
  }

  /**
   * Get aggregated stats for a project.
   */
  getStats(projectId: string): MemoryStats {
    const hits = this.hits.get(projectId) ?? [];
    const misses = this.misses.get(projectId) ?? [];
    const totalQueries = hits.length + misses.length;

    const averageUsefulness =
      hits.length > 0
        ? hits.reduce((sum, h) => sum + h.usefulness, 0) / hits.length
        : 0;

    return {
      projectId,
      totalHits: hits.length,
      totalMisses: misses.length,
      totalQueries,
      hitRate: totalQueries > 0 ? hits.length / totalQueries : 0,
      missRate: totalQueries > 0 ? misses.length / totalQueries : 0,
      averageUsefulness,
    };
  }

  /**
   * Export metrics in Prometheus exposition format.
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [
      "# HELP memory_hits_total Total memory hits by project",
      "# TYPE memory_hits_total counter",
      "# HELP memory_misses_total Total memory misses by project",
      "# TYPE memory_misses_total counter",
      "# HELP memory_usefulness_score Average memory usefulness by project",
      "# TYPE memory_usefulness_score gauge",
    ];

    const allProjects = new Set([...this.hits.keys(), ...this.misses.keys()]);

    for (const projectId of allProjects) {
      const stats = this.getStats(projectId);
      lines.push(
        `memory_hits_total{project="${projectId}"} ${stats.totalHits}`
      );
      lines.push(
        `memory_misses_total{project="${projectId}"} ${stats.totalMisses}`
      );
      lines.push(
        `memory_usefulness_score{project="${projectId}"} ${stats.averageUsefulness.toFixed(4)}`
      );
    }

    return lines.join("\n");
  }

  /**
   * Clear old records (older than 24 hours) to prevent memory leaks.
   */
  cleanup(): void {
    const cutoff = Date.now() - 86_400_000;

    for (const [projectId, records] of this.hits) {
      const filtered = records.filter((r) => r.timestamp > cutoff);
      if (filtered.length === 0) {
        this.hits.delete(projectId);
      } else {
        this.hits.set(projectId, filtered);
      }
    }

    for (const [projectId, records] of this.misses) {
      const filtered = records.filter((r) => r.timestamp > cutoff);
      if (filtered.length === 0) {
        this.misses.delete(projectId);
      } else {
        this.misses.set(projectId, filtered);
      }
    }
  }
}
