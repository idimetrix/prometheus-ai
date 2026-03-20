/**
 * Self-play training system inspired by SWE-RL that generates training data
 * from agent sessions. Records successful and failed sessions, mines patterns
 * from accumulated examples, and builds decision trees that guide future
 * agent behavior.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:self-play-trainer");

const CONDITION_EQ_PATTERN = /^(\w+)\s*==\s*'([^']*)'$/;
const CONDITION_CONTAINS_PATTERN = /^(\w+)\s+contains\s+'([^']*)'$/;
const CONDITION_CMP_PATTERN = /^(\w+)\s*([<>])\s*(\d+)$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingExample {
  actions: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  agentRole: string;
  context: string;
  id: string;
  outcome: "success" | "failure" | "partial";
  projectId: string;
  qualityScore: number;
  taskDescription: string;
  timestamp: string;
}

export interface PatternDecisionTree {
  accuracy: number;
  agentRole: string;
  decisions: DecisionNode[];
  lastUpdated: string;
  taskType: string;
  trainingExamples: number;
}

export interface DecisionNode {
  children?: DecisionNode[];
  /** e.g., "error_type == 'TypeError'" */
  condition: string;
  recommendedAction: string;
  sampleSize: number;
  successRate: number;
}

export interface TrainingMetrics {
  correctionExamples: number;
  negativeExamples: number;
  patternsDiscovered: number;
  positiveExamples: number;
  totalExamples: number;
  treesBuilt: number;
}

interface CorrectionRecord {
  agentOutput: string;
  agentRole: string;
  humanEdit: string;
  id: string;
  taskId: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// SelfPlayTrainer
// ---------------------------------------------------------------------------

export class SelfPlayTrainer {
  private readonly examples: TrainingExample[] = [];
  private readonly corrections: CorrectionRecord[] = [];
  private readonly decisionTrees = new Map<string, PatternDecisionTree>();
  private readonly metrics: TrainingMetrics = {
    totalExamples: 0,
    positiveExamples: 0,
    negativeExamples: 0,
    correctionExamples: 0,
    patternsDiscovered: 0,
    treesBuilt: 0,
  };

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Record a completed agent session as training data.
   */
  recordSession(example: Omit<TrainingExample, "id" | "timestamp">): void {
    const full: TrainingExample = {
      ...example,
      id: generateId("trn"),
      timestamp: new Date().toISOString(),
    };
    this.examples.push(full);
    this.metrics.totalExamples += 1;

    if (full.outcome === "success") {
      this.metrics.positiveExamples += 1;
    } else {
      this.metrics.negativeExamples += 1;
    }

    logger.info(
      {
        id: full.id,
        outcome: full.outcome,
        agentRole: full.agentRole,
        qualityScore: full.qualityScore,
      },
      "Recorded training example"
    );
  }

  /**
   * Record a human correction — the diff between agent output and the
   * human-edited version. These corrections are high-signal negative
   * examples for pattern mining.
   */
  recordCorrection(
    taskId: string,
    agentOutput: string,
    humanEdit: string,
    agentRole: string
  ): void {
    const record: CorrectionRecord = {
      id: generateId("cor"),
      taskId,
      agentOutput,
      humanEdit,
      agentRole,
      timestamp: new Date().toISOString(),
    };
    this.corrections.push(record);
    this.metrics.correctionExamples += 1;

    logger.info(
      { id: record.id, taskId, agentRole },
      "Recorded human correction"
    );
  }

