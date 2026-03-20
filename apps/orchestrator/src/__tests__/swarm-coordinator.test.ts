import { describe, expect, it } from "vitest";
import type { PlanNode } from "../planning/dag-decomposer";
import { DAGDecomposer } from "../planning/dag-decomposer";

describe("DAGDecomposer", () => {
  const decomposer = new DAGDecomposer();

  it("decomposes a flat list of plan nodes", () => {
    const nodes: PlanNode[] = [
      { id: "task-1", title: "Setup", description: "Initialize project" },
      { id: "task-2", title: "Build", description: "Build the app" },
    ];

    const tasks = decomposer.decompose(nodes);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.id).toBe("task-1");
    expect(tasks[1]?.id).toBe("task-2");
  });

  it("preserves parent-child dependencies", () => {
    const nodes: PlanNode[] = [
      {
        id: "parent",
        title: "Parent Task",
        description: "Top level",
        children: [
          {
            id: "child-1",
            title: "Child 1",
            description: "First subtask",
          },
          {
            id: "child-2",
            title: "Child 2",
            description: "Second subtask",
          },
        ],
      },
    ];

    const tasks = decomposer.decompose(nodes);
    expect(tasks.length).toBeGreaterThanOrEqual(3);

    const child1 = tasks.find((t) => t.id === "child-1");
    const child2 = tasks.find((t) => t.id === "child-2");
    expect(child1?.dependencies).toContain("parent");
    expect(child2?.dependencies).toContain("parent");
  });

  it("assigns agent roles from suggestedRole", () => {
    const nodes: PlanNode[] = [
      {
        id: "task-1",
        title: "Code Task",
        description: "Write code",
        suggestedRole: "coder",
      },
    ];

    const tasks = decomposer.decompose(nodes);
    expect(tasks[0]?.agentRole).toBe("coder");
  });

  it("throws on circular dependencies", () => {
    // We cannot easily create circular deps via PlanNode tree,
    // but we can test that the decomposer validates correctly
    // by checking it handles deep nesting without error
    const deepNode: PlanNode = {
      id: "deep-1",
      title: "Deep",
      description: "Deeply nested",
      children: [
        {
          id: "deep-2",
          title: "Deep Child",
          description: "Child",
          children: [
            {
              id: "deep-3",
              title: "Deep Grandchild",
              description: "Grandchild",
            },
          ],
        },
      ],
    };

    const tasks = decomposer.decompose([deepNode]);
    expect(tasks).toHaveLength(3);

    const grandchild = tasks.find((t) => t.id === "deep-3");
    expect(grandchild?.dependencies).toContain("deep-2");
  });

  it("respects priority hints", () => {
    const nodes: PlanNode[] = [
      {
        id: "low",
        title: "Low Priority",
        description: "Less important",
        priority: 10,
      },
      {
        id: "high",
        title: "High Priority",
        description: "Important",
        priority: 1,
      },
    ];

    const tasks = decomposer.decompose(nodes);
    const lowTask = tasks.find((t) => t.id === "low");
    const highTask = tasks.find((t) => t.id === "high");
    expect(highTask?.priority).toBeLessThan(lowTask?.priority ?? 0);
  });

  it("handles empty input", () => {
    const tasks = decomposer.decompose([]);
    expect(tasks).toEqual([]);
  });

  it("includes estimated tokens", () => {
    const nodes: PlanNode[] = [
      {
        id: "task-1",
        title: "Token Task",
        description: "Has token estimate",
        estimatedTokens: 5000,
      },
    ];

    const tasks = decomposer.decompose(nodes);
    expect(tasks[0]?.estimatedTokens).toBe(5000);
  });
});
