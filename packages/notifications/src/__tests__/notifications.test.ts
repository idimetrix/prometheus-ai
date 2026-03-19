import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { NovuClient } from "../novu-client";
import { createSlackBot, SlackBot } from "../slack-bot";
import {
  CREDIT_LOW,
  DEPLOYMENT_READY,
  getAvailableTemplates,
  REVIEW_NEEDED,
  renderTemplate,
  renderTemplateWithAction,
  TASK_COMPLETE,
  TASK_FAILED,
} from "../templates";

// ---------- Templates ----------

describe("Notification Templates", () => {
  it("TASK_COMPLETE has required fields", () => {
    expect(TASK_COMPLETE.title).toBe("Task Completed");
    expect(TASK_COMPLETE.body).toContain("{{taskTitle}}");
    expect(TASK_COMPLETE.icon).toBe("check-circle");
    expect(TASK_COMPLETE.action).toContain("{{projectId}}");
  });

  it("TASK_FAILED has required fields", () => {
    expect(TASK_FAILED.title).toBe("Task Failed");
    expect(TASK_FAILED.body).toContain("{{reason}}");
    expect(TASK_FAILED.icon).toBe("x-circle");
  });

  it("CREDIT_LOW has required fields", () => {
    expect(CREDIT_LOW.title).toBe("Credits Running Low");
    expect(CREDIT_LOW.body).toContain("{{orgName}}");
    expect(CREDIT_LOW.body).toContain("{{remainingCredits}}");
  });

  it("REVIEW_NEEDED has required fields", () => {
    expect(REVIEW_NEEDED.title).toBe("Review Needed");
    expect(REVIEW_NEEDED.body).toContain("{{prNumber}}");
  });

  it("DEPLOYMENT_READY has required fields", () => {
    expect(DEPLOYMENT_READY.title).toBe("Deployment Ready");
    expect(DEPLOYMENT_READY.body).toContain("{{environment}}");
    expect(DEPLOYMENT_READY.icon).toBe("rocket");
  });
});

describe("getAvailableTemplates", () => {
  it("returns all template IDs", () => {
    const templates = getAvailableTemplates();
    expect(templates).toContain("TASK_COMPLETE");
    expect(templates).toContain("TASK_FAILED");
    expect(templates).toContain("CREDIT_LOW");
    expect(templates).toContain("REVIEW_NEEDED");
    expect(templates).toContain("DEPLOYMENT_READY");
    expect(templates).toHaveLength(5);
  });
});

describe("renderTemplate", () => {
  it("renders TASK_COMPLETE with variables", () => {
    const result = renderTemplate("TASK_COMPLETE", {
      taskTitle: "Add login page",
      projectName: "MyApp",
      projectId: "proj-1",
      taskId: "task-1",
    });
    expect(result.title).toBe("Task Completed");
    expect(result.body).toContain("Add login page");
    expect(result.body).toContain("MyApp");
    expect(result.body).not.toContain("{{");
  });

  it("renders TASK_FAILED with reason", () => {
    const result = renderTemplate("TASK_FAILED", {
      taskTitle: "Deploy service",
      projectName: "Backend",
      reason: "Build timeout",
      projectId: "proj-2",
      taskId: "task-2",
    });
    expect(result.body).toContain("Build timeout");
    expect(result.body).toContain("Deploy service");
  });

  it("leaves unknown placeholders as-is", () => {
    const result = renderTemplate("CREDIT_LOW", {
      orgName: "Acme",
    });
    expect(result.body).toContain("Acme");
    expect(result.body).toContain("{{remainingCredits}}");
  });

  it("throws for unknown template ID", () => {
    expect(() => renderTemplate("NONEXISTENT", {})).toThrow(
      "Unknown notification template"
    );
  });
});