  /**
   * Mine patterns from accumulated examples and build a decision tree
   * for the given agentRole + taskType combination.
   *
   * 1. Split examples into success/failure buckets
   * 2. Find which tool sequences appear in successes but not failures
   * 3. Build decision nodes based on common action patterns
   * 4. Track success rates per decision path
   */
  minePatterns(agentRole: string, taskType: string): PatternDecisionTree {
    const key = `${agentRole}:${taskType}`;
    const roleExamples = this.examples.filter(
      (e) => e.agentRole === agentRole && e.context.includes(taskType)
    );

    if (roleExamples.length === 0) {
      logger.warn({ agentRole, taskType }, "No examples found for mining");
      const emptyTree: PatternDecisionTree = {
        agentRole,
        taskType,
        decisions: [],
        accuracy: 0,
        trainingExamples: 0,
        lastUpdated: new Date().toISOString(),
      };
      this.decisionTrees.set(key, emptyTree);
      return emptyTree;
    }

    // Step 1: Split into success/failure buckets
    const positive = roleExamples.filter((e) => e.outcome === "success");
    const negative = roleExamples.filter((e) => e.outcome !== "success");

    // Step 2 & 3: Find divergence points and build decision tree
    const decisions =
      positive.length > 0 && negative.length > 0
        ? this.findDivergencePoints(positive, negative)
        : this.buildDecisionTree(roleExamples);

    // Step 4: Calculate overall accuracy
    const correctPredictions = this.evaluateTreeAccuracy(
      decisions,
      roleExamples
    );
    const accuracy =
      roleExamples.length > 0 ? correctPredictions / roleExamples.length : 0;

    const tree: PatternDecisionTree = {
      agentRole,
      taskType,
      decisions,
      accuracy,
      trainingExamples: roleExamples.length,
      lastUpdated: new Date().toISOString(),
    };

    this.decisionTrees.set(key, tree);
    this.metrics.treesBuilt += 1;
    this.metrics.patternsDiscovered += decisions.length;

    logger.info(
      {
        agentRole,
        taskType,
        decisions: decisions.length,
        accuracy: accuracy.toFixed(3),
        examples: roleExamples.length,
      },
      "Mined patterns and built decision tree"
    );

    return tree;
  }

  /**
   * Get a recommended action for a given context by walking the decision
   * tree for the agentRole + taskType combination.
   */
  getRecommendation(
    agentRole: string,
    taskType: string,
    context: Record<string, string>
  ): { action: string; confidence: number } | null {
    const key = `${agentRole}:${taskType}`;
    const tree = this.decisionTrees.get(key);

    if (!tree || tree.decisions.length === 0) {
      return null;
    }

    // Walk the tree and find the best matching decision
    const match = this.walkTree(tree.decisions, context);
    if (!match) {
      return null;
    }

    logger.debug(
      {
        agentRole,
        taskType,
        action: match.recommendedAction,
        confidence: match.successRate,
      },
      "Returning recommendation"
    );

    return {
      action: match.recommendedAction,
      confidence: match.successRate,
    };
  }

