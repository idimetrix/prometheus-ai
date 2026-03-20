import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockPublishSessionEvent } = vi.hoisted(() => ({
  mockPublishSessionEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@prometheus/queue", () => ({
  EventPublisher: class {
    publishSessionEvent = mockPublishSessionEvent;
  },
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockFetch = vi.fn();

import { processCleanupSandbox } from "../../jobs/cleanup-sandbox";

describe("processCleanupSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseData = {
    sandboxId: "sbx_1",
    sessionId: "ses_1",
    projectId: "prj_1",
    orgId: "org_1",
    reason: "completed" as const,
    preserveArtifacts: false,
  };

  it("calls sandbox manager cleanup endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cleaned: true, artifactsPreserved: false }),
    });

    await processCleanupSandbox(baseData);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sandbox/sbx_1/cleanup"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("publishes session event on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cleaned: true, artifactsPreserved: false }),
    });

    await processCleanupSandbox(baseData);

    expect(mockPublishSessionEvent).toHaveBeenCalledWith(
      "ses_1",
      expect.objectContaining({
        type: "task_status",
        data: expect.objectContaining({
          sandboxId: "sbx_1",
          status: "sandbox_cleaned",
        }),
      })
    );
  });

  it("returns cleanup result from sandbox manager", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cleaned: true, artifactsPreserved: true }),
    });

    const result = await processCleanupSandbox({
      ...baseData,
      preserveArtifacts: true,
    });

    expect(result.cleaned).toBe(true);
    expect(result.artifactsPreserved).toBe(true);
  });

  it("returns not-cleaned when sandbox manager returns non-OK", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await processCleanupSandbox(baseData);

    expect(result.cleaned).toBe(false);
    expect(result.artifactsPreserved).toBe(false);
  });

  it("returns cleaned=true for timeout reason when fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await processCleanupSandbox({
      ...baseData,
      reason: "timeout",
    });

    expect(result.cleaned).toBe(true);
  });

  it("returns cleaned=true for completed reason when fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await processCleanupSandbox({
      ...baseData,
      reason: "completed",
    });

    expect(result.cleaned).toBe(true);
  });

  it("throws for unexpected failure reasons to trigger retry", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(
      processCleanupSandbox({ ...baseData, reason: "error" as "completed" })
    ).rejects.toThrow("Connection refused");
  });
});