describe("renderTemplateWithAction", () => {
  it("returns title, body, action, and icon", () => {
    const result = renderTemplateWithAction("TASK_COMPLETE", {
      taskTitle: "Fix bug",
      projectName: "App",
      projectId: "proj-1",
      taskId: "task-1",
    });
    expect(result.title).toBe("Task Completed");
    expect(result.body).toContain("Fix bug");
    expect(result.action).toBe("/projects/proj-1/tasks/task-1");
    expect(result.icon).toBe("check-circle");
  });

  it("renders CREDIT_LOW action correctly", () => {
    const result = renderTemplateWithAction("CREDIT_LOW", {
      orgName: "Acme",
      remainingCredits: "50",
    });
    expect(result.action).toBe("/settings/billing");
  });

  it("throws for unknown template ID", () => {
    expect(() => renderTemplateWithAction("NOPE", {})).toThrow(
      "Unknown notification template"
    );
  });
});

// ---------- NovuClient ----------

describe("NovuClient", () => {
  beforeEach(() => {
    process.env.NOVU_API_KEY = undefined;
    process.env.NOVU_URL = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NOVU_API_KEY = undefined;
    process.env.NOVU_URL = undefined;
  });

  it("constructs without API key (skips sends)", async () => {
    const client = new NovuClient();
    // Should not throw
    await client.send("user-1", "template-1", { key: "value" });
  });

  it("send skips when no API key is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = new NovuClient();
    await client.send("user-1", "template-1", { key: "value" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("createSubscriber skips when no API key is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = new NovuClient();
    await client.createSubscriber("user-1", "test@example.com", "Alice");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sendInApp skips when no API key is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = new NovuClient();
    await client.sendInApp("user-1", "Title", "Body");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("send calls fetch with correct URL when API key is set", async () => {
    process.env.NOVU_API_KEY = "test-key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = new NovuClient();
    await client.send("user-1", "welcome", { name: "Alice" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.novu.co/v1/events/trigger",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "ApiKey test-key",
        }),
      })
    );
  });

  it("createSubscriber calls correct endpoint", async () => {
    process.env.NOVU_API_KEY = "test-key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = new NovuClient();
    await client.createSubscriber("user-1", "alice@example.com", "Alice");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.novu.co/v1/subscribers",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses custom NOVU_URL when set", async () => {
    process.env.NOVU_API_KEY = "test-key";
    process.env.NOVU_URL = "https://custom.novu.io";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = new NovuClient();
    await client.send("user-1", "test", { key: "val" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://custom.novu.io/v1/events/trigger",
      expect.any(Object)
    );
  });
});

// ---------- SlackBot ----------

describe("SlackBot", () => {
  it("is not configured without a token", () => {
    process.env.SLACK_BOT_TOKEN = undefined;
    const bot = new SlackBot();
    expect(bot.isConfigured).toBe(false);
  });

  it("is configured with a token", () => {
    const bot = new SlackBot("xoxb-test-token");
    expect(bot.isConfigured).toBe(true);
  });

  it("postMessage returns null when not configured", async () => {
    const bot = new SlackBot();
    const result = await bot.postMessage({
      channel: "#general",
      text: "hello",
    });
    expect(result).toBeNull();
  });

  it("postMessage calls Slack API when configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: "123456.789" }), {
        status: 200,
      })
    );
    const bot = new SlackBot("xoxb-token");
    const result = await bot.postMessage({
      channel: "#general",
      text: "hello",
    });
    expect(result).toBe("123456.789");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.any(Object)
    );
    fetchSpy.mockRestore();
  });

  it("postMessage returns null on Slack API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), {
        status: 200,
      })
    );
    const bot = new SlackBot("xoxb-token");
    const result = await bot.postMessage({
      channel: "#nope",
      text: "hello",
    });
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });

  it("notifyTaskComplete sends formatted message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: "111.222" }), {
        status: 200,
      })
    );
    const bot = new SlackBot("xoxb-token");
    await bot.notifyTaskComplete({
      channel: "#dev",
      taskTitle: "Build API",
      success: true,
      summary: "All tests pass",
      taskId: "task-1",
    });
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("createSlackBot factory creates an instance", () => {
    const bot = createSlackBot("xoxb-token");
    expect(bot).toBeInstanceOf(SlackBot);
    expect(bot.isConfigured).toBe(true);
  });
});
