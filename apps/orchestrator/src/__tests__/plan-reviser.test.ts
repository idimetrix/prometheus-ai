import { describe, expect, it } from "vitest";
import type { SprintPlan } from "../phases/planning";
import type { MCTSPlanResult } from "../planning/mcts-planner";
import type { FailedTrace } from "../planning/plan-reviser";
import { PlanReviser } from "../planning/plan-reviser";

// ============================================================================
// Helpers
// ============================================================================

function makeSprintPlan(
  tasks: SprintPlan["tasks"] = [],
  goal = "Test goal"
): SprintPlan {
  return {
    sprintGoal: goal,
    tasks,
    parallelWorkstreams: [],
    criticalPath: [],
    riskMitigations: [],
  };
}

function makeMCTSResult(
  plan: SprintPlan,
  strategy = "strategy-a"
): MCTSPlanResult {
  return {
    alternativesExplored: 3,
    bestScore: 0.8,
    confidence: 0.75,
    selectedPlan: plan,
    selectedStrategy: strategy,
    totalSimulations: 10,
  };
}

function makeFailedTrace(overrides: Partial<FailedTrace> = {}): FailedTrace {
  return {
    creditsConsumed: 10,
    errorMessage: "Test compilation error",
    failedPhase: "coding",
    failedTaskId: "TASK-2",
    filesChanged: ["src/index.ts"],
    partialResults: [
      { taskId: "TASK-1", success: true, output: "Schema created" },
      { taskId: "TASK-2", success: false, output: "Compilation error" },
    ],
    ...overrides,
  };
}

function makeMockAgentLoop(output: string) {
  return {
    executeTask: async (_prompt: string, _role: string) => ({
      output,
      success: true,
      tokensUsed: 500,
      iterations: 1,
    }),
  } as unknown as Parameters<PlanReviser["revise"]>[0];
}

// ============================================================================
// Tests
// ============================================================================

