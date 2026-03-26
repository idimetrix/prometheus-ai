import { describe, expect, it } from "vitest";
import { SWEBenchRunner } from "../swe-bench-runner";

describe("SWEBenchRunner", () => {
  it("should instantiate with config", () => {
    const runner = new SWEBenchRunner({
      apiUrl: "http://localhost:4000",
      apiKey: "test-key",
      concurrency: 2,
    });
    expect(runner).toBeDefined();
  });

  it("should generate report from empty results", () => {
    const runner = new SWEBenchRunner({
      apiUrl: "http://localhost:4000",
      apiKey: "test-key",
    });
    const report = runner.generateReport([]);
    expect(report).toContain("SWE-Bench Results");
    expect(report).toContain("0.0%");
  });

  it("should generate report from results", () => {
    const runner = new SWEBenchRunner({
      apiUrl: "http://localhost:4000",
      apiKey: "test-key",
    });
    const report = runner.generateReport([
      {
        instanceId: "test-1",
        passed: true,
        patchGenerated: "diff --git a/file.py",
        executionTimeMs: 5000,
      },
      {
        instanceId: "test-2",
        passed: false,
        patchGenerated: "",
        executionTimeMs: 10_000,
        error: "timeout",
      },
    ]);
    expect(report).toContain("PASS");
    expect(report).toContain("FAIL");
    expect(report).toContain("50.0%");
    expect(report).toContain("test-1");
    expect(report).toContain("test-2");
    expect(report).toContain("timeout");
  });
});
