/**
 * Phase 5.2: Memory Effectiveness Tracker.
 *
 * Records before/after metrics for each memory retrieval to measure
 * whether memory improves quality over time. Tracks:
 *  - Token usage (with vs without memory context)
 *  - Success rate (with vs without memory context)
 *  - Latency impact of memory retrieval
 *  - Memory hit rates across layers
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:memory-tracker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryLayer =
  | "working"
  | "episodic"
  | "semantic"
  | "procedural"
  | "convention"
  | "domain"
  | "org"
  | "knowledge-graph";

export interface MemoryRetrievalEvent {
  /** Unique ID for this event */
  id: string;
  /** Number of memory items retrieved */
  itemsRetrieved: number;
  /** Which memory layers contributed context */
  layersUsed: MemoryLayer[];
  /** Token count of the retrieved memory context */
  memoryTokens: number;
  /** The project this event belongs to */
  projectId: string;
  /** Quality score of the output (0-1) if available */
  qualityScore: number | null;
  /** Time to retrieve memory context (ms) */
  retrievalLatencyMs: number;
  /** Session ID */
  sessionId: string;
  /** Whether the task completed successfully with memory context */
  succeeded: boolean;
  /** Timestamp */
  timestamp: number;
  /** Total tokens used for the task (input + output) */
  totalTokensUsed: number;
}

export interface MemoryEffectivenessReport {
  /** Average quality score with memory */
  avgQualityWithMemory: number | null;
  /** Average quality score without memory */
  avgQualityWithoutMemory: number | null;
  /** Average retrieval latency */
  avgRetrievalLatencyMs: number;
  /** Average tokens used when memory is active */
  avgTokensWithMemory: number;
  /** Average tokens used without memory */
  avgTokensWithoutMemory: number;
  /** Events where memory was used */
  eventsWithMemory: number;
  /** Events where no memory was used */
  eventsWithoutMemory: number;
  /** Timestamp of report generation */
  generatedAt: string;
  /** Per-layer hit rates */
  layerHitRates: Record<MemoryLayer, { hits: number; rate: number }>;
  /** Quality improvement from memory */
  qualityImprovement: number | null;
  /** Improvement in success rate from memory */
  successRateImprovement: number;
  /** Success rate when memory is used */
  successRateWithMemory: number;
  /** Success rate when memory is NOT used */
  successRateWithoutMemory: number;
  /** Token efficiency (lower is better -- negative means memory saves tokens) */
  tokenDelta: number;
  /** Total events tracked */
  totalEvents: number;
}

// ---------------------------------------------------------------------------
// Memory Effectiveness Tracker
// ---------------------------------------------------------------------------

const MAX_EVENTS = 10_000;

export class MemoryEffectivenessTracker {
  private readonly events: MemoryRetrievalEvent[] = [];
  private eventCounter = 0;

  /**
   * Record a memory retrieval event.
   */
  recordEvent(
    params: Omit<MemoryRetrievalEvent, "id" | "timestamp">
  ): MemoryRetrievalEvent {
    this.eventCounter++;
    const event: MemoryRetrievalEvent = {
      ...params,
      id: `mre_${this.eventCounter}`,
      timestamp: Date.now(),
    };

    this.events.push(event);

    // Evict old events
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }

    logger.debug(
      {
        eventId: event.id,
        layersUsed: event.layersUsed,
        itemsRetrieved: event.itemsRetrieved,
        succeeded: event.succeeded,
      },
      "Memory retrieval event recorded"
    );

    return event;
  }

  /**
   * Generate a comprehensive effectiveness report.
   */
  generateReport(projectId?: string): MemoryEffectivenessReport {
    const filtered = projectId
      ? this.events.filter((e) => e.projectId === projectId)
      : this.events;

    const withMemory = filtered.filter((e) => e.layersUsed.length > 0);
    const withoutMemory = filtered.filter((e) => e.layersUsed.length === 0);

    const successRateWithMemory =
      withMemory.length > 0
        ? withMemory.filter((e) => e.succeeded).length / withMemory.length
        : 0;
    const successRateWithoutMemory =
      withoutMemory.length > 0
        ? withoutMemory.filter((e) => e.succeeded).length / withoutMemory.length
        : 0;

    const avgTokensWithMemory =
      withMemory.length > 0
        ? withMemory.reduce((sum, e) => sum + e.totalTokensUsed, 0) /
          withMemory.length
        : 0;
    const avgTokensWithoutMemory =
      withoutMemory.length > 0
        ? withoutMemory.reduce((sum, e) => sum + e.totalTokensUsed, 0) /
          withoutMemory.length
        : 0;

    const avgRetrievalLatencyMs =
      withMemory.length > 0
        ? withMemory.reduce((sum, e) => sum + e.retrievalLatencyMs, 0) /
          withMemory.length
        : 0;

    // Per-layer hit rates
    const allLayers: MemoryLayer[] = [
      "working",
      "episodic",
      "semantic",
      "procedural",
      "convention",
      "domain",
      "org",
      "knowledge-graph",
    ];
    const layerHitRates = {} as Record<
      MemoryLayer,
      { hits: number; rate: number }
    >;
    for (const layer of allLayers) {
      const hits = filtered.filter((e) => e.layersUsed.includes(layer)).length;
      layerHitRates[layer] = {
        hits,
        rate: filtered.length > 0 ? hits / filtered.length : 0,
      };
    }

    // Quality scores
    const withMemoryQuality = withMemory.filter((e) => e.qualityScore !== null);
    const withoutMemoryQuality = withoutMemory.filter(
      (e) => e.qualityScore !== null
    );
    const avgQualityWithMemory =
      withMemoryQuality.length > 0
        ? withMemoryQuality.reduce((sum, e) => sum + (e.qualityScore ?? 0), 0) /
          withMemoryQuality.length
        : null;
    const avgQualityWithoutMemory =
      withoutMemoryQuality.length > 0
        ? withoutMemoryQuality.reduce(
            (sum, e) => sum + (e.qualityScore ?? 0),
            0
          ) / withoutMemoryQuality.length
        : null;

    const qualityImprovement =
      avgQualityWithMemory !== null && avgQualityWithoutMemory !== null
        ? avgQualityWithMemory - avgQualityWithoutMemory
        : null;

    const report: MemoryEffectivenessReport = {
      totalEvents: filtered.length,
      eventsWithMemory: withMemory.length,
      eventsWithoutMemory: withoutMemory.length,
      successRateWithMemory,
      successRateWithoutMemory,
      successRateImprovement: successRateWithMemory - successRateWithoutMemory,
      avgTokensWithMemory,
      avgTokensWithoutMemory,
      tokenDelta: avgTokensWithMemory - avgTokensWithoutMemory,
      avgRetrievalLatencyMs,
      layerHitRates,
      avgQualityWithMemory,
      avgQualityWithoutMemory,
      qualityImprovement,
      generatedAt: new Date().toISOString(),
    };

    logger.info(
      {
        totalEvents: report.totalEvents,
        successRateImprovement: report.successRateImprovement.toFixed(3),
        qualityImprovement: report.qualityImprovement?.toFixed(3) ?? "N/A",
      },
      "Memory effectiveness report generated"
    );

    return report;
  }

  /**
   * Get the count of tracked events.
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Clear all tracked events.
   */
  reset(): void {
    this.events.length = 0;
    this.eventCounter = 0;
    logger.info("Memory tracker reset");
  }
}
