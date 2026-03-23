/**
 * Predictive Task Decomposition
 *
 * Predicts sub-tasks and agent role assignments before execution
 * using historical task patterns and keyword analysis.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:predictive-decomposer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplexityEstimate = "S" | "M" | "L" | "XL";

export interface SubTask {
  agentRole: string;
  complexity: ComplexityEstimate;
  dependencies: string[];
  description: string;
  id: string;
}

export interface DecompositionResult {
  confidence: number;
  estimatedTotalComplexity: ComplexityEstimate;
  subTasks: SubTask[];
}

// ---------------------------------------------------------------------------
// Keyword patterns for decomposition
// ---------------------------------------------------------------------------

const FRONTEND_RE =
  /\b(component|page|ui|ux|frontend|react|next\.?js|tailwind|css|layout|form)\b/i;
const BACKEND_RE =
  /\b(api|endpoint|route|controller|service|middleware|database|query|migration|trpc|crud)\b/i;
const TESTING_RE =
  /\b(tests?|specs?|coverage|vitest|playwright|e2e|unit tests?|integration)\b/i;
const DEPLOY_RE =
  /\b(deploy|docker|kubernetes|k8s|ci.?cd|github action|helm)\b/i;
const SECURITY_RE =
  /\b(security|audit|vulnerabilit|owasp|injection|xss|csrf|auth)\b/i;
const FULL_STACK_RE = /\b(full.?stack|end.?to.?end|complete|entire|whole)\b/i;
const REFACTOR_RE = /\b(refactor|restructure|reorganize|clean.?up|simplify)\b/i;
const DATA_RE =
  /\b(database|schema|migration|model|table|column|index|seed)\b/i;

// Historical pattern storage
interface HistoricalPattern {
  avgSubTasks: number;
  complexity: ComplexityEstimate;
  roles: string[];
  taskPattern: string;
}

// ---------------------------------------------------------------------------
// PredictiveDecomposer
// ---------------------------------------------------------------------------

export class PredictiveDecomposer {
  private readonly history: HistoricalPattern[] = [];
  private taskCounter = 0;

  /**
   * Decompose a task description into predicted sub-tasks.
   */
  decompose(taskDescription: string): DecompositionResult {
    const desc = taskDescription.toLowerCase();

    // Check historical patterns first
    const historical = this.findHistoricalMatch(desc);
    const baseConfidence = historical ? 0.8 : 0.6;

    // Generate core sub-tasks based on task type
    const { subTasks, confidence } = this.generateCoreSubTasks(
      desc,
      baseConfidence
    );

    // Add optional sub-tasks based on keywords
    this.appendOptionalSubTasks(subTasks, desc);

    const totalComplexity = this.aggregateComplexity(subTasks);

    logger.info(
      {
        subTaskCount: subTasks.length,
        totalComplexity,
        confidence: confidence.toFixed(2),
      },
      "Task decomposed"
    );

    return {
      subTasks,
      confidence,
      estimatedTotalComplexity: totalComplexity,
    };
  }

  private buildFullStackSubTasks(): SubTask[] {
    const subTasks: SubTask[] = [];
    subTasks.push(
      this.createSubTask(
        "Discovery and requirements analysis",
        "discovery",
        "S",
        []
      ),
      this.createSubTask("Architecture design", "architect", "M", [
        subTasks[0]?.id ?? "",
      ]),
      this.createSubTask("Backend API implementation", "backend_coder", "L", [
        subTasks[1]?.id ?? "",
      ]),
      this.createSubTask("Frontend UI implementation", "frontend_coder", "L", [
        subTasks[1]?.id ?? "",
      ]),
      this.createSubTask("Integration and wiring", "integration_coder", "M", [
        subTasks[2]?.id ?? "",
        subTasks[3]?.id ?? "",
      ]),
      this.createSubTask("Testing", "test_engineer", "M", [
        subTasks[4]?.id ?? "",
      ])
    );
    return subTasks;
  }

  private buildThreePhaseSubTasks(
    designTitle: string,
    designRole: string,
    implTitle: string,
    implRole: string,
    testTitle: string
  ): SubTask[] {
    const subTasks: SubTask[] = [];
    subTasks.push(
      this.createSubTask(designTitle, designRole, "S", []),
      this.createSubTask(implTitle, implRole, "M", [subTasks[0]?.id ?? ""]),
      this.createSubTask(testTitle, "test_engineer", "S", [
        subTasks[1]?.id ?? "",
      ])
    );
    return subTasks;
  }

  private generateCoreSubTasks(
    desc: string,
    baseConfidence: number
  ): { subTasks: SubTask[]; confidence: number } {
    const isFullStack = FULL_STACK_RE.test(desc);

    if (isFullStack || (FRONTEND_RE.test(desc) && BACKEND_RE.test(desc))) {
      return { subTasks: this.buildFullStackSubTasks(), confidence: 0.8 };
    }

    if (FRONTEND_RE.test(desc)) {
      return {
        subTasks: this.buildThreePhaseSubTasks(
          "UI component design",
          "architect",
          "Frontend implementation",
          "frontend_coder",
          "Frontend tests"
        ),
        confidence: baseConfidence,
      };
    }

    if (BACKEND_RE.test(desc)) {
      return {
        subTasks: this.buildThreePhaseSubTasks(
          "API design",
          "architect",
          "Backend implementation",
          "backend_coder",
          "Backend tests"
        ),
        confidence: baseConfidence,
      };
    }

    if (REFACTOR_RE.test(desc)) {
      return {
        subTasks: this.buildThreePhaseSubTasks(
          "Analyze current code",
          "discovery",
          "Refactor implementation",
          "backend_coder",
          "Verify tests pass"
        ),
        confidence: baseConfidence,
      };
    }

    if (DATA_RE.test(desc)) {
      return {
        subTasks: this.buildThreePhaseSubTasks(
          "Schema design",
          "architect",
          "Migration implementation",
          "backend_coder",
          "Data validation tests"
        ),
        confidence: baseConfidence,
      };
    }

    // Generic decomposition
    const subTasks: SubTask[] = [];
    subTasks.push(
      this.createSubTask("Analyze and plan", "discovery", "S", []),
      this.createSubTask("Implementation", "backend_coder", "M", [
        subTasks[0]?.id ?? "",
      ])
    );
    return { subTasks, confidence: 0.5 };
  }

  private appendOptionalSubTasks(subTasks: SubTask[], desc: string): void {
    if (SECURITY_RE.test(desc)) {
      const lastTask = subTasks.at(-1);
      subTasks.push(
        this.createSubTask("Security audit", "security_auditor", "S", [
          lastTask?.id ?? "",
        ])
      );
    }

    if (
      TESTING_RE.test(desc) &&
      !subTasks.some((t) => t.agentRole === "test_engineer")
    ) {
      const lastTask = subTasks.at(-1);
      subTasks.push(
        this.createSubTask("Write tests", "test_engineer", "M", [
          lastTask?.id ?? "",
        ])
      );
    }

    if (DEPLOY_RE.test(desc)) {
      const lastTask = subTasks.at(-1);
      subTasks.push(
        this.createSubTask("Deployment configuration", "deploy_engineer", "S", [
          lastTask?.id ?? "",
        ])
      );
    }
  }

  /**
   * Predict agent roles for a set of sub-tasks.
   */
  predictAgentRoles(
    subTasks: SubTask[]
  ): Array<{ subTaskId: string; agentRole: string }> {
    return subTasks.map((st) => ({
      subTaskId: st.id,
      agentRole: st.agentRole,
    }));
  }

  /**
   * Estimate complexity of a single sub-task.
   */
  estimateComplexity(subTask: SubTask): ComplexityEstimate {
    return subTask.complexity;
  }

  /**
   * Get prediction confidence based on historical data.
   */
  getConfidence(): number {
    return this.history.length > 5 ? 0.8 : 0.6;
  }

  /**
   * Record a historical pattern for future predictions.
   */
  recordPattern(
    taskPattern: string,
    roles: string[],
    complexity: ComplexityEstimate,
    subTaskCount: number
  ): void {
    this.history.push({
      taskPattern,
      roles,
      complexity,
      avgSubTasks: subTaskCount,
    });
  }

  // -----------------------------------------------------------------------
  // Internal Helpers
  // -----------------------------------------------------------------------

  private createSubTask(
    description: string,
    agentRole: string,
    complexity: ComplexityEstimate,
    dependencies: string[]
  ): SubTask {
    this.taskCounter++;
    return {
      id: `subtask-${this.taskCounter}`,
      description,
      agentRole,
      complexity,
      dependencies: dependencies.filter(Boolean),
    };
  }

  private findHistoricalMatch(desc: string): HistoricalPattern | null {
    for (const pattern of this.history) {
      if (desc.includes(pattern.taskPattern.toLowerCase())) {
        return pattern;
      }
    }
    return null;
  }

  private aggregateComplexity(subTasks: SubTask[]): ComplexityEstimate {
    const weights: Record<ComplexityEstimate, number> = {
      S: 1,
      M: 3,
      L: 5,
      XL: 8,
    };

    let total = 0;
    for (const st of subTasks) {
      total += weights[st.complexity];
    }

    if (total <= 3) {
      return "S";
    }
    if (total <= 8) {
      return "M";
    }
    if (total <= 16) {
      return "L";
    }
    return "XL";
  }
}
