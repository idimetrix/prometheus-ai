import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import type { SprintPlan } from "../phases/planning";

const logger = createLogger("orchestrator:mcts");

const LIST_BULLET_PREFIX_RE = /^\s*[-*]\s*/;

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

/** Configuration for MCTS planning */
export interface MCTSConfig {
  /** Number of candidate strategies to explore. Default: 3 */
  expansionWidth?: number;
  /** UCB1 exploration constant. Default: 1.41 */
  explorationConstant?: number;
  /** Maximum tree depth (Strategy→Phase→Task→Subtask). Default: 4 */
  maxDepth?: number;
  /** Maximum total LLM calls for planning. Default: 10 */
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
  selectedPlan: SprintPlan;
  selectedStrategy: string;
  totalSimulations: number;
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

/**
 * MCTSPlanner uses Monte Carlo Tree Search to explore multiple planning
 * strategies and select the highest-confidence approach.
 *
 * The tree has 3 levels:
 * 1. Strategy (e.g., "API-first", "UI-first", "data-model-first")
 * 2. Phase decomposition (how to break the strategy into phases)
 * 3. Task decomposition (individual tasks within phases)
 *
 * Each node is scored using a lightweight simulation (think slot)
 * that estimates complexity, risk, and quality without executing.
 */
export class MCTSPlanner {
  private readonly config: Required<MCTSConfig>;
  private llmCallCount = 0;

  constructor(config: MCTSConfig = {}) {
    this.config = {
      maxDepth: config.maxDepth ?? 4,
      pruneThreshold: config.pruneThreshold ?? 0.3,
      expansionWidth: config.expansionWidth ?? 3,
      simulationRounds: config.simulationRounds ?? 2,
      explorationConstant: config.explorationConstant ?? 1.41,
      maxLLMCalls: config.maxLLMCalls ?? 10,
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
      },
      "Starting MCTS planning"
    );

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

    // Phase 2: Simulate - Evaluate each strategy
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

      // Backpropagate score to root
      root.score += simulation.score;
      root.visits++;
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

    // Phase 3: Select best strategy using UCB1
    const best = this.selectBest(root);

    if (!best?.plan) {
      // Fallback: run the standard planning phase
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

    logger.info(
      {
        selectedStrategy: best.strategy,
        score: best.score,
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
    };
  }

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

    // Ensure we have at least 2 strategies
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

    // Generate a plan following this strategy
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

    // Parse the plan
    const plan = this.parsePlanFromOutput(planResult.output, taskDescription);

    // Score the plan
    const score = this.scorePlan(plan);

    return { score, plan };
  }

  /**
   * Score a plan on multiple dimensions using heuristics.
   */
  private scorePlan(plan: SprintPlan): number {
    let score = 0;

    // Task count: prefer 3-15 tasks (too few = missing work, too many = over-decomposed)
    const taskCount = plan.tasks.length;
    if (taskCount >= 3 && taskCount <= 15) {
      score += 0.2;
    } else if (taskCount > 0) {
      score += 0.1;
    }

    // Parallel workstreams: more = faster execution
    const streamCount = plan.parallelWorkstreams.length;
    score += Math.min(streamCount * 0.05, 0.15);

    // Dependency coverage: tasks with deps show proper ordering
    const tasksWithDeps = plan.tasks.filter(
      (t) => t.dependencies.length > 0
    ).length;
    score += Math.min((tasksWithDeps / Math.max(taskCount, 1)) * 0.15, 0.15);

    // Acceptance criteria: tasks with criteria are better defined
    const tasksWithAC = plan.tasks.filter(
      (t) => t.acceptanceCriteria.length > 0
    ).length;
    score += (tasksWithAC / Math.max(taskCount, 1)) * 0.15;

    // Risk mitigations: shows foresight
    score += Math.min(plan.riskMitigations.length * 0.05, 0.1);

    // Agent diversity: using multiple roles shows proper decomposition
    const uniqueRoles = new Set(plan.tasks.map((t) => t.agentRole));
    score += Math.min(uniqueRoles.size * 0.05, 0.15);

    // Critical path exists and is reasonable
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

      // Extract block until next TASK- or ##
      const startPos = match.index + match[0].length;
      const nextTask = output.indexOf("TASK-", startPos);
      const nextSection = output.indexOf("##", startPos);
      const endPos = Math.min(
        nextTask > -1 ? nextTask : output.length,
        nextSection > -1 ? nextSection : output.length
      );
      const block = output.slice(startPos, endPos);

      const agentMatch = block.match(AGENT_RE);
      const depsMatch = block.match(DEPS_RE);
      const effortMatch = block.match(EFFORT_RE);

      const depsStr = depsMatch?.[1]?.trim() ?? "none";
      const deps: string[] = [];
      if (depsStr.toLowerCase() !== "none") {
        const depIds = depsStr.match(TASK_ID_RE);
        if (depIds) {
          deps.push(...depIds);
        }
      }

      const acLines: string[] = [];
      const acMatch = block.match(AC_RE);
      if (acMatch?.[1]) {
        for (const line of acMatch[1].split("\n")) {
          const cleaned = line.replace(LIST_BULLET_PREFIX_RE, "").trim();
          if (cleaned.length > 0) {
            acLines.push(cleaned);
          }
        }
      }

      tasks.push({
        id,
        title,
        description: title,
        agentRole:
          ROLE_MAP[agentMatch?.[1]?.toLowerCase() ?? "backend"] ??
          "backend_coder",
        dependencies: deps,
        effort: (effortMatch?.[1]?.toUpperCase() ?? "M") as
          | "S"
          | "M"
          | "L"
          | "XL",
        acceptanceCriteria:
          acLines.length > 0 ? acLines : [`${title} works correctly`],
      });
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

    // Extract parallel workstreams
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

    // Extract critical path
    const cpSection = output.match(CRITICAL_PATH_RE);
    const criticalPath = cpSection
      ? (cpSection[0].match(TASK_ID_RE) ?? [])
      : [];

    // Extract goal
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
