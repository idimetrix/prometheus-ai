import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import type { SprintPlan } from "../phases/planning";

const logger = createLogger("orchestrator:mcts");

const LIST_BULLET_PREFIX_RE = /^\s*[-*]\s*/;
const NON_ALPHANUMERIC_RE = /[^a-z0-9\s]/g;
const WHITESPACE_SPLIT_RE = /\s+/;
const NEGATIVE_RULE_RE = /don't|never|avoid|no\s/gi;

/** MCTS tree node representing a planning strategy */
interface MCTSNode {
  children: MCTSNode[];
  depth: number;
  id: string;
  parent: MCTSNode | null;
  plan: SprintPlan | null;
  score: number;
  strategy: string;
  visits: number;
}

/** Project conventions that influence plan scoring */
export interface ProjectConventions {
  /** Any additional convention strings to check against */
  customRules?: string[];
  /** File organization rules (e.g., "components in src/components") */
  fileOrganization?: string[];
  /** Expected naming patterns (e.g., kebab-case files, camelCase functions) */
  namingPatterns?: string[];
  /** Required structural patterns (e.g., "tests co-located", "barrel exports") */
  structuralPatterns?: string[];
  /** Required tooling patterns (e.g., "use Drizzle ORM", "use tRPC") */
  toolingPatterns?: string[];
}

/** Configuration for MCTS planning */
export interface MCTSConfig {
  /** Project conventions for convention-driven scoring */
  conventions?: ProjectConventions;
  /** Enable depth-2 sub-phase expansion. Default: true */
  enableDepth2Expansion?: boolean;
  /** Enable LLM-based review scoring via the "review" slot. Default: false */
  enableLLMReview?: boolean;
  /** Enable plan caching for similar tasks. Default: true */
  enablePlanCaching?: boolean;
  /** Enable progressive deepening. Default: true */
  enableProgressiveDeepening?: boolean;
  /** Number of candidate strategies to explore. Default: 3 */
  expansionWidth?: number;
  /** UCB1 exploration constant. Default: 1.41 */
  explorationConstant?: number;
  /** Maximum tree depth (Strategy->Phase->Task->Subtask). Default: 4 */
  maxDepth?: number;
  /** Maximum total LLM calls for planning. Default: 20 for complex tasks */
  maxLLMCalls?: number;
  /** Prune branches scoring below this threshold. Default: 0.3 */
  pruneThreshold?: number;
  /** Number of simulation rounds per node. Default: 2 */
  simulationRounds?: number;
}

/** Result of MCTS planning */
export interface MCTSPlanResult {
  alternativesExplored: number;
  bestScore: number;
  confidence: number;
  /** Convention compliance score (0-1) if conventions were provided */
  conventionScore?: number;
  /** Whether the plan was retrieved from cache */
  fromCache?: boolean;
  selectedPlan: SprintPlan;
  selectedStrategy: string;
  totalSimulations: number;
}

/** Cached plan entry keyed by task similarity hash */
interface CachedPlan {
  createdAt: number;
  plan: SprintPlan;
  score: number;
  strategy: string;
  taskHash: string;
}

