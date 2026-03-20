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
  it("returns an Inngest function object", () => {
    const fn = inngest.createFunction(
      {
        id: "test-fn",
        name: "Test Function",
        triggers: [{ event: "prometheus/agent.execution.requested" }],
      },
      async () => ({ result: "ok" })
    );
    expect(fn).toBeDefined();
    expect(typeof fn.id).toBe("function");
  });

  it("supports retries and concurrency config", () => {
    const fn = inngest.createFunction(
      {
        id: "concurrent-fn",
        name: "Concurrent",
        retries: 3,
        triggers: [{ event: "prometheus/fleet.coordination.requested" }],
        concurrency: [{ limit: 10, key: "event.data.orgId" }],
      },
      async () => ({})
    );
    expect(fn).toBeDefined();
  });

  it("supports cancelOn config", () => {
    const fn = inngest.createFunction(
      {
        id: "cancelable-fn",
        name: "Cancelable",
        triggers: [{ event: "prometheus/agent.execution.requested" }],
        cancelOn: [
          {
            event: "prometheus/agent.execution.cancelled",
            match: "data.taskId",
          },
        ],
      },
      async () => ({})
    );
    expect(fn).toBeDefined();
  });

  it("registers multiple functions without conflict", () => {
    const fn1 = inngest.createFunction(
      {
        id: "fn-1",
        name: "Fn 1",
        triggers: [{ event: "prometheus/agent.execution.requested" }],
      },
      async () => ({})
    );
    const fn2 = inngest.createFunction(
      {
        id: "fn-2",
        name: "Fn 2",
        triggers: [{ event: "prometheus/fleet.coordination.requested" }],
      },
      async () => ({})
    );
    expect(fn1).not.toBe(fn2);
  });
});

// ---------- agentExecutionWorkflow integration ----------

describe("agentExecutionWorkflow", () => {
  it("is registered as an Inngest function", async () => {
    const { agentExecutionWorkflow } = await import(
      "../workflows/agent-execution.inngest"
    );
    expect(agentExecutionWorkflow).toBeDefined();
    // The real Inngest function object has an id() method
    expect(typeof agentExecutionWorkflow.id).toBe("function");
  });
});

// ---------- fleetCoordinationWorkflow ----------

describe("fleetCoordinationWorkflow", () => {
  it("is registered as an Inngest function", async () => {
    const { fleetCoordinationWorkflow } = await import(
      "../workflows/fleet-coordination.inngest"
    );
    expect(fleetCoordinationWorkflow).toBeDefined();
    // The real Inngest function object has an id() method
    expect(typeof fleetCoordinationWorkflow.id).toBe("function");
  });
});
