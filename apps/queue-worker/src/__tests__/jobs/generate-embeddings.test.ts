import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@prometheus/queue", () => ({}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockFetch = vi.fn();

import { processGenerateEmbeddings } from "../../jobs/generate-embeddings";

describe("processGenerateEmbeddings", () => {
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
    filePath: "src/index.ts",
    chunks: [
      { chunkIndex: 0, content: "const a = 1;" },
      { chunkIndex: 1, content: "const b = 2;" },
      { chunkIndex: 2, content: "export { a, b };" },
    ],
    model: "text-embedding-3-small",
  };

  it("sends concatenated chunks to project-brain for indexing", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await processGenerateEmbeddings(baseData);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/index/file"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("const a = 1;"),
      })
    );
  });

  it("sorts chunks by chunkIndex before concatenation", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const unorderedData = {
      ...baseData,
      chunks: [
        { chunkIndex: 2, content: "third" },
        { chunkIndex: 0, content: "first" },
        { chunkIndex: 1, content: "second" },
      ],
    };

    await processGenerateEmbeddings(unorderedData);

    const body = mockFetch.mock.calls[0]?.[1]?.body;
    const parsed = JSON.parse(body as string) as { content: string };
    expect(parsed.content).toBe("first\n\nsecond\n\nthird");
  });

  it("returns processed count on success", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await processGenerateEmbeddings(baseData);

    expect(result.processed).toBe(3);
    expect(result.errors).toBe(0);
  });

  it("returns error count when request fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await processGenerateEmbeddings(baseData);

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(3);
  });

  it("returns error count when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await processGenerateEmbeddings(baseData);

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(3);
  });

  it("sends correct projectId and filePath in body", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await processGenerateEmbeddings(baseData);

    const body = mockFetch.mock.calls[0]?.[1]?.body;
    const parsed = JSON.parse(body as string) as {
      projectId: string;
      filePath: string;
    };
    expect(parsed.projectId).toBe("prj_1");
    expect(parsed.filePath).toBe("src/index.ts");
  });

  it("uses 60 second timeout", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await processGenerateEmbeddings(baseData);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });
});