const STRATEGY_RE = /STRATEGY:\s*(.+?)(?:\n|$)/gi;
const TASK_HEADER_RE = /TASK-(\d+):\s*(.+?)(?:\n|$)/g;
const AGENT_RE = /Agent:\s*(\w+)/i;
const DEPS_RE = /Dependencies:\s*(.+?)(?:\n|$)/i;
const EFFORT_RE = /Effort:\s*(S|M|L|XL)/i;
const AC_RE = /Acceptance Criteria:([\s\S]*?)(?=\nTASK-|\n##|$)/i;
const TASK_ID_RE = /TASK-\d+/g;
const SPRINT_GOAL_RE = /SPRINT_GOAL[^\n]*\n(.+?)(?:\n|$)/i;
const WORKSTREAMS_RE = /PARALLEL_WORKSTREAMS[\s\S]*?(?=##|$)/i;
const CRITICAL_PATH_RE = /CRITICAL_PATH[\s\S]*?(?=##|$)/i;
const SCORE_RE = /SCORE:\s*([\d.]+)/i;
const PHASE_RE = /PHASE-(\d+):\s*(.+?)(?:\n|$)/gi;

const ROLE_MAP: Record<string, string> = {
  frontend: "frontend_coder",
  frontend_coder: "frontend_coder",
  backend: "backend_coder",
  backend_coder: "backend_coder",
  integration: "integration_coder",
  integration_coder: "integration_coder",
  test: "test_engineer",
  test_engineer: "test_engineer",
  deploy: "deploy_engineer",
  deploy_engineer: "deploy_engineer",
};

/** Maximum number of cached plans */
const MAX_PLAN_CACHE_SIZE = 50;
/** Cache TTL in milliseconds (24 hours) */
const PLAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Simple hash for task similarity comparison.
 * Extracts key terms and produces a normalized fingerprint.
 */
function computeTaskHash(taskDescription: string): string {
  const normalized = taskDescription
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_RE, "")
    .split(WHITESPACE_SPLIT_RE)
    .filter((w) => w.length > 3)
    .sort()
    .join(" ");

  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `task_${(hash >>> 0).toString(36)}`;
}

/**
 * Compute Jaccard similarity between two task descriptions (0-1).
 * Returns 1.0 for identical word sets, 0.0 for completely different.
 */
function isNegativeRule(ruleLower: string): boolean {
  return (
    ruleLower.includes("don't") ||
    ruleLower.includes("never") ||
    ruleLower.includes("avoid") ||
    ruleLower.includes("no raw")
  );
}

function scoreRuleViolation(ruleLower: string, planText: string): number {
  if (isNegativeRule(ruleLower)) {
    const avoidTerms = ruleLower
      .replace(NEGATIVE_RULE_RE, "")
      .trim()
      .split(WHITESPACE_SPLIT_RE)
      .filter((t) => t.length > 3);
    const violated = avoidTerms.some((term) => planText.includes(term));
    return violated ? 1 : 0;
  }

  const keyTerms = ruleLower
    .split(WHITESPACE_SPLIT_RE)
    .filter((t) => t.length > 3)
    .slice(0, 3);
  const mentioned = keyTerms.some((term) => planText.includes(term));
  return !mentioned && keyTerms.length > 0 ? 0.5 : 0;
}

function computeTaskSimilarity(desc1: string, desc2: string): number {
  const words1 = new Set(
    desc1
      .toLowerCase()
      .replace(NON_ALPHANUMERIC_RE, "")
      .split(WHITESPACE_SPLIT_RE)
      .filter((w) => w.length > 3)
  );
  const words2 = new Set(
    desc2
      .toLowerCase()
      .replace(NON_ALPHANUMERIC_RE, "")
      .split(WHITESPACE_SPLIT_RE)
      .filter((w) => w.length > 3)
  );

  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      intersection++;
    }
  }

  const union = words1.size + words2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * MCTSPlanner uses Monte Carlo Tree Search to explore multiple planning
 * strategies and select the highest-confidence approach.
 *
 * The tree has up to 4 levels:
 * 1. Strategy (e.g., "API-first", "UI-first", "data-model-first")
 * 2. Phase decomposition (sub-phases within each strategy)
 * 3. Task decomposition (individual tasks within phases)
 * 4. Subtask detail
 *
 * Each node is scored using a combination of heuristic evaluation,
 * optional LLM-based review, and convention compliance checking.
 *
 * Features:
 * - Depth-2 expansion: expands sub-phases within promising strategies
 * - LLM-based scoring: uses "review" slot for quality assessment
 * - Plan caching: reuses plans for similar tasks
 * - Progressive deepening: starts shallow, deepens promising branches
 * - Convention-driven scoring: penalizes plans violating project conventions
 */

function parseAcceptanceCriteriaLines(
  block: string,
  acRegex: RegExp,
  bulletPrefixRegex: RegExp
): string[] {
  const acLines: string[] = [];
  const acMatch = block.match(acRegex);
  if (acMatch?.[1]) {
    for (const line of acMatch[1].split("\n")) {
      const cleaned = line.replace(bulletPrefixRegex, "").trim();
      if (cleaned.length > 0) {
        acLines.push(cleaned);
      }
    }
  }
  return acLines;
}

function parseTaskBlockFromOutput(
  block: string,
  id: string,
  title: string,
  agentRe: RegExp,
  depsRe: RegExp,
  effortRe: RegExp,
  acRe: RegExp,
  taskIdRe: RegExp,
  bulletPrefixRe: RegExp,
  roleMap: Record<string, string>
): SprintPlan["tasks"][number] {
  const agentMatch = block.match(agentRe);
  const depsMatch = block.match(depsRe);
  const effortMatch = block.match(effortRe);

  const depsStr = depsMatch?.[1]?.trim() ?? "none";
  const deps: string[] = [];
  if (depsStr.toLowerCase() !== "none") {
    const depIds = depsStr.match(taskIdRe);
    if (depIds) {
      deps.push(...depIds);
    }
  }

  const acLines = parseAcceptanceCriteriaLines(block, acRe, bulletPrefixRe);

  return {
    id,
    title,
    description: title,
    agentRole:
      roleMap[agentMatch?.[1]?.toLowerCase() ?? "backend"] ?? "backend_coder",
    dependencies: deps,
    effort: (effortMatch?.[1]?.toUpperCase() ?? "M") as "S" | "M" | "L" | "XL",
    acceptanceCriteria:
      acLines.length > 0 ? acLines : [`${title} works correctly`],
  };
}

export class MCTSPlanner {
  private readonly config: Required<MCTSConfig>;
  private llmCallCount = 0;

  /** Plan cache indexed by task hash */
  private static readonly planCache: Map<string, CachedPlan> = new Map();

  constructor(config: MCTSConfig = {}) {
    this.config = {
      maxDepth: config.maxDepth ?? 4,
      pruneThreshold: config.pruneThreshold ?? 0.3,
      expansionWidth: config.expansionWidth ?? 3,
      simulationRounds: config.simulationRounds ?? 2,
      explorationConstant: config.explorationConstant ?? 1.41,
      maxLLMCalls: config.maxLLMCalls ?? 20,
      enableLLMReview: config.enableLLMReview ?? false,
      enableDepth2Expansion: config.enableDepth2Expansion ?? true,
      enablePlanCaching: config.enablePlanCaching ?? true,
      enableProgressiveDeepening: config.enableProgressiveDeepening ?? true,
      conventions: config.conventions ?? {},
    };
  }

  async plan(
    agentLoop: AgentLoop,
    blueprint: string,
    taskDescription: string
  ): Promise<MCTSPlanResult> {
    this.llmCallCount = 0;

    logger.info(
      {
        maxDepth: this.config.maxDepth,
        expansionWidth: this.config.expansionWidth,
        maxLLMCalls: this.config.maxLLMCalls,
        enableLLMReview: this.config.enableLLMReview,
        enableDepth2Expansion: this.config.enableDepth2Expansion,
        enablePlanCaching: this.config.enablePlanCaching,
      },
      "Starting MCTS planning"
    );

    // Check plan cache for similar tasks
    if (this.config.enablePlanCaching) {
      const cached = this.findCachedPlan(taskDescription);
      if (cached) {
        logger.info(
          {
            taskHash: cached.taskHash,
            strategy: cached.strategy,
            score: cached.score,
          },
          "Returning cached plan for similar task"
        );
        return {
          selectedPlan: cached.plan,
          selectedStrategy: cached.strategy,
          confidence: Math.min(1, cached.score),
          alternativesExplored: 0,
          bestScore: cached.score,
          totalSimulations: 0,
          fromCache: true,
        };
      }
    }

    // Create root node
    const root: MCTSNode = {
      id: "root",
      strategy: "root",
      plan: null,
      score: 0,
      visits: 0,
      children: [],
      parent: null,
      depth: 0,
    };

    // Phase 1: Expand - Generate candidate strategies
    const strategies = await this.generateStrategies(
      agentLoop,
      blueprint,
      taskDescription
    );

    for (const strategy of strategies) {
      const child: MCTSNode = {
        id: `strategy-${strategy.name.replace(/\s+/g, "-").toLowerCase()}`,
        strategy: strategy.name,
        plan: null,
        score: 0,
        visits: 0,
        children: [],
        parent: root,
        depth: 1,
      };
      root.children.push(child);
    }

    // Phase 2: Progressive deepening or standard simulation
    if (this.config.enableProgressiveDeepening) {
      await this.progressiveDeepen(agentLoop, root, blueprint, taskDescription);
    } else {
      for (const child of root.children) {
        if (this.llmCallCount >= this.config.maxLLMCalls) {
          break;
        }

        const simulation = await this.simulate(
          agentLoop,
          child.strategy,
          blueprint,
          taskDescription
        );
        child.score = simulation.score;
        child.plan = simulation.plan;
        child.visits = 1;

        root.score += simulation.score;
        root.visits++;
      }
    }

    // Prune branches scoring below threshold
    const pruneThreshold = this.config.pruneThreshold;
    root.children = root.children.filter((child) => {
      if (child.score < pruneThreshold) {
        logger.debug(
          { strategy: child.strategy.slice(0, 50), score: child.score },
          "Pruned low-scoring strategy"
        );
        return false;
      }
      return true;
    });

    // Phase 3: Depth-2 expansion for surviving strategies
    if (this.config.enableDepth2Expansion) {
      await this.expandDepth2(agentLoop, root, blueprint, taskDescription);
    }

    // Phase 4: LLM-based review scoring for top strategies
    if (this.config.enableLLMReview) {
      await this.llmReviewScoring(agentLoop, root);
    }

    // Phase 5: Select best strategy using UCB1
    const best = this.selectBest(root);

    if (!best?.plan) {
      logger.warn(
        "MCTS produced no viable plan, falling back to standard planning"
      );
      const fallbackResult = await agentLoop.executeTask(
        `Create a sprint plan for: ${taskDescription}\n\nBlueprint:\n${blueprint}`,
        "planner"
      );
      return {
        selectedPlan: this.parsePlanFromOutput(
          fallbackResult.output,
          taskDescription
        ),
        selectedStrategy: "fallback-standard",
        confidence: 0.5,
        alternativesExplored: strategies.length,
        bestScore: 0.5,
        totalSimulations: this.llmCallCount,
      };
    }

    // Cache the successful plan
    if (this.config.enablePlanCaching) {
      this.cachePlan(taskDescription, best.plan, best.strategy, best.score);
    }

    const conventionScore = this.scoreConventionCompliance(best.plan);

    logger.info(
      {
        selectedStrategy: best.strategy,
        score: best.score,
        conventionScore,
        alternatives: root.children.length,
        totalLLMCalls: this.llmCallCount,
      },
      "MCTS planning complete"
    );

    return {
      selectedPlan: best.plan,
      selectedStrategy: best.strategy,
      confidence: Math.min(1, best.score),
      alternativesExplored: root.children.length,
      bestScore: best.score,
      totalSimulations: this.llmCallCount,
      conventionScore,
    };
  }

  // ─── Progressive Deepening ─────────────────────────────────────────

  /**
   * Start with a shallow evaluation of all strategies, then deepen
   * the most promising branches with additional simulation rounds.
   */
  private async progressiveDeepen(
    agentLoop: AgentLoop,
    root: MCTSNode,
    blueprint: string,
    taskDescription: string
  ): Promise<void> {
    // Round 1: Shallow evaluation of all strategies
    for (const child of root.children) {
      if (this.llmCallCount >= this.config.maxLLMCalls) {
        break;
      }

      const simulation = await this.simulate(
        agentLoop,
        child.strategy,
        blueprint,
        taskDescription
      );
      child.score = simulation.score;
      child.plan = simulation.plan;
      child.visits = 1;
      root.score += simulation.score;
      root.visits++;
    }

    // Sort by score descending
    const sorted = [...root.children]
      .filter((c) => c.visits > 0)
      .sort((a, b) => b.score - a.score);

    // Round 2: Deepen the top half with additional simulation
    const deepenCount = Math.max(1, Math.floor(sorted.length / 2));
    for (let i = 0; i < deepenCount; i++) {
      const node = sorted[i];
      if (!node || this.llmCallCount >= this.config.maxLLMCalls) {
        break;
      }

      logger.debug(
        { strategy: node.strategy, currentScore: node.score },
        "Progressive deepening: re-simulating promising strategy"
      );

      const resim = await this.simulate(
        agentLoop,
        node.strategy,
        blueprint,
        taskDescription
      );

      // Average the scores; keep the better plan
      const avgScore = (node.score + resim.score) / 2;
      if (resim.score > node.score && resim.plan) {
        node.plan = resim.plan;
      }
      node.score = avgScore;
      node.visits++;
      root.score += resim.score;
      root.visits++;
    }
  }

  // ─── Depth-2 Expansion ─────────────────────────────────────────────

  /**
   * Expand the top strategy into sub-phases. Asks the LLM to decompose
   * it into 2-4 sequential phases, then updates the plan workstreams.
   */
  private async expandDepth2(
    agentLoop: AgentLoop,
    root: MCTSNode,
    _blueprint: string,
    taskDescription: string
  ): Promise<void> {
    const topNode = this.selectBest(root);
    if (!topNode?.plan || this.llmCallCount >= this.config.maxLLMCalls) {
      return;
    }

    this.llmCallCount++;

    logger.debug(
      { strategy: topNode.strategy },
      "Expanding depth-2 sub-phases"
    );

    const phaseResult = await agentLoop.executeTask(
      `You are refining the "${topNode.strategy}" implementation strategy.

Task: ${taskDescription}

The current plan has ${topNode.plan.tasks.length} tasks with goal: "${topNode.plan.sprintGoal}"

Break this strategy into 2-4 sequential implementation phases. Each phase should group related tasks.

For each phase, provide:
PHASE-<number>: <phase name>
- Tasks: <which TASK-N ids belong to this phase>
- Goal: <what this phase achieves>
- Risk: <main risk for this phase>

Output ONLY the phases.`,
      "planner"
    );

    PHASE_RE.lastIndex = 0;
    const phases: Array<{ name: string; taskIds: string[] }> = [];
    let phaseMatch: RegExpExecArray | null = PHASE_RE.exec(phaseResult.output);

    while (phaseMatch !== null) {
      const name = phaseMatch[2]?.trim() ?? `Phase ${phases.length + 1}`;
      const startPos = phaseMatch.index + phaseMatch[0].length;
      const nextPhase = phaseResult.output.indexOf("PHASE-", startPos);
      const blockEnd = nextPhase > -1 ? nextPhase : phaseResult.output.length;
      const block = phaseResult.output.slice(startPos, blockEnd);
      const taskIds = block.match(TASK_ID_RE) ?? [];
      phases.push({ name, taskIds });
      phaseMatch = PHASE_RE.exec(phaseResult.output);
    }

    if (phases.length >= 2 && topNode.plan) {
      for (const phase of phases) {
        const phaseNode: MCTSNode = {
          id: `${topNode.id}-phase-${phase.name.replace(/\s+/g, "-").toLowerCase()}`,
          strategy: `${topNode.strategy} > ${phase.name}`,
          plan: null,
          score: topNode.score,
          visits: 1,
          children: [],
          parent: topNode,
          depth: 2,
        };
        topNode.children.push(phaseNode);
      }

      topNode.plan.parallelWorkstreams = phases.map((p) => p.taskIds);

      logger.info(
        {
          strategy: topNode.strategy,
          phaseCount: phases.length,
          phases: phases.map((p) => p.name),
        },
        "Depth-2 sub-phase expansion complete"
      );
    }
  }

  // ─── LLM Review Scoring ────────────────────────────────────────────

  /**
   * Use the "review" slot to have an LLM evaluate the quality of
   * the top plans, providing a more nuanced score than heuristics alone.
   */
  private async llmReviewScoring(
    agentLoop: AgentLoop,
    root: MCTSNode
  ): Promise<void> {
    const candidates = root.children
      .filter((c) => c.plan !== null && c.visits > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    for (const node of candidates) {
      if (!node.plan || this.llmCallCount >= this.config.maxLLMCalls) {
        break;
      }

      this.llmCallCount++;

      const planSummary = node.plan.tasks
        .map(
          (t) =>
            `${t.id}: ${t.title} (${t.agentRole}, ${t.effort}, deps: ${t.dependencies.join(",") || "none"})`
        )
        .join("\n");

      const reviewResult = await agentLoop.executeTask(
        `Review this sprint plan for quality, completeness, and feasibility.

Sprint Goal: ${node.plan.sprintGoal}
Strategy: ${node.strategy}

Tasks:
${planSummary}

Parallel Workstreams: ${node.plan.parallelWorkstreams.length}
Critical Path Length: ${node.plan.criticalPath.length}

Rate this plan on a scale of 0.0 to 1.0 considering:
1. Task decomposition quality (are tasks well-scoped?)
2. Dependency correctness (do dependencies make sense?)
3. Parallelism efficiency (can work be parallelized well?)
4. Risk coverage (are major risks addressed?)
5. Agent role assignment (are the right specialists assigned?)

Output your assessment as:
SCORE: <0.0-1.0>
REASONING: <brief explanation>`,
        "planner"
      );

      const scoreMatch = reviewResult.output.match(SCORE_RE);
      if (scoreMatch?.[1]) {
        const llmScore = Math.max(
          0,
          Math.min(1, Number.parseFloat(scoreMatch[1]))
        );
        if (!Number.isNaN(llmScore)) {
          const blendedScore = node.score * 0.6 + llmScore * 0.4;
          logger.debug(
            {
              strategy: node.strategy,
              heuristicScore: node.score.toFixed(3),
              llmScore: llmScore.toFixed(3),
              blendedScore: blendedScore.toFixed(3),
            },
            "LLM review score blended"
          );
          node.score = blendedScore;
        }
      }
    }
  }

  // ─── Convention-Driven Scoring ─────────────────────────────────────

  /**
   * Score a plan's compliance with project conventions.
   * Returns a value between 0 and 1, where 1 is fully compliant.
   * Weight: 0.15 in the overall scoring heuristic.
   */
  private scoreConventionCompliance(plan: SprintPlan): number {
    const conventions = this.config.conventions;
    if (!conventions) {
      return 1.0;
    }

    const allRules: string[] = [
      ...(conventions.namingPatterns ?? []),
      ...(conventions.structuralPatterns ?? []),
      ...(conventions.toolingPatterns ?? []),
      ...(conventions.fileOrganization ?? []),
      ...(conventions.customRules ?? []),
    ];

    if (allRules.length === 0) {
      return 1.0;
    }

    let totalChecks = 0;
    let violations = 0;

    const planText = [
      plan.sprintGoal,
      ...plan.tasks.flatMap((t) => [
        t.title,
        t.description,
        ...t.acceptanceCriteria,
      ]),
    ]
      .join(" ")
      .toLowerCase();

    for (const rule of allRules) {
      totalChecks++;
      violations += scoreRuleViolation(rule.toLowerCase(), planText);
    }

    const complianceRate =
      totalChecks > 0 ? Math.max(0, 1 - violations / totalChecks) : 1.0;

    return complianceRate;
  }

  // ─── Plan Caching ─────────────────────────────────────────────────

  /**
   * Look for a cached plan whose task description is sufficiently
   * similar (>= 0.7 Jaccard) to the current one.
   */
  private findCachedPlan(taskDescription: string): CachedPlan | null {
    const now = Date.now();

    for (const [hash, cached] of MCTSPlanner.planCache) {
      if (now - cached.createdAt > PLAN_CACHE_TTL_MS) {
        MCTSPlanner.planCache.delete(hash);
        continue;
      }

      const similarity = computeTaskSimilarity(
        taskDescription,
        cached.plan.sprintGoal
      );
      if (similarity >= 0.7) {
        return cached;
      }
    }

    return null;
  }

  /** Cache a successful plan keyed by task similarity hash. */
  private cachePlan(
    taskDescription: string,
    plan: SprintPlan,
    strategy: string,
    score: number
  ): void {
    const taskHash = computeTaskHash(taskDescription);

    if (MCTSPlanner.planCache.size >= MAX_PLAN_CACHE_SIZE) {
      let oldestKey: string | null = null;
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [key, entry] of MCTSPlanner.planCache) {
        if (entry.createdAt < oldestTime) {
          oldestTime = entry.createdAt;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        MCTSPlanner.planCache.delete(oldestKey);
      }
    }

    MCTSPlanner.planCache.set(taskHash, {
      plan,
      strategy,
      score,
      taskHash,
      createdAt: Date.now(),
    });

    logger.debug(
      { taskHash, strategy, cacheSize: MCTSPlanner.planCache.size },
      "Plan cached for future reuse"
    );
  }

  /** Clear the plan cache. Useful for testing or when conventions change. */
  static clearPlanCache(): void {
    MCTSPlanner.planCache.clear();
    logger.info("Plan cache cleared");
  }

  // ─── Strategy Generation ───────────────────────────────────────────

  /**
   * Generate candidate planning strategies using the think slot.
   */
  private async generateStrategies(
    agentLoop: AgentLoop,
    blueprint: string,
    taskDescription: string
  ): Promise<Array<{ name: string; description: string }>> {
    this.llmCallCount++;

    const result = await agentLoop.executeTask(
      `You are a planning strategist. Given this task and blueprint, generate exactly ${this.config.expansionWidth} DIFFERENT implementation strategies.

Task: ${taskDescription}

Blueprint (summary):
${blueprint.slice(0, 3000)}

For each strategy, provide:
STRATEGY: <name>
APPROACH: <1-2 sentence description of the approach>
RATIONALE: <why this approach might be best>

Strategies should differ meaningfully:
- Strategy 1: Start with the data model and API, then build UI on top
- Strategy 2: Start with UI components and mock data, then wire backend
- Strategy 3: Start with critical path features end-to-end, then expand

Generate exactly ${this.config.expansionWidth} strategies.`,
      "planner"
    );

    const strategies: Array<{ name: string; description: string }> = [];
    STRATEGY_RE.lastIndex = 0;
    const strategyMatches = result.output.matchAll(STRATEGY_RE);

    for (const match of strategyMatches) {
      strategies.push({
        name: match[1]?.trim() ?? `Strategy ${strategies.length + 1}`,
        description: "",
      });
    }

    if (strategies.length < 2) {
      strategies.push(
        {
          name: "API-First",
          description: "Build backend APIs first, then frontend",
        },
        {
          name: "UI-First",
          description: "Build UI components with mocks, then wire backend",
        },
        {
          name: "Feature-Slice",
          description: "Build each feature end-to-end vertically",
        }
      );
    }

    return strategies.slice(0, this.config.expansionWidth);
  }

  // ─── Simulation ────────────────────────────────────────────────────

  /**
   * Simulate a strategy by asking the planner to create a plan
   * following that specific approach, then scoring it.
   */
  private async simulate(
    agentLoop: AgentLoop,
    strategy: string,
    blueprint: string,
    taskDescription: string
  ): Promise<{ score: number; plan: SprintPlan }> {
    this.llmCallCount++;

    const planResult = await agentLoop.executeTask(
      `Create a sprint plan using the "${strategy}" strategy.

Task: ${taskDescription}

Blueprint:
${blueprint.slice(0, 4000)}

Strategy to follow: ${strategy}

Generate a sprint plan with this EXACT format:

## SPRINT_GOAL
A single sentence describing the primary deliverable.

## TASKS
For each task:
TASK-<number>: <title>
- Description: <what needs to be done>
- Agent: <frontend_coder|backend_coder|integration_coder|test_engineer|deploy_engineer>
- Dependencies: <TASK-N ids or "none">
- Effort: <S|M|L|XL>
- Acceptance Criteria:
  - <criterion>

## PARALLEL_WORKSTREAMS
- Stream 1: TASK-1, TASK-2
- Stream 2: TASK-3

## CRITICAL_PATH
TASK-1 -> TASK-3 -> TASK-5

## RISK_MITIGATIONS
- Risk: <description>
  Mitigation: <strategy>`,
      "planner"
    );

    const plan = this.parsePlanFromOutput(planResult.output, taskDescription);

    // Weighted scoring: heuristic (85%) + convention compliance (15%)
    const heuristicScore = this.scorePlan(plan);
    const conventionScore = this.scoreConventionCompliance(plan);
    const score = heuristicScore * 0.85 + conventionScore * 0.15;

    return { score, plan };
  }

  /**
   * Score a plan on multiple dimensions using heuristics.
   */
  private scorePlan(plan: SprintPlan): number {
    let score = 0;

    const taskCount = plan.tasks.length;
    if (taskCount >= 3 && taskCount <= 15) {
      score += 0.2;
    } else if (taskCount > 0) {
      score += 0.1;
    }

    const streamCount = plan.parallelWorkstreams.length;
    score += Math.min(streamCount * 0.05, 0.15);

    const tasksWithDeps = plan.tasks.filter(
      (t) => t.dependencies.length > 0
    ).length;
    score += Math.min((tasksWithDeps / Math.max(taskCount, 1)) * 0.15, 0.15);

    const tasksWithAC = plan.tasks.filter(
      (t) => t.acceptanceCriteria.length > 0
    ).length;
    score += (tasksWithAC / Math.max(taskCount, 1)) * 0.15;

    score += Math.min(plan.riskMitigations.length * 0.05, 0.1);

    const uniqueRoles = new Set(plan.tasks.map((t) => t.agentRole));
    score += Math.min(uniqueRoles.size * 0.05, 0.15);

    if (plan.criticalPath.length > 0) {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  /**
   * Select the best child node using UCB1.
   */
  private selectBest(root: MCTSNode): MCTSNode | null {
    if (root.children.length === 0) {
      return null;
    }

    let best: MCTSNode | null = null;
    let bestUCB = Number.NEGATIVE_INFINITY;

    for (const child of root.children) {
      if (child.visits === 0) {
        continue;
      }

      const exploitation = child.score / child.visits;
      const exploration =
        this.config.explorationConstant *
        Math.sqrt(Math.log(root.visits) / child.visits);
      const ucb = exploitation + exploration;

      if (ucb > bestUCB) {
        bestUCB = ucb;
        best = child;
      }
    }

    return best;
  }

  /**
   * Parse a plan from LLM output using regex patterns
   * matching the SprintPlan interface format.
   */
  private parsePlanFromOutput(
    output: string,
    fallbackTitle: string
  ): SprintPlan {
    const tasks: SprintPlan["tasks"] = [];

    TASK_HEADER_RE.lastIndex = 0;
    let match: RegExpExecArray | null = TASK_HEADER_RE.exec(output);
    while (match !== null) {
      const id = `TASK-${match[1]}`;
      const title = match[2]?.trim() ?? "";

      const startPos = match.index + match[0].length;
      const nextTask = output.indexOf("TASK-", startPos);
      const nextSection = output.indexOf("##", startPos);
      const endPos = Math.min(
        nextTask > -1 ? nextTask : output.length,
        nextSection > -1 ? nextSection : output.length
      );
      const block = output.slice(startPos, endPos);

      tasks.push(
        parseTaskBlockFromOutput(
          block,
          id,
          title,
          AGENT_RE,
          DEPS_RE,
          EFFORT_RE,
          AC_RE,
          TASK_ID_RE,
          LIST_BULLET_PREFIX_RE,
          ROLE_MAP
        )
      );
      match = TASK_HEADER_RE.exec(output);
    }

    if (tasks.length === 0) {
      tasks.push({
        id: "TASK-1",
        title: fallbackTitle,
        description: fallbackTitle,
        agentRole: "backend_coder",
        dependencies: [],
        effort: "M",
        acceptanceCriteria: ["Feature implemented"],
      });
    }

    const workstreams: string[][] = [];
    const wsSection = output.match(WORKSTREAMS_RE);
    if (wsSection) {
      for (const line of wsSection[0].split("\n")) {
        const ids = line.match(TASK_ID_RE);
        if (ids && ids.length > 0) {
          workstreams.push(ids);
        }
      }
    }

    const cpSection = output.match(CRITICAL_PATH_RE);
    const criticalPath = cpSection
      ? (cpSection[0].match(TASK_ID_RE) ?? [])
      : [];

    const goalMatch = output.match(SPRINT_GOAL_RE);

    return {
      sprintGoal: goalMatch?.[1]?.trim() ?? fallbackTitle,
      tasks,
      parallelWorkstreams: workstreams,
      criticalPath,
      riskMitigations: [],
    };
  }
}
