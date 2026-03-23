/**
 * Collects training data from successful agent sessions for
 * custom model fine-tuning. Extracts input/output pairs, stores
 * them in memory, and exports in standard fine-tuning formats.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("model-router:training-data-collector");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingMessage {
  content: string;
  role: "system" | "user" | "assistant";
}

export interface TrainingExample {
  /** Unique identifier for this example */
  id: string;
  /** The conversation messages */
  messages: TrainingMessage[];
  /** Metadata about the example */
  metadata: {
    agent: string;
    task: string;
    quality: "good" | "bad";
    language?: string;
    sessionId: string;
    orgId: string;
    collectedAt: string;
  };
}

export interface TrainingStats {
  bad: number;
  byAgent: Record<string, number>;
  byLanguage: Record<string, number>;
  good: number;
  total: number;
}

// ---------------------------------------------------------------------------
// TrainingDataCollector
// ---------------------------------------------------------------------------

export class TrainingDataCollector {
  private readonly examples: TrainingExample[] = [];

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Collect training data from a completed session.
   *
   * In a full implementation this would read the session's message history
   * from the database. For now it accepts pre-extracted messages.
   */
  collectFromSession(
    sessionId: string,
    quality: "good" | "bad",
    options: {
      messages: TrainingMessage[];
      agent: string;
      task: string;
      orgId: string;
      language?: string;
    }
  ): TrainingExample {
    const example: TrainingExample = {
      id: generateId("trd"),
      messages: options.messages,
      metadata: {
        agent: options.agent,
        task: options.task,
        quality,
        language: options.language,
        sessionId,
        orgId: options.orgId,
        collectedAt: new Date().toISOString(),
      },
    };

    this.examples.push(example);

    logger.info(
      {
        id: example.id,
        sessionId,
        quality,
        agent: options.agent,
        messageCount: options.messages.length,
      },
      "Collected training example"
    );

    return example;
  }

  /**
   * Export training data in the specified format, filtered by org.
   */
  exportTrainingData(orgId: string, format: "jsonl" | "csv"): string {
    const orgExamples = this.examples.filter((e) => e.metadata.orgId === orgId);

    if (format === "jsonl") {
      return orgExamples
        .map((e) =>
          JSON.stringify({
            messages: e.messages,
            metadata: e.metadata,
          })
        )
        .join("\n");
    }

    // CSV format: id, quality, agent, task, messages (JSON-escaped)
    const header = "id,quality,agent,task,messages";
    const rows = orgExamples.map((e) => {
      const messagesJson = JSON.stringify(e.messages).replace(/"/g, '""');
      return `${e.id},${e.metadata.quality},${e.metadata.agent},"${e.metadata.task}","${messagesJson}"`;
    });

    return [header, ...rows].join("\n");
  }

  /**
   * Get statistics about collected training data.
   */
  getStats(): TrainingStats {
    const stats: TrainingStats = {
      total: this.examples.length,
      good: 0,
      bad: 0,
      byAgent: {},
      byLanguage: {},
    };

    for (const example of this.examples) {
      if (example.metadata.quality === "good") {
        stats.good += 1;
      } else {
        stats.bad += 1;
      }

      const agent = example.metadata.agent;
      stats.byAgent[agent] = (stats.byAgent[agent] ?? 0) + 1;

      const lang = example.metadata.language ?? "unknown";
      stats.byLanguage[lang] = (stats.byLanguage[lang] ?? 0) + 1;
    }

    return stats;
  }

  /**
   * Get all collected examples (for testing / inspection).
   */
  getExamples(): readonly TrainingExample[] {
    return this.examples;
  }

  /**
   * Clear all collected examples.
   */
  clear(): void {
    this.examples.length = 0;
    logger.info("Cleared all training examples");
  }
}
