import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { QualityAlertManager } from "../quality-alerts";

describe("QualityAlertManager", () => {
  let manager: QualityAlertManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new QualityAlertManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("built-in rules", () => {
    it("starts with built-in alert rules", () => {
      const rules = manager.getRules();
      expect(rules.length).toBeGreaterThan(0);
    });

    it("has success-rate-low rule", () => {
      const rules = manager.getRules();
      const rule = rules.find((r) => r.id === "success-rate-low");
      expect(rule).toBeDefined();
      expect(rule?.metric).toBe("success_rate");
      expect(rule?.threshold).toBe(0.8);
      expect(rule?.direction).toBe("below");
      expect(rule?.severity).toBe("critical");
    });

    it("has quality-score-low rule", () => {
      const rules = manager.getRules();
      const rule = rules.find((r) => r.id === "quality-score-low");
      expect(rule).toBeDefined();
      expect(rule?.metric).toBe("quality_score");
      expect(rule?.direction).toBe("below");
      expect(rule?.severity).toBe("warning");
    });

    it("has cost-over-budget rule", () => {
      const rules = manager.getRules();
      const rule = rules.find((r) => r.id === "cost-over-budget");
      expect(rule).toBeDefined();
      expect(rule?.metric).toBe("cost_usd");
      expect(rule?.direction).toBe("above");
      expect(rule?.severity).toBe("warning");
    });
  });

  describe("addRule", () => {
    it("adds a new alert rule and returns its id", () => {
      const id = manager.addRule("latency_ms", 500, "warning", ["slack"], {
        name: "High Latency",
        direction: "above",
      });

      expect(typeof id).toBe("string");
      expect(id.startsWith("rule-")).toBe(true);

      const rules = manager.getRules();
      const added = rules.find((r) => r.id === id);
      expect(added).toBeDefined();
      expect(added?.metric).toBe("latency_ms");
      expect(added?.threshold).toBe(500);
      expect(added?.severity).toBe("warning");
      expect(added?.direction).toBe("above");
    });

    it("uses default direction 'below' when not specified", () => {
      const id = manager.addRule("accuracy", 0.9, "critical", ["email"]);
      const rules = manager.getRules();
      const added = rules.find((r) => r.id === id);
      expect(added?.direction).toBe("below");
    });

    it("generates name from metric when not specified", () => {
      const id = manager.addRule("throughput", 100, "info", ["webhook"]);
      const rules = manager.getRules();
      const added = rules.find((r) => r.id === id);
      expect(added?.name).toBe("throughput alert");
    });
  });

  describe("checkMetrics", () => {
    it("fires alert when metric is below threshold (direction: below)", async () => {
      const alerts = await manager.checkMetrics({
        success_rate: 0.5, // below 0.8 threshold
      });

      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const alert = alerts.find((a) => a.metric === "success_rate");
      expect(alert).toBeDefined();
      expect(alert?.severity).toBe("critical");
      expect(alert?.value).toBe(0.5);
      expect(alert?.message).toContain("0.50");
    });

    it("does not fire alert when metric meets threshold", async () => {
      const alerts = await manager.checkMetrics({
        success_rate: 0.95,
      });

      const successAlert = alerts.find((a) => a.metric === "success_rate");
      expect(successAlert).toBeUndefined();
    });

    it("fires alert when metric is above threshold (direction: above)", async () => {
      const alerts = await manager.checkMetrics({
        cost_usd: 150, // above 100 threshold
      });

      const costAlert = alerts.find((a) => a.metric === "cost_usd");
      expect(costAlert).toBeDefined();
      expect(costAlert?.severity).toBe("warning");
    });

    it("does not fire alert when cost is below threshold", async () => {
      const alerts = await manager.checkMetrics({
        cost_usd: 50,
      });

      const costAlert = alerts.find((a) => a.metric === "cost_usd");
      expect(costAlert).toBeUndefined();
    });

    it("ignores metrics not matching any rule", async () => {
      const alerts = await manager.checkMetrics({
        unknown_metric: 999,
      });

      expect(alerts).toHaveLength(0);
    });

    it("handles multiple metric breaches in single check", async () => {
      const alerts = await manager.checkMetrics({
        success_rate: 0.5, // below threshold
        quality_score: 0.3, // below threshold
        cost_usd: 200, // above threshold
      });

      expect(alerts.length).toBe(3);
    });

    it("returns empty array when no metrics are breached", async () => {
      const alerts = await manager.checkMetrics({
        success_rate: 0.95,
        quality_score: 0.9,
        cost_usd: 50,
      });

      expect(alerts).toHaveLength(0);
    });

    it("includes timestamp in fired alerts", async () => {
      const alerts = await manager.checkMetrics({
        success_rate: 0.5,
      });

      expect(alerts[0]?.firedAt).toBeDefined();
      expect(() => new Date(alerts[0]?.firedAt ?? "")).not.toThrow();
    });

    it("alert message includes metric name and threshold", async () => {
      const alerts = await manager.checkMetrics({
        success_rate: 0.5,
      });

      const alert = alerts.find((a) => a.metric === "success_rate");
      expect(alert?.message).toContain("success_rate");
      expect(alert?.message).toContain("0.8");
    });
  });

  describe("getFiredAlerts", () => {
    it("returns empty array before any checks", () => {
      expect(manager.getFiredAlerts()).toHaveLength(0);
    });

    it("accumulates alerts across multiple checks", async () => {
      await manager.checkMetrics({ success_rate: 0.5 });
      await manager.checkMetrics({ cost_usd: 200 });

      const fired = manager.getFiredAlerts();
      expect(fired.length).toBeGreaterThanOrEqual(2);
    });

    it("returns a copy of the alerts array", async () => {
      await manager.checkMetrics({ success_rate: 0.5 });

      const fired1 = manager.getFiredAlerts();
      const fired2 = manager.getFiredAlerts();
      expect(fired1).toEqual(fired2);
      expect(fired1).not.toBe(fired2);
    });
  });

  describe("getRules", () => {
    it("returns a copy of the rules array", () => {
      const rules1 = manager.getRules();
      const rules2 = manager.getRules();
      expect(rules1).toEqual(rules2);
      expect(rules1).not.toBe(rules2);
    });

    it("includes custom rules added via addRule", () => {
      const id = manager.addRule("custom_metric", 42, "info", ["webhook"]);
      const rules = manager.getRules();
      expect(rules.find((r) => r.id === id)).toBeDefined();
    });
  });

  describe("sendAlert channel handling", () => {
    it("handles slack channel without config gracefully", async () => {
      const alerts = await manager.checkMetrics({
        success_rate: 0.5,
      });

      // Should not throw even though slack is not configured
      expect(alerts.length).toBeGreaterThan(0);
    });

    it("sends to webhook when configured", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));

      const webhookManager = new QualityAlertManager({
        webhook: { url: "https://hooks.example.com/alert" },
      });

      webhookManager.addRule("test_metric", 10, "critical", ["webhook"], {
        direction: "above",
      });

      await webhookManager.checkMetrics({ test_metric: 20 });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://hooks.example.com/alert",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("sends to slack when configured", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));

      const slackManager = new QualityAlertManager({
        slack: {
          webhookUrl: "https://hooks.slack.com/test",
          channel: "#alerts",
        },
      });

      await slackManager.checkMetrics({ success_rate: 0.5 });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://hooks.slack.com/test",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("handles fetch errors gracefully", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error")
      );

      const webhookManager = new QualityAlertManager({
        webhook: { url: "https://hooks.example.com/alert" },
      });

      webhookManager.addRule("fail_metric", 0, "critical", ["webhook"], {
        direction: "above",
      });

      // Should not throw
      const alerts = await webhookManager.checkMetrics({ fail_metric: 100 });
      expect(alerts.length).toBeGreaterThan(0);
    });

    it("handles email channel without config gracefully", async () => {
      // cost-over-budget sends to email
      const alerts = await manager.checkMetrics({ cost_usd: 200 });
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  describe("custom rules with checkMetrics", () => {
    it("fires custom rule alerts", async () => {
      manager.addRule("p95_latency", 2000, "warning", ["slack"], {
        name: "High P95 Latency",
        direction: "above",
      });

      const alerts = await manager.checkMetrics({
        p95_latency: 3000,
      });

      const latencyAlert = alerts.find((a) => a.metric === "p95_latency");
      expect(latencyAlert).toBeDefined();
      expect(latencyAlert?.severity).toBe("warning");
    });

    it("custom below-direction rule fires correctly", async () => {
      manager.addRule("uptime", 0.999, "critical", ["email"], {
        name: "Low Uptime",
        direction: "below",
      });

      const alerts = await manager.checkMetrics({ uptime: 0.95 });
      const uptimeAlert = alerts.find((a) => a.metric === "uptime");
      expect(uptimeAlert).toBeDefined();
      expect(uptimeAlert?.severity).toBe("critical");
    });

    it("custom rule does not fire when threshold is not breached", async () => {
      manager.addRule("uptime", 0.999, "critical", ["email"], {
        name: "Low Uptime",
        direction: "below",
      });

      const alerts = await manager.checkMetrics({ uptime: 0.9999 });
      const uptimeAlert = alerts.find((a) => a.metric === "uptime");
      expect(uptimeAlert).toBeUndefined();
    });
  });
});
