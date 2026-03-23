import { createLogger } from "@prometheus/logger";
import type { AgentBus, AgentBusMessage } from "./agent-bus";

const logger = createLogger("orchestrator:shared-context");

export interface SharedContextEntry {
  agentId: string;
  agentRole: string;
  data: unknown;
  key: string;
  timestamp: number;
}

/**
 * SharedContext provides Redis-backed shared memory for fleet agents,
 * now enhanced with AgentBus integration for real-time broadcasts
 * of state changes (file claims, decisions, completions).
 */
export class SharedContext {
  private readonly sessionId: string;
  private readonly prefix: string;
  private bus: AgentBus | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.prefix = `fleet:ctx:${sessionId}`;
  }

  /**
   * Attach an AgentBus instance so context mutations are broadcast
   * to all agents in the fleet via pub/sub.
   */
  attachBus(bus: AgentBus): void {
    this.bus = bus;
  }

  async set(
    key: string,
    data: unknown,
    agentId: string,
    agentRole: string
  ): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    const entry: SharedContextEntry = {
      key,
      data,
      agentId,
      agentRole,
      timestamp: Date.now(),
    };
    await redis.set(`${this.prefix}:${key}`, JSON.stringify(entry), "EX", 3600);
    logger.debug({ key, agentId }, "Shared context updated");

    // Broadcast context update to all agents via bus
    if (this.bus) {
      await this.bus
        .publish("discovery", { contextKey: key, data, agentId, agentRole })
        .catch(() => {
          /* best-effort broadcast */
        });
    }
  }

  async get(key: string): Promise<SharedContextEntry | null> {
    const { redis } = await import("@prometheus/queue");
    const raw = await redis.get(`${this.prefix}:${key}`);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SharedContextEntry;
  }

  async getAll(): Promise<SharedContextEntry[]> {
    const { redis } = await import("@prometheus/queue");
    const keys = await redis.keys(`${this.prefix}:*`);
    if (keys.length === 0) {
      return [];
    }

    const values = await redis.mget(keys);
    const entries: SharedContextEntry[] = [];
    for (const val of values) {
      if (val) {
        entries.push(JSON.parse(val) as SharedContextEntry);
      }
    }
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getByAgent(agentId: string): Promise<SharedContextEntry[]> {
    const all = await this.getAll();
    return all.filter((e) => e.agentId === agentId);
  }

  async delete(key: string): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    await redis.del(`${this.prefix}:${key}`);
  }

  async clear(): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    const keys = await redis.keys(`${this.prefix}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }
    logger.info({ sessionId: this.sessionId }, "Shared context cleared");
  }

  /**
   * Claim a file for exclusive editing by an agent.
   * Uses the AgentBus if attached, otherwise falls back to Redis HSETNX.
   */
  async claimFile(filePath: string, agentId: string): Promise<boolean> {
    if (this.bus) {
      return this.bus.claimFile(filePath);
    }
    const { redis } = await import("@prometheus/queue");
    const claimKey = `${this.prefix}:file_claims`;
    const result = await redis.hsetnx(claimKey, filePath, agentId);
    if (result === 1) {
      await redis.expire(claimKey, 3600);
      return true;
    }
    return false;
  }

  /**
   * Get all file claims for the session.
   */
  async getFileClaims(): Promise<Record<string, string>> {
    if (this.bus) {
      return this.bus.getFileClaims();
    }
    const { redis } = await import("@prometheus/queue");
    const claimKey = `${this.prefix}:file_claims`;
    return (await redis.hgetall(claimKey)) ?? {};
  }

  /**
   * Drain pending bus messages for an agent to process before
   * each LLM call (bus-backed shared state).
   */
  drainBusMessages(): Promise<AgentBusMessage[]> {
    if (!this.bus) {
      return Promise.resolve([]);
    }
    return this.bus.drainMessages();
  }

  // ---------------------------------------------------------------------------
  // Agent Handoff Protocol
  // ---------------------------------------------------------------------------

  /**
   * Transfer working memory and context from one agent to another.
   * This enables seamless transitions when tasks are reassigned or
   * when a specialist agent needs to pick up where another left off.
   */
  async handoff(
    fromAgentId: string,
    toAgentId: string,
    context: HandoffContext
  ): Promise<void> {
    const handoffKey = `${this.prefix}:handoff:${fromAgentId}:${toAgentId}`;

    const handoffData: HandoffData = {
      fromAgentId,
      toAgentId,
      context,
      timestamp: Date.now(),
    };

    const { redis } = await import("@prometheus/queue");
    await redis.set(handoffKey, JSON.stringify(handoffData), "EX", 3600);

    // Also store the context under the receiving agent's namespace
    // so it can be retrieved during initialization
    const receiverKey = `${this.prefix}:handoff:pending:${toAgentId}`;
    await redis.set(receiverKey, JSON.stringify(handoffData), "EX", 3600);

    logger.info(
      {
        fromAgentId,
        toAgentId,
        sessionId: this.sessionId,
        fileContextCount: context.fileContext?.length ?? 0,
        decisionLogCount: context.decisionLog?.length ?? 0,
      },
      "Agent handoff completed"
    );

    // Broadcast handoff event via bus
    if (this.bus) {
      await this.bus
        .publish("decision", {
          type: "handoff",
          fromAgentId,
          toAgentId,
          summary: context.summary,
        })
        .catch(() => {
          /* best-effort broadcast */
        });
    }
  }

  /**
   * Retrieve pending handoff context for an agent.
   * Called during agent initialization to inherit context from predecessor.
   */
  async getHandoffContext(agentId: string): Promise<HandoffData | null> {
    const { redis } = await import("@prometheus/queue");
    const receiverKey = `${this.prefix}:handoff:pending:${agentId}`;
    const raw = await redis.get(receiverKey);

    if (!raw) {
      return null;
    }

    // Clean up the pending handoff after retrieval
    await redis.del(receiverKey);

    return JSON.parse(raw) as HandoffData;
  }
}

// ---------------------------------------------------------------------------
// Handoff types
// ---------------------------------------------------------------------------

/** Context transferred between agents during handoff. */
export interface HandoffContext {
  /** Decision log entries from the source agent */
  decisionLog?: DecisionLogEntry[];
  /** Files the source agent was working with */
  fileContext?: FileContextEntry[];
  /** Summary of work completed so far */
  summary: string;
  /** Working memory / key-value pairs */
  workingMemory?: Record<string, unknown>;
}

export interface HandoffData {
  context: HandoffContext;
  fromAgentId: string;
  timestamp: number;
  toAgentId: string;
}

export interface FileContextEntry {
  /** Brief description of why this file is relevant */
  description: string;
  /** File path */
  path: string;
  /** What the agent did with this file */
  status: "read" | "modified" | "created" | "planned";
}

export interface DecisionLogEntry {
  /** What alternatives were considered */
  alternatives?: string[];
  /** The decision made */
  decision: string;
  /** Why this decision was made */
  reasoning: string;
  /** When the decision was made */
  timestamp: number;
}
