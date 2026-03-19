import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { WorkflowClient } from "../client";
import { inngest } from "../inngest";

// ---------- WorkflowClient ----------

describe("WorkflowClient", () => {
  it("creates with default namespace", () => {
    const client = new WorkflowClient();
    expect(client).toBeDefined();
  });

  it("creates with custom namespace", () => {
    const client = new WorkflowClient({ namespace: "production" });
    expect(client).toBeDefined();
  });

  it("startWorkflow returns a handle with workflowId and runId", async () => {
    const client = new WorkflowClient();
    const handle = await client.startWorkflow("test-workflow", {
      input: "hello",
    });
    expect(handle.workflowId).toBeDefined();
    expect(handle.runId).toBeDefined();
    expect(handle.workflowId).toContain("wf-");
    expect(handle.runId).toContain("run-");
  });

  it("startWorkflow uses provided workflowId", async () => {
    const client = new WorkflowClient();
    const handle = await client.startWorkflow(
      "test-workflow",
      { input: "hello" },
      { workflowId: "custom-wf-id" }
    );
    expect(handle.workflowId).toBe("custom-wf-id");
  });

  it("startWorkflow generates unique IDs for each call", async () => {
    const client = new WorkflowClient();
    const h1 = await client.startWorkflow("wf", { a: 1 });
    const h2 = await client.startWorkflow("wf", { a: 2 });
    expect(h1.workflowId).not.toBe(h2.workflowId);
    expect(h1.runId).not.toBe(h2.runId);
  });

  it("getWorkflowStatus returns a status result", async () => {
    const client = new WorkflowClient();
    const status = await client.getWorkflowStatus("wf-123");
    expect(status.workflowId).toBe("wf-123");
    expect(status.status).toBe("running");
    expect(status.startedAt).toBeDefined();
    expect(status.runId).toBe("stub-run-id");
  });

  it("signalWorkflow resolves without error", async () => {
    const client = new WorkflowClient();
    await expect(
      client.signalWorkflow("wf-123", "approve", { approved: true })
    ).resolves.toBeUndefined();
  });

  it("signalWorkflow without payload resolves", async () => {
    const client = new WorkflowClient();
    await expect(
      client.signalWorkflow("wf-123", "cancel")
    ).resolves.toBeUndefined();
  });

  it("cancelWorkflow resolves without error", async () => {
    const client = new WorkflowClient();
    await expect(client.cancelWorkflow("wf-123")).resolves.toBeUndefined();
  });

  it("startWorkflow with taskQueue and retryPolicy does not throw", async () => {
    const client = new WorkflowClient();
    const handle = await client.startWorkflow(
      "agent-execution",
      { task: "build" },
      { taskQueue: "high-priority", retryPolicy: { maximumAttempts: 5 } }
    );
    expect(handle.workflowId).toBeDefined();
  });
});

// ---------- inngest ----------

describe("inngest.createFunction", () => {
  it("returns an object with config, trigger, and handler", () => {
    const fn = inngest.createFunction(
      { id: "test-fn", name: "Test Function" },
      { event: "prometheus/agent.execution.requested" as const },
      async () => ({ result: "ok" })
    );
    expect(fn.config.id).toBe("test-fn");
    expect(fn.config.name).toBe("Test Function");
    expect(fn.trigger.event).toBe("prometheus/agent.execution.requested");
    expect(typeof fn.handler).toBe("function");
  });

  it("supports retries and concurrency config", () => {
    const fn = inngest.createFunction(
      {
        id: "concurrent-fn",
        name: "Concurrent",
        retries: 3,
        concurrency: [{ limit: 10, key: "event.data.orgId" }],
      },
      { event: "prometheus/fleet.coordination.requested" as const },
      async () => ({})
    );
    expect(fn.config.retries).toBe(3);
    expect(fn.config.concurrency).toHaveLength(1);
    expect(
      (fn.config.concurrency as Array<{ limit: number }>)?.[0]?.limit
    ).toBe(10);
  });

  it("supports cancelOn config", () => {
    const fn = inngest.createFunction(
      {
        id: "cancelable-fn",
        name: "Cancelable",
        cancelOn: [{ event: "cancel-event", match: "data.id" }],
      },
      { event: "prometheus/agent.execution.requested" as const },
      async () => ({})
    );
    expect(fn.config.cancelOn).toHaveLength(1);
    expect((fn.config.cancelOn as Array<{ event: string }>)?.[0]?.event).toBe(
      "cancel-event"
    );
  });

  it("handler can be invoked with mock context", async () => {
    const handler = vi.fn().mockResolvedValue({ success: true });
    const fn = inngest.createFunction(
      { id: "test", name: "Test" },
      { event: "prometheus/agent.execution.requested" as const },
      handler
    );

    const mockStep = {
      run: vi.fn((_id: string, cb: () => unknown) => Promise.resolve(cb())),
      sendEvent: vi.fn().mockResolvedValue(undefined),
      waitForEvent: vi.fn().mockResolvedValue(null),
    };

    const mockContext = {
      event: {
        name: "prometheus/agent.execution.requested" as const,
        data: {
          taskId: "task-1",
          sessionId: "sess-1",
          taskDescription: "Build feature",
          mode: "autonomous",
          orgId: "org-1",
          projectId: "proj-1",
          userId: "user-1",
        },
      },
      step: mockStep,
    };

    const result = await fn.handler(mockContext as never);
    expect(result).toEqual({ success: true });
  });

  it("registers multiple functions without conflict", () => {
    const fn1 = inngest.createFunction(
      { id: "fn-1", name: "Fn 1" },
      { event: "prometheus/agent.execution.requested" as const },
      async () => ({})
    );
    const fn2 = inngest.createFunction(
      { id: "fn-2", name: "Fn 2" },
      { event: "prometheus/fleet.coordination.requested" as const },
      async () => ({})
    );
    expect(fn1.config.id).not.toBe(fn2.config.id);
    expect(fn1.trigger.event).not.toBe(fn2.trigger.event);
  });
});

