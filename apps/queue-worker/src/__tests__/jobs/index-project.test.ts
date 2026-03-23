import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockPublishFleetEvent } = vi.hoisted(() => ({
  mockPublishFleetEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@prometheus/queue", () => ({
  EventPublisher: class {
    publishFleetEvent = mockPublishFleetEvent;
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

import { processIndexProject } from "../../jobs/index-project";

describe("processIndexProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseData = {
    projectId: "prj_1",
    orgId: "org_1",
    filePaths: ["src/index.ts", "src/utils.ts"],
    fullReindex: false,
    triggeredBy: "manual" as const,
  };

  it("indexes individual files in incremental mode", async () => {
    // Each file indexing request succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      // Convention extraction
      .mockResolvedValueOnce({ ok: true });

    const result = await processIndexProject(baseData);

    expect(result.indexed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("counts skipped files", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      .mockResolvedValueOnce({ ok: true }); // conventions

    const result = await processIndexProject(baseData);

    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("counts errors for failed file indexing", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      .mockResolvedValueOnce({ ok: true }); // conventions

    const result = await processIndexProject(baseData);

    expect(result.indexed).toBe(1);
    expect(result.errors).toBe(1);
  });

  it("handles fetch errors for individual files", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      .mockResolvedValueOnce({ ok: true }); // conventions

    const result = await processIndexProject(baseData);

    expect(result.indexed).toBe(1);
    expect(result.errors).toBe(1);
  });

  it("performs full reindex when fullReindex is true", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ indexed: 50, skipped: 5, errors: 0 }),
      })
      .mockResolvedValueOnce({ ok: true }); // conventions

    const result = await processIndexProject({
      ...baseData,
      fullReindex: true,
    });

    expect(result.indexed).toBe(50);
    expect(result.skipped).toBe(5);
    expect(result.errors).toBe(0);
  });

  it("handles full reindex failure", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true }); // conventions

    const result = await processIndexProject({
      ...baseData,
      fullReindex: true,
    });

    expect(result.errors).toBe(baseData.filePaths.length);
  });

  it("publishes fleet event on completion", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      .mockResolvedValueOnce({ ok: true }); // conventions

    await processIndexProject(baseData);

    expect(mockPublishFleetEvent).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        type: "indexing_complete",
        data: expect.objectContaining({ projectId: "prj_1" }),
      })
    );
  });

  it("reports progress during incremental indexing", async () => {
    const filePaths = Array.from({ length: 10 }, (_, i) => `src/file${i}.ts`);
    const data = { ...baseData, filePaths };
    const onProgress = vi.fn();

    // Mock all file responses
    for (const _path of filePaths) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      });
    }
    mockFetch.mockResolvedValueOnce({ ok: true }); // conventions

    await processIndexProject(data, onProgress);

    // Progress called at i=0, i=5, and i=9 (last)
    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls.at(-1)?.[0];
    expect(lastCall?.percent).toBe(100);
  });

  it("continues when convention extraction fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, indexed: true }),
      })
      .mockRejectedValueOnce(new Error("convention error")); // conventions fail

    const result = await processIndexProject(baseData);

    expect(result.indexed).toBe(2);
  });
});
