import { createLogger } from "@prometheus/logger";

const logger = createLogger("self-improvement:feedback-loop");

/**
 * A learning entry recorded after task completion.
 * Captures what worked, what failed, and the context.
 */
export interface LearningEntry {
  /** Agent role that produced this learning */
  agentRole: string;
  /** What approach was taken */
  approach: string;
  /** Category of the learning (e.g., "code_pattern", "tool_usage", "error_recovery") */
  category: string;
  /** Confidence score from 0 to 1 */
  confidence: number;
  /** Timestamp when this was recorded */
  createdAt: Date;
  /** What specifically worked or failed */
  detail: string;
  /** Unique ID for this learning */
  id: string;
  /** The org that owns the project */
  orgId: string;
  /** The project this learning was gathered from */
  projectId: string;
  /** Whether this approach succeeded */
  succeeded: boolean;
  /** Tags for retrieval (tech stack, file types, etc.) */
  tags: string[];
}

/** In-memory store for learnings (production would use the DB). */
const learningStore = new Map<string, LearningEntry[]>();

/**
 * Record a learning after a task completes. Stores both successes
 * and failures so agents can avoid repeating mistakes.
 */
export function recordLearning(entry: Omit<LearningEntry, "createdAt">): void {
  const key = `${entry.orgId}:${entry.projectId}`;
  const existing = learningStore.get(key) ?? [];
  const full: LearningEntry = { ...entry, createdAt: new Date() };
  existing.push(full);

  // Keep a bounded window per project (max 500 learnings)
  if (existing.length > 500) {
    existing.splice(0, existing.length - 500);
  }

  learningStore.set(key, existing);

  logger.info(
    {
      learningId: entry.id,
      projectId: entry.projectId,
      category: entry.category,
      succeeded: entry.succeeded,
    },
    "Learning recorded"
  );
}

/**
 * Retrieve relevant learnings before starting a new task.
 * Matches by project, agent role, and optional tag filters.
 * Returns only high-confidence entries, sorted by relevance.
 */
export function retrieveLearnings(params: {
  projectId: string;
  orgId: string;
  agentRole?: string;
  tags?: string[];
  category?: string;
  limit?: number;
  minConfidence?: number;
}): LearningEntry[] {
  const key = `${params.orgId}:${params.projectId}`;
  const entries = learningStore.get(key) ?? [];
  const minConf = params.minConfidence ?? 0.5;
  const limit = params.limit ?? 20;

  let filtered = entries.filter((e) => e.confidence >= minConf);

  if (params.agentRole) {
    filtered = filtered.filter((e) => e.agentRole === params.agentRole);
  }

  if (params.category) {
    filtered = filtered.filter((e) => e.category === params.category);
  }

  if (params.tags && params.tags.length > 0) {
    const tagSet = new Set(params.tags);
    filtered = filtered.filter((e) => e.tags.some((t) => tagSet.has(t)));
  }

  // Sort by confidence descending, then by recency
  filtered.sort((a, b) => {
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.01) {
      return confDiff;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return filtered.slice(0, limit);
}

/**
 * Build a context prompt from learnings to inject into an agent's
 * system prompt before starting a task.
 */
export function buildLearningContext(learnings: LearningEntry[]): string {
  if (learnings.length === 0) {
    return "";
  }

  const successes = learnings.filter((l) => l.succeeded);
  const failures = learnings.filter((l) => !l.succeeded);

  const lines: string[] = ["## Learnings from Previous Tasks", ""];

  if (successes.length > 0) {
    lines.push("### What Worked Well");
    for (const s of successes.slice(0, 10)) {
      lines.push(
        `- **${s.category}**: ${s.detail} (confidence: ${(s.confidence * 100).toFixed(0)}%)`
      );
    }
    lines.push("");
  }

  if (failures.length > 0) {
    lines.push("### What to Avoid");
    for (const f of failures.slice(0, 10)) {
      lines.push(
        `- **${f.category}**: ${f.detail} (confidence: ${(f.confidence * 100).toFixed(0)}%)`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Analyze a completed task's outcome and extract learnings automatically.
 * This is the main entry point called after each agent task completes.
 */
export function analyzeTaskOutcome(params: {
  taskId: string;
  projectId: string;
  orgId: string;
  agentRole: string;
  succeeded: boolean;
  toolsUsed: string[];
  errorMessages: string[];
  filesModified: string[];
  durationMs: number;
  tags: string[];
}): LearningEntry[] {
  const entries: LearningEntry[] = [];

  // Learn from tool usage patterns
  if (params.toolsUsed.length > 0) {
    const toolList = params.toolsUsed.join(", ");
    entries.push({
      id: `learn_${params.taskId}_tools`,
      projectId: params.projectId,
      orgId: params.orgId,
      agentRole: params.agentRole,
      category: "tool_usage",
      approach: `Used tools: ${toolList}`,
      succeeded: params.succeeded,
      detail: params.succeeded
        ? `Tool combination [${toolList}] was effective for this task type.`
        : `Tool combination [${toolList}] did not produce the desired result.`,
      tags: [...params.tags, ...params.toolsUsed],
      confidence: params.succeeded ? 0.7 : 0.6,
      createdAt: new Date(),
    });
  }

  // Learn from errors
  for (const errorMsg of params.errorMessages.slice(0, 3)) {
    entries.push({
      id: `learn_${params.taskId}_err_${entries.length}`,
      projectId: params.projectId,
      orgId: params.orgId,
      agentRole: params.agentRole,
      category: "error_recovery",
      approach: "Error encountered during execution",
      succeeded: false,
      detail: `Error: ${errorMsg.slice(0, 300)}`,
      tags: params.tags,
      confidence: 0.8,
      createdAt: new Date(),
    });
  }

  // Learn from performance
  if (params.durationMs > 0) {
    const category =
      params.durationMs > 120_000 ? "slow_execution" : "normal_execution";
    entries.push({
      id: `learn_${params.taskId}_perf`,
      projectId: params.projectId,
      orgId: params.orgId,
      agentRole: params.agentRole,
      category: "performance",
      approach: `Task completed in ${Math.round(params.durationMs / 1000)}s`,
      succeeded: params.succeeded,
      detail:
        category === "slow_execution"
          ? "This task type took over 2 minutes. Consider breaking into subtasks."
          : "Task completed within reasonable time.",
      tags: params.tags,
      confidence: 0.5,
      createdAt: new Date(),
    });
  }

  // Record all entries
  for (const entry of entries) {
    recordLearning(entry);
  }

  logger.info(
    {
      taskId: params.taskId,
      learningsCount: entries.length,
      succeeded: params.succeeded,
    },
    "Task outcome analyzed and learnings extracted"
  );

  return entries;
}

/**
 * Clear all learnings for a project (useful for testing or resets).
 */
export function clearLearnings(orgId: string, projectId: string): void {
  const key = `${orgId}:${projectId}`;
  learningStore.delete(key);
  logger.info({ projectId, orgId }, "Learnings cleared");
}