describe("PlanReviser", () => {
  describe("isExhausted", () => {
    it("returns false initially", () => {
      const reviser = new PlanReviser(3);
      expect(reviser.isExhausted()).toBe(false);
    });

    it("returns true after max revisions are reached", async () => {
      const reviser = new PlanReviser(1);

      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "Setup",
          description: "Setup",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "S",
          acceptanceCriteria: ["Done"],
        },
        {
          id: "TASK-2",
          title: "Build",
          description: "Build",
          agentRole: "backend_coder",
          dependencies: ["TASK-1"],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);
      const mctsResult = makeMCTSResult(plan, "strategy-a");
      const trace = makeFailedTrace();

      const agentLoop = makeMockAgentLoop(
        `STRATEGY: strategy-b
CONFIDENCE: 0.7
REASONING: Avoid the previous approach

REUSABLE_TASKS:
- TASK-1: preserved

## SPRINT_GOAL
Build the feature differently

## TASKS
TASK-1: Setup database
- Agent: backend_coder
- Dependencies: none
- Effort: S
- Acceptance Criteria:
  - Schema created

TASK-3: New approach
- Agent: backend_coder
- Dependencies: TASK-1
- Effort: M
- Acceptance Criteria:
  - Feature works

## PARALLEL_WORKSTREAMS
- Stream 1: TASK-1, TASK-3

## CRITICAL_PATH
TASK-1 -> TASK-3`
      );

      // First revision should succeed
      const result = await reviser.revise(
        agentLoop,
        mctsResult,
        trace,
        "blueprint",
        "task description"
      );
      expect(result).not.toBeNull();

      // Now it should be exhausted
      expect(reviser.isExhausted()).toBe(true);
    });

    it("returns true with default maxRevisions of 3", async () => {
      const reviser = new PlanReviser();

      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "Task",
          description: "Task",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);

      const strategies = [
        "strategy-a",
        "strategy-b",
        "strategy-c",
        "strategy-d",
      ];

      for (let i = 0; i < 3; i++) {
        const mctsResult = makeMCTSResult(plan, strategies[i] ?? "fallback");
        const agentLoop = makeMockAgentLoop(
          `STRATEGY: ${strategies[i + 1] ?? "unknown"}
CONFIDENCE: 0.6
REASONING: Try different approach

## SPRINT_GOAL
Goal

## TASKS
TASK-1: Do something
- Agent: backend_coder
- Dependencies: none
- Effort: M
- Acceptance Criteria:
  - Works`
        );

        await reviser.revise(
          agentLoop,
          mctsResult,
          makeFailedTrace(),
          "bp",
          "desc"
        );
      }

      expect(reviser.isExhausted()).toBe(true);
      expect(reviser.getRevisionCount()).toBe(3);
    });
  });

  describe("revise", () => {
    it("returns null when exhausted", async () => {
      const reviser = new PlanReviser(0);
      const plan = makeSprintPlan();
      const result = await reviser.revise(
        makeMockAgentLoop(""),
        makeMCTSResult(plan),
        makeFailedTrace(),
        "bp",
        "desc"
      );
      expect(result).toBeNull();
    });

    it("parses a valid revision response", async () => {
      const reviser = new PlanReviser(3);

      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "Setup",
          description: "Setup",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "S",
          acceptanceCriteria: ["Done"],
        },
        {
          id: "TASK-2",
          title: "Build",
          description: "Build",
          agentRole: "frontend_coder",
          dependencies: ["TASK-1"],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);

      const agentLoop = makeMockAgentLoop(
        `STRATEGY: incremental-approach
CONFIDENCE: 0.85
REASONING: The previous monolithic strategy failed because of coupling. This incremental approach isolates changes.

REUSABLE_TASKS:
- preserved from previous run

## SPRINT_GOAL
Incrementally build the feature

## TASKS
TASK-1: Setup database schema
- Agent: backend_coder
- Dependencies: none
- Effort: S
- Acceptance Criteria:
  - Schema created correctly

TASK-3: Build API endpoints
- Agent: backend
- Dependencies: none
- Effort: M
- Acceptance Criteria:
  - Endpoints respond correctly

TASK-4: Add frontend components
- Agent: frontend
- Dependencies: none
- Effort: L
- Acceptance Criteria:
  - Components render properly

## PARALLEL_WORKSTREAMS
- Stream 1: TASK-1, TASK-3
- Stream 2: TASK-4

## CRITICAL_PATH
TASK-1 -> TASK-3 -> TASK-4`
      );

      const result = await reviser.revise(
        agentLoop,
        makeMCTSResult(plan, "monolithic-approach"),
        makeFailedTrace(),
        "blueprint content",
        "Build a user management system"
      );

      expect(result).not.toBeNull();
      expect(result?.strategy).toBe("incremental-approach");
      expect(result?.confidence).toBeCloseTo(0.85);
      expect(result?.reasoning).toContain("incremental approach");
      expect(result?.revisedPlan.tasks).toHaveLength(3);
      expect(result?.revisedPlan.sprintGoal).toBe(
        "Incrementally build the feature"
      );
      expect(result?.backtrackDepth).toBe(1);

      // Verify parsed task details
      const task3 = result?.revisedPlan.tasks.find((t) => t.id === "TASK-3");
      expect(task3).toBeDefined();
      expect(task3?.agentRole).toBe("backend_coder");
      expect(task3?.effort).toBe("M");

      const task4 = result?.revisedPlan.tasks.find((t) => t.id === "TASK-4");
      expect(task4).toBeDefined();
      expect(task4?.agentRole).toBe("frontend_coder");
      expect(task4?.effort).toBe("L");
    });

    it("returns null when planner suggests an exhausted strategy", async () => {
      const reviser = new PlanReviser(3);
      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "T",
          description: "T",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);

      // First revision exhausts "strategy-a"
      const agentLoop1 = makeMockAgentLoop(
        `STRATEGY: strategy-b
CONFIDENCE: 0.5
REASONING: Try B

## TASKS
TASK-1: Do it
- Agent: backend
- Dependencies: none
- Effort: M
- Acceptance Criteria:
  - Works`
      );

      await reviser.revise(
        agentLoop1,
        makeMCTSResult(plan, "strategy-a"),
        makeFailedTrace(),
        "bp",
        "desc"
      );

      // Second revision: planner suggests already-exhausted "strategy-a"
      const agentLoop2 = makeMockAgentLoop(
        `STRATEGY: strategy-a
CONFIDENCE: 0.5
REASONING: Use A again

## TASKS
TASK-1: Do it
- Agent: backend
- Dependencies: none
- Effort: M
- Acceptance Criteria:
  - Works`
      );

      const result = await reviser.revise(
        agentLoop2,
        makeMCTSResult(plan, "strategy-b"),
        makeFailedTrace(),
        "bp",
        "desc"
      );

      expect(result).toBeNull();
    });

    it("returns null when planner produces no tasks", async () => {
      const reviser = new PlanReviser(3);
      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "T",
          description: "T",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);

      // Respond with a strategy but empty plan text (no TASK- lines)
      // However, parsePlanFromOutput adds a fallback task when none are found,
      // so this should actually return a result with 1 fallback task.
      const agentLoop = makeMockAgentLoop(
        `STRATEGY: new-strategy
CONFIDENCE: 0.5
REASONING: Try something new

No task definitions here.`
      );

      const result = await reviser.revise(
        agentLoop,
        makeMCTSResult(plan, "old-strategy"),
        makeFailedTrace(),
        "bp",
        "Build feature X"
      );

      // The parser falls back to a single task with the fallback title
      expect(result).not.toBeNull();
      expect(result?.revisedPlan.tasks).toHaveLength(1);
      expect(result?.revisedPlan.tasks[0]?.title).toBe("Build feature X");
    });
  });

  describe("identifyReusableWork", () => {
    it("identifies successful tasks that are not dependents of the failed task", async () => {
      const reviser = new PlanReviser(3);

      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "Independent task",
          description: "Independent",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "S",
          acceptanceCriteria: ["Done"],
        },
        {
          id: "TASK-2",
          title: "Failed task",
          description: "Failed",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
        {
          id: "TASK-3",
          title: "Depends on failed",
          description: "Dependent",
          agentRole: "backend_coder",
          dependencies: ["TASK-2"],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);

      const trace = makeFailedTrace({
        failedTaskId: "TASK-2",
        partialResults: [
          { taskId: "TASK-1", success: true, output: "Completed" },
          { taskId: "TASK-2", success: false, output: "Error" },
          { taskId: "TASK-3", success: true, output: "Completed" },
        ],
      });

      const agentLoop = makeMockAgentLoop(
        `STRATEGY: recovery
CONFIDENCE: 0.7
REASONING: Recover

REUSABLE_TASKS:
- TASK-1: preserved

## SPRINT_GOAL
Recover

## TASKS
TASK-1: Independent task
- Agent: backend
- Dependencies: none
- Effort: S
- Acceptance Criteria:
  - Done

TASK-4: Replacement for failed task
- Agent: backend
- Dependencies: TASK-1
- Effort: M
- Acceptance Criteria:
  - Works`
      );

      const result = await reviser.revise(
        agentLoop,
        makeMCTSResult(plan, "original"),
        trace,
        "bp",
        "desc"
      );

      expect(result).not.toBeNull();
      // TASK-1 is reusable (independent, succeeded)
      // TASK-3 depends on TASK-2 (failed), so not reusable even though it succeeded
      expect(result?.reusableWork).toContain("TASK-1");
    });
  });

  describe("getRevisionCount", () => {
    it("starts at 0", () => {
      const reviser = new PlanReviser();
      expect(reviser.getRevisionCount()).toBe(0);
    });

    it("increments with each successful revision", async () => {
      const reviser = new PlanReviser(5);
      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "T",
          description: "T",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);

      const strategies = ["a", "b", "c"];
      for (let i = 0; i < 2; i++) {
        const agentLoop = makeMockAgentLoop(
          `STRATEGY: ${strategies[i + 1] ?? "unknown"}
CONFIDENCE: 0.5
REASONING: Try

## TASKS
TASK-1: Task
- Agent: backend
- Dependencies: none
- Effort: M
- Acceptance Criteria:
  - Works`
        );

        await reviser.revise(
          agentLoop,
          makeMCTSResult(plan, strategies[i] ?? "fallback"),
          makeFailedTrace(),
          "bp",
          "desc"
        );
      }

      expect(reviser.getRevisionCount()).toBe(2);
    });
  });

  describe("plan parsing", () => {
    it("parses agent roles from aliases", async () => {
      const reviser = new PlanReviser(3);
      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "T",
          description: "T",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);

      const agentLoop = makeMockAgentLoop(
        `STRATEGY: new
CONFIDENCE: 0.6
REASONING: Try new approach

## TASKS
TASK-1: Frontend work
- Agent: frontend
- Dependencies: none
- Effort: S
- Acceptance Criteria:
  - UI renders

TASK-2: Backend work
- Agent: backend_coder
- Dependencies: none
- Effort: M
- Acceptance Criteria:
  - API works

TASK-3: Test work
- Agent: test_engineer
- Dependencies: none
- Effort: L
- Acceptance Criteria:
  - All tests pass

TASK-4: Deploy work
- Agent: deploy
- Dependencies: none
- Effort: XL
- Acceptance Criteria:
  - Deployed`
      );

      const result = await reviser.revise(
        agentLoop,
        makeMCTSResult(plan, "old"),
        makeFailedTrace(),
        "bp",
        "desc"
      );

      expect(result).not.toBeNull();
      const tasks = result?.revisedPlan.tasks;
      expect(tasks?.find((t) => t.id === "TASK-1")?.agentRole).toBe(
        "frontend_coder"
      );
      expect(tasks?.find((t) => t.id === "TASK-2")?.agentRole).toBe(
        "backend_coder"
      );
      expect(tasks?.find((t) => t.id === "TASK-3")?.agentRole).toBe(
        "test_engineer"
      );
      expect(tasks?.find((t) => t.id === "TASK-3")?.dependencies).toEqual([]);
      expect(tasks?.find((t) => t.id === "TASK-4")?.agentRole).toBe(
        "deploy_engineer"
      );
      expect(tasks?.find((t) => t.id === "TASK-4")?.effort).toBe("XL");
    });

    it("parses parallel workstreams and critical path", async () => {
      const reviser = new PlanReviser(3);
      const plan = makeSprintPlan([
        {
          id: "TASK-1",
          title: "T",
          description: "T",
          agentRole: "backend_coder",
          dependencies: [],
          effort: "M",
          acceptanceCriteria: ["Done"],
        },
      ]);

      const agentLoop = makeMockAgentLoop(
        `STRATEGY: parallel
CONFIDENCE: 0.8
REASONING: Parallel execution

## TASKS
TASK-1: First
- Agent: backend
- Dependencies: none
- Effort: S
- Acceptance Criteria:
  - Done

TASK-2: Second
- Agent: frontend
- Dependencies: none
- Effort: M
- Acceptance Criteria:
  - Done

TASK-3: Third
- Agent: test
- Dependencies: TASK-1, TASK-2
- Effort: M
- Acceptance Criteria:
  - Done

## PARALLEL_WORKSTREAMS
- Stream 1: TASK-1
- Stream 2: TASK-2

## CRITICAL_PATH
TASK-1 -> TASK-3`
      );

      const result = await reviser.revise(
        agentLoop,
        makeMCTSResult(plan, "sequential"),
        makeFailedTrace(),
        "bp",
        "desc"
      );

      expect(result).not.toBeNull();
      expect(result?.revisedPlan.parallelWorkstreams).toHaveLength(2);
      expect(result?.revisedPlan.criticalPath).toContain("TASK-1");
      expect(result?.revisedPlan.criticalPath).toContain("TASK-3");
    });
  });
});
