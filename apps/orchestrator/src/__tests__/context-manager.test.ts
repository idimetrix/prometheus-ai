import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { ContextManager } from "../context-manager";

describe("ContextManager", () => {
  let manager: ContextManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ContextManager("proj_1", "ses_1", 14_000);
  });

  describe("assembleContext", () => {
    it("includes system prompt and task description as highest priority layers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await manager.assembleContext({
        systemPrompt: "You are a coding assistant.",
        recentMessages: [],
        taskDescription: "Fix the login bug",
        agentRole: "backend_coder",
      });

      expect(result.systemPrompt).toBe("You are a coding assistant.");
      expect(result.layers.length).toBeGreaterThanOrEqual(2);

      // System prompt and task description should be included
      const layerNames = result.layers.map((l) => l.name);
      expect(layerNames).toContain("system_prompt");
      expect(layerNames).toContain("task_description");
    });

    it("includes recent conversation as a context layer", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await manager.assembleContext({
        systemPrompt: "System prompt",
        recentMessages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
        taskDescription: "Do something",
        agentRole: "frontend_coder",
      });

      const layerNames = result.layers.map((l) => l.name);
      expect(layerNames).toContain("recent_conversation");
    });

    it("omits recent_conversation layer when no messages provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await manager.assembleContext({
        systemPrompt: "System",
        recentMessages: [],
        taskDescription: "Task",
        agentRole: "backend_coder",
      });

      const layerNames = result.layers.map((l) => l.name);
      expect(layerNames).not.toContain("recent_conversation");
    });

    it("fetches and includes brain layers when available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          blueprint: "# Project Blueprint\nUse TypeScript everywhere.",
          semanticResults: "function login() { ... }",
          conventions: "Use camelCase for variables.",
        }),
      });

      const result = await manager.assembleContext({
        systemPrompt: "System",
        recentMessages: [],
        taskDescription: "Task",
        agentRole: "backend_coder",
      });

      const layerNames = result.layers.map((l) => l.name);
      expect(layerNames).toContain("blueprint");
      expect(layerNames).toContain("semantic_search");
      expect(layerNames).toContain("conventions");
    });

    it("handles brain fetch failure gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await manager.assembleContext({
        systemPrompt: "System prompt",
        recentMessages: [],
        taskDescription: "Fix bug",
        agentRole: "backend_coder",
      });

      // Should still have system prompt and task description
      expect(result.layers.length).toBeGreaterThanOrEqual(2);
    });

    it("handles brain fetch timeout gracefully", async () => {
      mockFetch.mockRejectedValueOnce(
        new DOMException("The operation was aborted.", "AbortError")
      );

      const result = await manager.assembleContext({
        systemPrompt: "System",
        recentMessages: [],
        taskDescription: "Task",
        agentRole: "backend_coder",
      });

      expect(result.layers.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("budget fitting", () => {
    it("truncates layers to fit within token budget", async () => {
      // Create a manager with a very small budget
      const smallManager = new ContextManager("proj_1", "ses_1", 100);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          blueprint: "x".repeat(10_000),
          semanticResults: "y".repeat(10_000),
        }),
      });

      const result = await smallManager.assembleContext({
        systemPrompt: "Short prompt",
        recentMessages: [],
        taskDescription: "Short task",
        agentRole: "backend_coder",
      });

      expect(result.totalTokens).toBeLessThanOrEqual(100);
      expect(result.truncated).toBe(true);
    });

    it("prioritizes higher-priority layers", async () => {
      const smallManager = new ContextManager("proj_1", "ses_1", 200);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          blueprint: "Blueprint content here",
          episodicMemory: "Low priority memory content",
        }),
      });

      const result = await smallManager.assembleContext({
        systemPrompt: "System prompt here",
        recentMessages: [],
        taskDescription: "Task description",
        agentRole: "backend_coder",
      });

      // System prompt (priority 100) and task description (priority 90) should be included
      const layerNames = result.layers.map((l) => l.name);
      expect(layerNames[0]).toBe("system_prompt");
      expect(layerNames[1]).toBe("task_description");
    });

    it("does not truncate when everything fits", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await manager.assembleContext({
        systemPrompt: "Short",
        recentMessages: [],
        taskDescription: "Short",
        agentRole: "backend_coder",
      });

      expect(result.truncated).toBe(false);
    });
  });

  describe("compressHistory", () => {
    it("returns raw messages when fewer than 6", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const result = await manager.compressHistory(
        messages,
        "http://localhost:4004"
      );
      expect(result).toContain("user: Hello");
      expect(result).toContain("assistant: Hi");
    });

    it("attempts LLM compression for 6+ messages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "Summary: user asked about login, agent fixed it.",
              },
            },
          ],
        }),
      });

      const messages = Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
      }));

      const result = await manager.compressHistory(
        messages,
        "http://localhost:4004"
      );
      expect(result).toContain("Summary");
    });

    it("falls back to last 4 messages when LLM compression fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("LLM unavailable"));

      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
      }));

      const result = await manager.compressHistory(
        messages,
        "http://localhost:4004"
      );
      // Should contain last 4 messages
      expect(result).toContain("Message 6");
      expect(result).toContain("Message 7");
      expect(result).toContain("Message 8");
      expect(result).toContain("Message 9");
      // Should not contain early messages
      expect(result).not.toContain("Message 0");
    });
  });
});
