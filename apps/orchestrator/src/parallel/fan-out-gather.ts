/**
 * FanOutGather — Launches N agents concurrently and multiplexes their event
 * streams. Collects results with conflict detection for files modified by
 * multiple agents.
 */
import { createLogger } from "@prometheus/logger";
import type { ExecutionEvent } from "../engine/execution-events";

const logger = createLogger("orchestrator:fan-out-gather");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An execution event tagged with the originating agent's ID. */
export type TaggedEvent = ExecutionEvent & {
  agentId: string;
  agentRole: string;
};

/** A task descriptor for a single agent in the fan-out. */
export interface AgentTask {
  agentId: string;
  agentRole: string;
  dependencies?: string[];
  description: string;
}

/** Per-agent result collected during gather. */
export interface AgentResult {
  agentId: string;
  agentRole: string;
  error?: string;
  filesChanged: string[];
  output: string;
  success: boolean;
  tokensUsed: { input: number; output: number };
  toolCalls: number;
}

/** File conflict: same file modified by 2+ agents. */
export interface FileConflict {
  agents: string[];
  filePath: string;
}

/** Final gathered result from all agents. */
export interface GatherResult {
  completedAgents: string[];
  conflicts: FileConflict[];
  failedAgents: string[];
  results: AgentResult[];
  totalTokens: { input: number; output: number };
}

// ---------------------------------------------------------------------------
// FanOutGather
// ---------------------------------------------------------------------------

export class FanOutGather {
  private readonly maxConcurrency: number;

  constructor(maxConcurrency = 6) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Fan out: launch agents concurrently and yield tagged events as they arrive.
   *
   * Each agent is represented by an async generator of ExecutionEvents.
   * Events are multiplexed and tagged with the originating agent's ID.
   *
   * @param agents - Map of agentId to their event stream generators
   */
  async *fanOut(
    agents: Map<string, AsyncGenerator<ExecutionEvent, void, undefined>>
  ): AsyncGenerator<TaggedEvent, void, undefined> {
    const activeStreams = new Map<
      string,
      AsyncGenerator<ExecutionEvent, void, undefined>
    >();

    // Respect concurrency limit — process in batches
    const agentEntries = Array.from(agents.entries());
    let startIdx = 0;

    while (startIdx < agentEntries.length || activeStreams.size > 0) {
      // Fill up to maxConcurrency
      while (
        startIdx < agentEntries.length &&
        activeStreams.size < this.maxConcurrency
      ) {
        const entry = agentEntries[startIdx] as [
          string,
          AsyncGenerator<ExecutionEvent, void, undefined>,
        ];
        activeStreams.set(entry[0], entry[1]);
        startIdx++;

        logger.info(
          { agentId: entry[0], active: activeStreams.size },
          "Agent stream started"
        );
      }

      if (activeStreams.size === 0) {
        break;
      }

      // Race all active streams for the next event
      const pending = Array.from(activeStreams.entries()).map(
        async ([agentId, stream]) => {
          const result = await stream.next();
          return { agentId, result };
        }
      );

      // Use Promise.race to get the first available event
      // Then re-enter the loop to race remaining streams
      const resolved = await Promise.race(pending);

      if (resolved.result.done) {
        activeStreams.delete(resolved.agentId);
        logger.info(
          { agentId: resolved.agentId, remaining: activeStreams.size },
          "Agent stream completed"
        );
      } else {
        const taggedEvent: TaggedEvent = {
          ...resolved.result.value,
          agentId: resolved.agentId,
        };
        yield taggedEvent;
      }
    }
  }

  /**
   * Gather: collect results from multiple tagged event streams and detect
   * file conflicts.
   *
   * Consumes the full stream of tagged events, accumulates per-agent results,
   * and identifies files modified by multiple agents.
   */
  async gather(eventStream: AsyncIterable<TaggedEvent>): Promise<GatherResult> {
    const agentOutputs = new Map<string, AgentResult>();
    const fileToAgents = new Map<string, Set<string>>();

    for await (const event of eventStream) {
      // Ensure agent entry exists
      if (!agentOutputs.has(event.agentId)) {
        agentOutputs.set(event.agentId, {
          agentId: event.agentId,
          agentRole: event.agentRole,
          success: false,
          output: "",
          filesChanged: [],
          toolCalls: 0,
          tokensUsed: { input: 0, output: 0 },
        });
      }
      const agentResult = agentOutputs.get(event.agentId) as AgentResult;

      switch (event.type) {
        case "complete": {
          agentResult.success = event.success;
          agentResult.output = event.output;
          agentResult.filesChanged = event.filesChanged;
          agentResult.toolCalls = event.toolCalls;
          agentResult.tokensUsed = event.tokensUsed;
          break;
        }

        case "file_change": {
          const filePath = event.filePath;
          if (!fileToAgents.has(filePath)) {
            fileToAgents.set(filePath, new Set());
          }
          (fileToAgents.get(filePath) as Set<string>).add(event.agentId);
          break;
        }

        case "error": {
          if (!event.recoverable) {
            agentResult.success = false;
            agentResult.error = event.error;
          }
          break;
        }

        default:
          // Other events are passed through but don't affect gather state
          break;
      }
    }

    // Detect file conflicts
    const conflicts: FileConflict[] = [];
    for (const [filePath, agents] of fileToAgents) {
      if (agents.size > 1) {
        conflicts.push({
          filePath,
          agents: Array.from(agents),
        });
      }
    }

    if (conflicts.length > 0) {
      logger.warn(
        {
          conflictCount: conflicts.length,
          files: conflicts.map((c) => c.filePath),
        },
        "File conflicts detected between parallel agents"
      );
    }

    const results = Array.from(agentOutputs.values());
    const completedAgents = results
      .filter((r) => r.success)
      .map((r) => r.agentId);
    const failedAgents = results
      .filter((r) => !r.success)
      .map((r) => r.agentId);

    const totalTokens = results.reduce(
      (acc, r) => ({
        input: acc.input + r.tokensUsed.input,
        output: acc.output + r.tokensUsed.output,
      }),
      { input: 0, output: 0 }
    );

    return {
      results,
      conflicts,
      completedAgents,
      failedAgents,
      totalTokens,
    };
  }
}
