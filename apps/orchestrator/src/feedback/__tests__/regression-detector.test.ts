import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  type AgentMetricSnapshot,
  type RegressionAlert,
  RegressionDetector,
} from "../regression-detector";

function makeSnapshot(
  overrides: Partial<AgentMetricSnapshot> = {}
): AgentMetricSnapshot {
  return {
    agentRole: "coder",
    successRate: 0.9,
    avgQualityScore: 0.85,
    avgTokensPerTask: 2000,
    taskCount: 1,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("RegressionDetector", () => {
  let detector: RegressionDetector;

  beforeEach(() => {
    detector = new RegressionDetector();
  });

  // -----------------------------------------------------------------------
  // Baseline establishment
  // -----------------------------------------------------------------------

  it("does not produce alerts before MIN_TASKS (10) snapshots", () => {
    for (let i = 0; i < 9; i++) {
      const alerts = detector.recordAndCheck(makeSnapshot());
      expect(alerts).toEqual([]);
    }
    // Baseline should not be established yet
    const metrics = detector.getMetrics("coder");
    expect(metrics.baseline).toBeNull();
  });

  it("establishes baseline after exactly 10 snapshots", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(
        makeSnapshot({ successRate: 0.9, avgQualityScore: 0.8 })
      );
    }
    const metrics = detector.getMetrics("coder");
    expect(metrics.baseline).not.toBeNull();
    expect(metrics.baseline?.successRate).toBeCloseTo(0.9);
    expect(metrics.baseline?.avgQualityScore).toBeCloseTo(0.8);
  });

  // -----------------------------------------------------------------------
  // Success rate — warning alert (10% drop)
  // -----------------------------------------------------------------------

  it("fires a warning alert when success rate drops by 10%", () => {
    // Establish baseline at 0.9 success rate
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));
    }

    // Now record a snapshot with ~10% relative drop: 0.9 * 0.9 = 0.81
    // dropPct = (0.9 - 0.8) / 0.9 = ~11%
    const alerts = detector.recordAndCheck(makeSnapshot({ successRate: 0.8 }));

    const successAlerts = alerts.filter((a) => a.metric === "success_rate");
    expect(successAlerts.length).toBe(1);
    expect(successAlerts[0]?.severity).toBe("warning");
    expect(successAlerts[0]?.dropPercentage).toBeGreaterThanOrEqual(10);
  });

  // -----------------------------------------------------------------------
  // Success rate — critical alert (20% drop)
  // -----------------------------------------------------------------------

  it("fires a critical alert when success rate drops by 20%+", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));
    }

    // 20%+ relative drop: 0.9 -> 0.7 => drop = 0.2/0.9 = ~22%
    const alerts = detector.recordAndCheck(makeSnapshot({ successRate: 0.7 }));

    const successAlerts = alerts.filter((a) => a.metric === "success_rate");
    expect(successAlerts.length).toBe(1);
    expect(successAlerts[0]?.severity).toBe("critical");
    expect(successAlerts[0]?.dropPercentage).toBeGreaterThanOrEqual(20);
  });

  // -----------------------------------------------------------------------
  // Quality score regression
  // -----------------------------------------------------------------------

  it("detects quality score regression with warning severity", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ avgQualityScore: 0.8 }));
    }

    // 15%+ relative drop: 0.8 -> 0.67 => drop = 0.13/0.8 = ~16%
    const alerts = detector.recordAndCheck(
      makeSnapshot({ avgQualityScore: 0.67 })
    );

    const qualityAlerts = alerts.filter((a) => a.metric === "quality_score");
    expect(qualityAlerts.length).toBe(1);
    expect(qualityAlerts[0]?.severity).toBe("warning");
  });

  it("detects quality score regression with critical severity", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ avgQualityScore: 0.8 }));
    }

    // 25%+ relative drop: 0.8 -> 0.58 => drop = 0.22/0.8 = 27.5%
    const alerts = detector.recordAndCheck(
      makeSnapshot({ avgQualityScore: 0.58 })
    );

    const qualityAlerts = alerts.filter((a) => a.metric === "quality_score");
    expect(qualityAlerts.length).toBe(1);
    expect(qualityAlerts[0]?.severity).toBe("critical");
  });

  // -----------------------------------------------------------------------
  // Token efficiency regression
  // -----------------------------------------------------------------------

  it("detects token efficiency regression (30%+ increase triggers warning)", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ avgTokensPerTask: 2000 }));
    }

    // 30%+ increase: 2000 -> 2700 = 35% increase
    const alerts = detector.recordAndCheck(
      makeSnapshot({ avgTokensPerTask: 2700 })
    );

    const tokenAlerts = alerts.filter((a) => a.metric === "token_efficiency");
    expect(tokenAlerts.length).toBe(1);
    expect(tokenAlerts[0]?.severity).toBe("warning");
  });

  it("detects token efficiency critical regression (50%+ increase)", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ avgTokensPerTask: 2000 }));
    }

    // 50%+ increase: 2000 -> 3100 = 55% increase
    const alerts = detector.recordAndCheck(
      makeSnapshot({ avgTokensPerTask: 3100 })
    );

    const tokenAlerts = alerts.filter((a) => a.metric === "token_efficiency");
    expect(tokenAlerts.length).toBe(1);
    expect(tokenAlerts[0]?.severity).toBe("critical");
  });

  // -----------------------------------------------------------------------
  // Alert callback system
  // -----------------------------------------------------------------------

  it("invokes registered alert callbacks", () => {
    const callback = vi.fn() as unknown as (alert: RegressionAlert) => void;
    detector.onAlert(callback);

    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));
    }

    detector.recordAndCheck(makeSnapshot({ successRate: 0.5 }));

    expect(callback).toHaveBeenCalled();
    const alert = (callback as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | RegressionAlert
      | undefined;
    expect(alert?.metric).toBe("success_rate");
    expect(alert?.severity).toBe("critical");
  });

  it("supports multiple alert callbacks", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    detector.onAlert(cb1);
    detector.onAlert(cb2);

    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));
    }

    detector.recordAndCheck(makeSnapshot({ successRate: 0.5 }));

    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Baseline reset
  // -----------------------------------------------------------------------

  it("resets baseline so it must be re-established", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));
    }

    expect(detector.getMetrics("coder").baseline).not.toBeNull();

    detector.resetBaseline("coder");

    expect(detector.getMetrics("coder").baseline).toBeNull();

    // After reset, the next recordAndCheck will re-establish baseline from
    // existing window snapshots (10+ already present), so baseline comes back.
    // The key behavior is that resetBaseline clears it.
    // Verify re-establishment occurs:
    detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));
    expect(detector.getMetrics("coder").baseline).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Window pruning (24h)
  // -----------------------------------------------------------------------

  it("prunes snapshots older than 24 hours", () => {
    const oldTimestamp = new Date(
      Date.now() - 25 * 60 * 60 * 1000
    ).toISOString();

    // Add old snapshots
    for (let i = 0; i < 12; i++) {
      detector.recordAndCheck(
        makeSnapshot({ timestamp: oldTimestamp, successRate: 0.9 })
      );
    }

    // The old snapshots should be pruned, so baseline should not form from them
    // Add a fresh snapshot — now the window has been pruned
    const _alerts = detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));

    // After pruning, the window should contain only the recent snapshot
    const metrics = detector.getMetrics("coder");
    // Old ones pruned, so window should be small
    expect(metrics.windowSize).toBeLessThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // No alerts when metrics are stable
  // -----------------------------------------------------------------------

  it("produces no alerts when current metrics match baseline", () => {
    for (let i = 0; i < 10; i++) {
      detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));
    }

    const alerts = detector.recordAndCheck(makeSnapshot({ successRate: 0.9 }));
    expect(alerts).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // getMetrics for unknown role
  // -----------------------------------------------------------------------

  it("returns null baseline and zero window for unknown roles", () => {
    const metrics = detector.getMetrics("unknown-role");
    expect(metrics.baseline).toBeNull();
    expect(metrics.recent).toBeNull();
    expect(metrics.windowSize).toBe(0);
  });
});