// ---------- agentExecutionWorkflow integration ----------

describe("agentExecutionWorkflow", () => {
  it("is registered with correct id", async () => {
    const { agentExecutionWorkflow } = await import(
      "../workflows/agent-execution.inngest"
    );
    expect(agentExecutionWorkflow.config.id).toBe("agent-execution");
    expect(agentExecutionWorkflow.trigger.event).toBe(
      "prometheus/agent.execution.requested"
    );
  });

  it("handler executes autonomous mode successfully", async () => {
    const { agentExecutionWorkflow } = await import(
      "../workflows/agent-execution.inngest"
    );

    const stepResults = new Map<string, unknown>();
    const mockStep = {
      run: vi.fn(async (id: string, cb: () => unknown) => {
        const result = await cb();
        stepResults.set(id, result);
        return result;
      }),
      sendEvent: vi.fn().mockResolvedValue(undefined),
      waitForEvent: vi.fn().mockResolvedValue(null),
    };

    const ctx = {
      event: {
        name: "prometheus/agent.execution.requested" as const,
        data: {
          taskId: "t-1",
          sessionId: "s-1",
          taskDescription: "Add button",
          mode: "autonomous",
          orgId: "org-1",
          projectId: "proj-1",
          userId: "user-1",
        },
      },
      step: mockStep,
    };

    const result = (await agentExecutionWorkflow.handler(
      ctx as never
    )) as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.plan).toHaveLength(1);
    expect(result.approval).toBeNull();
    expect(result.executions).toHaveLength(1);
  });
});

// ---------- fleetCoordinationWorkflow ----------

describe("fleetCoordinationWorkflow", () => {
  it("is registered with correct id", async () => {
    const { fleetCoordinationWorkflow } = await import(
      "../workflows/fleet-coordination.inngest"
    );
    expect(fleetCoordinationWorkflow.config.id).toBe("fleet-coordination");
    expect(fleetCoordinationWorkflow.trigger.event).toBe(
      "prometheus/fleet.coordination.requested"
    );
  });

  it("handler processes tasks through waves", async () => {
    const { fleetCoordinationWorkflow } = await import(
      "../workflows/fleet-coordination.inngest"
    );

    const mockStep = {
      run: vi.fn(async (_id: string, cb: () => unknown) => {
        return await cb();
      }),
      sendEvent: vi.fn().mockResolvedValue(undefined),
      waitForEvent: vi.fn().mockResolvedValue(null),
    };

    const ctx = {
      event: {
        name: "prometheus/fleet.coordination.requested" as const,
        data: {
          sessionId: "s-1",
          orgId: "org-1",
          projectId: "proj-1",
          userId: "user-1",
          blueprint: "standard",
          maxParallelAgents: 3,
          tasks: [
            {
              id: "task-a",
              title: "Task A",
              agentRole: "coder",
              priority: 1,
              estimatedTokens: 1000,
              dependencies: [],
            },
            {
              id: "task-b",
              title: "Task B",
              agentRole: "tester",
              priority: 2,
              estimatedTokens: 500,
              dependencies: ["task-a"],
            },
          ],
        },
      },
      step: mockStep,
    };

    const result = (await fleetCoordinationWorkflow.handler(
      ctx as never
    )) as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.wavesExecuted).toBe(2);
    expect(result.assignments).toHaveLength(2);
  });
});
