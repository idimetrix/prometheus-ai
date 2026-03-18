import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockPublishSessionEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@prometheus/queue", () => ({
  EventPublisher: vi.fn().mockImplementation(() => ({
    publishSessionEvent: mockPublishSessionEvent,
  })),
  QueueEvents: {
    CHECKPOINT: "checkpoint",
    AGENT_STATUS: "agent:status",
  },
}));

let idCounter = 0;
vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test_${++idCounter}`),
}));

import type { CheckpointResponse } from "../checkpoint";
import { CheckpointManager } from "../checkpoint";

describe("CheckpointManager", () => {
  let manager: CheckpointManager;

  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
    vi.useFakeTimers();
    manager = new CheckpointManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("requestPlanConfirmation", () => {
    it("creates a checkpoint and publishes an event", async () => {
      const plan = {
        steps: [
          {
            id: "s1",
            title: "Step 1",
            description: "Do thing",
            estimatedCredits: 5,
          },
        ],
      };

      const promise = manager.requestPlanConfirmation("ses_123", plan);

      // Should have published an event
      expect(mockPublishSessionEvent).toHaveBeenCalledWith(
        "ses_123",
        expect.objectContaining({
          type: "checkpoint",
          data: expect.objectContaining({
            type: "plan_confirmation",
            title: "Plan Confirmation Required",
          }),
        })
      );

      // The promise should be pending
      const pending = manager.getPendingCheckpoints("ses_123");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.type).toBe("plan_confirmation");
      expect(pending[0]?.sessionId).toBe("ses_123");

      // Resolve the checkpoint
      const response: CheckpointResponse = {
        action: "approve",
        respondedBy: "user_1",
        respondedAt: new Date(),
      };
      const checkpointId = pending[0]?.id;
      const responded = manager.respondToCheckpoint(checkpointId, response);
      expect(responded).toBe(true);

      const result = await promise;
      expect(result.action).toBe("approve");
      expect(result.respondedBy).toBe("user_1");
    });
  });

  describe("requestHighStakesApproval", () => {
    it("creates a high_stakes checkpoint", async () => {
      const promise = manager.requestHighStakesApproval(
        "ses_456",
        "delete-database",
        { target: "prod" }
      );

      const pending = manager.getPendingCheckpoints("ses_456");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.type).toBe("high_stakes");
      expect(pending[0]?.description).toContain("delete-database");

      // Reject the operation
      manager.respondToCheckpoint(pending[0]?.id, {
        action: "reject",
        message: "Too dangerous",
        respondedBy: "user_1",
        respondedAt: new Date(),
      });

      const result = await promise;
      expect(result.action).toBe("reject");
      expect(result.message).toBe("Too dangerous");
    });
  });

  describe("requestInput", () => {
    it("creates an input_request checkpoint", async () => {
      const promise = manager.requestInput(
        "ses_789",
        "What database schema do you prefer?",
        { options: ["postgres", "mysql"] }
      );

      const pending = manager.getPendingCheckpoints("ses_789");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.type).toBe("input_request");
      expect(pending[0]?.description).toBe(
        "What database schema do you prefer?"
      );

      manager.respondToCheckpoint(pending[0]?.id, {
        action: "input",
        data: { choice: "postgres" },
        respondedBy: "user_1",
        respondedAt: new Date(),
      });

      const result = await promise;
      expect(result.action).toBe("input");
      expect(result.data?.choice).toBe("postgres");
    });
  });

  describe("timeout", () => {
    it("auto-rejects on timeout with system response", async () => {
      const promise = manager.requestPlanConfirmation(
        "ses_timeout",
        {
          steps: [
            {
              id: "s1",
              title: "Step",
              description: "...",
              estimatedCredits: 1,
            },
          ],
        },
        5000
      ); // 5 second timeout

      const pending = manager.getPendingCheckpoints("ses_timeout");
      expect(pending).toHaveLength(1);

      // Advance time past the timeout
      vi.advanceTimersByTime(6000);

      const result = await promise;
      expect(result.action).toBe("reject");
      expect(result.respondedBy).toBe("system");
      expect(result.message).toContain("timed out");

      // Should be cleaned up
      expect(manager.getPendingCheckpoints("ses_timeout")).toHaveLength(0);
    });
  });

  describe("respondToCheckpoint", () => {
    it("returns false for non-existent checkpoint", () => {
      const result = manager.respondToCheckpoint("nonexistent", {
        action: "approve",
        respondedBy: "user_1",
        respondedAt: new Date(),
      });
      expect(result).toBe(false);
    });

    it("returns false for already-resolved checkpoint", async () => {
      const promise = manager.requestInput("ses_double", "Question?");
      const pending = manager.getPendingCheckpoints("ses_double");
      const id = pending[0]?.id;

      // First response succeeds
      expect(
        manager.respondToCheckpoint(id, {
          action: "input",
          respondedBy: "user_1",
          respondedAt: new Date(),
        })
      ).toBe(true);

      await promise;

      // Second response fails
      expect(
        manager.respondToCheckpoint(id, {
          action: "input",
          respondedBy: "user_2",
          respondedAt: new Date(),
        })
      ).toBe(false);
    });
  });

  describe("getPendingCheckpoints", () => {
    it("returns only checkpoints for the specified session", async () => {
      manager.requestInput("ses_a", "Q1?");
      manager.requestInput("ses_b", "Q2?");
      manager.requestInput("ses_a", "Q3?");

      expect(manager.getPendingCheckpoints("ses_a")).toHaveLength(2);
      expect(manager.getPendingCheckpoints("ses_b")).toHaveLength(1);
      expect(manager.getPendingCheckpoints("ses_c")).toHaveLength(0);
    });
  });

  describe("cancelSessionCheckpoints", () => {
    it("resolves all pending checkpoints with rejection", async () => {
      const p1 = manager.requestInput("ses_cancel", "Q1?");
      const p2 = manager.requestInput("ses_cancel", "Q2?");

      expect(manager.getPendingCheckpoints("ses_cancel")).toHaveLength(2);

      manager.cancelSessionCheckpoints("ses_cancel");

      expect(manager.getPendingCheckpoints("ses_cancel")).toHaveLength(0);

      const r1 = await p1;
      const r2 = await p2;
      expect(r1.action).toBe("reject");
      expect(r1.message).toBe("Session cancelled");
      expect(r1.respondedBy).toBe("system");
      expect(r2.action).toBe("reject");
    });

    it("does not affect checkpoints from other sessions", async () => {
      manager.requestInput("ses_keep", "Q?");
      manager.requestInput("ses_cancel2", "Q?");

      manager.cancelSessionCheckpoints("ses_cancel2");

      expect(manager.getPendingCheckpoints("ses_keep")).toHaveLength(1);
      expect(manager.getPendingCheckpoints("ses_cancel2")).toHaveLength(0);
    });
  });
});