  /**
   * Return current training metrics.
   */
  getMetrics(): TrainingMetrics {
    return { ...this.metrics };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Cluster positive/negative examples by tool sequences and find
   * divergence points — tool sequences that appear in successes but
   * not in failures (or vice versa).
   */
  private findDivergencePoints(
    positive: TrainingExample[],
    negative: TrainingExample[]
  ): DecisionNode[] {
    const positiveSequences = this.extractToolSequences(positive);
    const negativeSequences = this.extractToolSequences(negative);

    const nodes: DecisionNode[] = [];

    // Find tool sequences unique to successes
    for (const [sequence, count] of positiveSequences) {
      const negCount = negativeSequences.get(sequence) ?? 0;
      const totalCount = count + negCount;
      const successRate = count / totalCount;

      if (successRate > 0.6 && totalCount >= 2) {
        nodes.push({
          condition: `tool_sequence contains '${sequence}'`,
          recommendedAction: `Follow tool sequence: ${sequence}`,
          successRate,
          sampleSize: totalCount,
        });
      }
    }

    // Find tool sequences unique to failures (anti-patterns)
    for (const [sequence, count] of negativeSequences) {
      const posCount = positiveSequences.get(sequence) ?? 0;
      const totalCount = count + posCount;
      const failureRate = count / totalCount;

      if (failureRate > 0.7 && totalCount >= 2) {
        nodes.push({
          condition: `tool_sequence contains '${sequence}'`,
          recommendedAction: `Avoid tool sequence: ${sequence}`,
          successRate: 1 - failureRate,
          sampleSize: totalCount,
        });
      }
    }

    // Enrich with quality-based splits
    const qualityNodes = this.buildQualitySplits(positive, negative);
    nodes.push(...qualityNodes);

    return nodes;
  }

  /**
   * Build a simple decision tree from examples when we don't have a
   * clear positive/negative split.
   */
  private buildDecisionTree(examples: TrainingExample[]): DecisionNode[] {
    if (examples.length === 0) {
      return [];
    }

    const nodes: DecisionNode[] = [];

    // Group by first tool used
    const firstToolGroups = new Map<string, TrainingExample[]>();
    for (const example of examples) {
      const firstTool = example.actions[0]?.tool ?? "unknown";
      const group = firstToolGroups.get(firstTool) ?? [];
      group.push(example);
      firstToolGroups.set(firstTool, group);
    }

    for (const [tool, group] of firstToolGroups) {
      const successes = group.filter((e) => e.outcome === "success").length;
      const successRate = group.length > 0 ? successes / group.length : 0;

      const childNodes = this.buildChildNodes(group);

      nodes.push({
        condition: `first_tool == '${tool}'`,
        recommendedAction:
          successRate > 0.5
            ? `Start with ${tool}`
            : `Consider alternative to ${tool}`,
        successRate,
        sampleSize: group.length,
        children: childNodes.length > 0 ? childNodes : undefined,
      });
    }

    return nodes;
  }

  /**
   * Build child decision nodes by looking at the second action in
   * example sequences.
   */
  private buildChildNodes(examples: TrainingExample[]): DecisionNode[] {
    const nodes: DecisionNode[] = [];
    const secondToolGroups = new Map<string, TrainingExample[]>();

    for (const example of examples) {
      const secondTool = example.actions[1]?.tool;
      if (!secondTool) {
        continue;
      }
      const group = secondToolGroups.get(secondTool) ?? [];
      group.push(example);
      secondToolGroups.set(secondTool, group);
    }

    for (const [tool, group] of secondToolGroups) {
      if (group.length < 2) {
        continue;
      }
      const successes = group.filter((e) => e.outcome === "success").length;
      const successRate = group.length > 0 ? successes / group.length : 0;

      nodes.push({
        condition: `second_tool == '${tool}'`,
        recommendedAction:
          successRate > 0.5 ? `Follow with ${tool}` : `Avoid ${tool} next`,
        successRate,
        sampleSize: group.length,
      });
    }

    return nodes;
  }

  /**
   * Extract 2-gram tool sequences from examples and count occurrences.
   */
  private extractToolSequences(
    examples: TrainingExample[]
  ): Map<string, number> {
    const sequences = new Map<string, number>();

    for (const example of examples) {
      for (let i = 0; i < example.actions.length - 1; i++) {
        const current = example.actions[i];
        const next = example.actions[i + 1];
        if (!(current && next)) {
          continue;
        }
        const seq = `${current.tool}->${next.tool}`;
        sequences.set(seq, (sequences.get(seq) ?? 0) + 1);
      }
    }

    return sequences;
  }

  /**
   * Build decision nodes based on quality score thresholds.
   */
  private buildQualitySplits(
    positive: TrainingExample[],
    negative: TrainingExample[]
  ): DecisionNode[] {
    const nodes: DecisionNode[] = [];

    const avgPositiveActions =
      positive.length > 0
        ? positive.reduce((sum, e) => sum + e.actions.length, 0) /
          positive.length
        : 0;

    const avgNegativeActions =
      negative.length > 0
        ? negative.reduce((sum, e) => sum + e.actions.length, 0) /
          negative.length
        : 0;

    // If successes tend to use fewer actions, that is a signal
    if (
      avgPositiveActions > 0 &&
      avgNegativeActions > 0 &&
      Math.abs(avgPositiveActions - avgNegativeActions) > 1
    ) {
      const threshold = Math.round(
        (avgPositiveActions + avgNegativeActions) / 2
      );
      const label = avgPositiveActions < avgNegativeActions ? "fewer" : "more";

      nodes.push({
        condition: `action_count ${label === "fewer" ? "<" : ">"} ${threshold}`,
        recommendedAction: `Aim for ${label} actions (target: ${Math.round(avgPositiveActions)})`,
        successRate: positive.length / (positive.length + negative.length),
        sampleSize: positive.length + negative.length,
      });
    }

    return nodes;
  }

  /**
   * Evaluate how many examples would be correctly classified by the tree.
   */
  private evaluateTreeAccuracy(
    decisions: DecisionNode[],
    examples: TrainingExample[]
  ): number {
    if (decisions.length === 0) {
      return 0;
    }

    let correct = 0;
    for (const example of examples) {
      const context: Record<string, string> = {
        first_tool: example.actions[0]?.tool ?? "unknown",
        action_count: String(example.actions.length),
      };

      // Build tool_sequence string
      const sequences: string[] = [];
      for (let i = 0; i < example.actions.length - 1; i++) {
        const current = example.actions[i];
        const next = example.actions[i + 1];
        if (!(current && next)) {
          continue;
        }
        sequences.push(`${current.tool}->${next.tool}`);
      }
      context.tool_sequence = sequences.join(",");

      const match = this.walkTree(decisions, context);
      if (match) {
        const predicted = match.successRate > 0.5;
        const actual = example.outcome === "success";
        if (predicted === actual) {
          correct += 1;
        }
      }
    }

    return correct;
  }

  /**
   * Walk the decision tree and find the best matching node for the
   * given context.
   */
  private walkTree(
    nodes: DecisionNode[],
    context: Record<string, string>
  ): DecisionNode | null {
    let bestMatch: DecisionNode | null = null;
    let bestScore = -1;

    for (const node of nodes) {
      if (this.matchesCondition(node.condition, context)) {
        // Prefer higher sample size as a proxy for confidence
        const score = node.sampleSize * node.successRate;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = node;
        }

        // Walk children if present
        if (node.children && node.children.length > 0) {
          const childMatch = this.walkTree(node.children, context);
          if (childMatch) {
            const childScore = childMatch.sampleSize * childMatch.successRate;
            if (childScore > bestScore) {
              bestScore = childScore;
              bestMatch = childMatch;
            }
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Check if a condition string matches the given context.
   * Supports simple conditions like:
   *   - "first_tool == 'readFile'"
   *   - "tool_sequence contains 'read->write'"
   *   - "action_count < 5"
   */
  private matchesCondition(
    condition: string,
    context: Record<string, string>
  ): boolean {
    // "key == 'value'" pattern
    const eqMatch = condition.match(CONDITION_EQ_PATTERN);
    if (eqMatch) {
      const key = eqMatch[1] ?? "";
      const value = eqMatch[2] ?? "";
      return context[key] === value;
    }

    // "key contains 'value'" pattern
    const containsMatch = condition.match(CONDITION_CONTAINS_PATTERN);
    if (containsMatch) {
      const key = containsMatch[1] ?? "";
      const value = containsMatch[2] ?? "";
      return (context[key] ?? "").includes(value);
    }

    // "key < number" or "key > number" pattern
    const cmpMatch = condition.match(CONDITION_CMP_PATTERN);
    if (cmpMatch) {
      const key = cmpMatch[1] ?? "";
      const op = cmpMatch[2] ?? "<";
      const thresholdStr = cmpMatch[3] ?? "0";
      const val = Number.parseInt(context[key] ?? "0", 10);
      const threshold = Number.parseInt(thresholdStr, 10);
      return op === "<" ? val < threshold : val > threshold;
    }

    return false;
  }
}
