import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/db", () => {
  const selectChain: Record<string, ReturnType<typeof vi.fn>> = {};
  selectChain.from = vi.fn().mockReturnValue(selectChain);
  selectChain.where = vi.fn().mockReturnValue(selectChain);
  selectChain.orderBy = vi.fn().mockReturnValue(selectChain);
  selectChain.limit = vi.fn().mockResolvedValue([]);
  selectChain.groupBy = vi.fn().mockReturnValue(selectChain);

  const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
  insertChain.values = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{ id: "mem_1" }]),
  });

  const deleteChain: Record<string, ReturnType<typeof vi.fn>> = {};
  deleteChain.where = vi.fn().mockResolvedValue(undefined);

  const updateChain: Record<string, ReturnType<typeof vi.fn>> = {};
  updateChain.set = vi
    .fn()
    .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

  return {
    db: {
      query: {
        codeEmbeddings: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        fileIndexes: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        agentMemories: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        episodicMemories: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        proceduralMemories: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        blueprints: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue(insertChain),
      delete: vi.fn().mockReturnValue(deleteChain),
      update: vi.fn().mockReturnValue(updateChain),
    },
    codeEmbeddings: {},
    fileIndexes: {},
    agentMemories: {},
    episodicMemories: {},
    proceduralMemories: {},
    blueprints: {},
  };
});

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock global fetch so embedding generation doesn't require Ollama
const fakeEmbedding = Array.from({ length: 768 }, () => Math.random());
const originalFetch = globalThis.fetch;
vi.stubGlobal(
  "fetch",
  vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : String(url);
    if (urlStr.includes("/api/embeddings")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ embedding: fakeEmbedding }),
      });
    }
    // Fallback to original fetch for other URLs
    if (originalFetch) {
      return originalFetch(url, options);
    }
    return Promise.reject(new Error(`Unmocked fetch: ${urlStr}`));
  })
);

vi.mock("@prometheus/utils", () => ({
  generateId: (prefix?: string) => `${prefix ?? "id"}_test`,
}));

describe("SemanticLayer", () => {
  it("chunks code by declarations", async () => {
    const { SemanticLayer } = await import("../layers/semantic");
    const layer = new SemanticLayer();

    const code = `
export function hello() {
  return "hello";
}

export function world() {
  return "world";
}

export class Greeter {
  greet() {
    return "hi";
  }
}
    `.trim();

    const chunks = layer.chunkContent(code, "test.ts");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("handles empty files", async () => {
    const { SemanticLayer } = await import("../layers/semantic");
    const layer = new SemanticLayer();
    const chunks = layer.chunkContent("", "test.ts");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("chunks markdown by paragraph", async () => {
    const { SemanticLayer } = await import("../layers/semantic");
    const layer = new SemanticLayer();
    const md =
      "# Title\n\nParagraph one.\n\nParagraph two.\n\nParagraph three.";
    const chunks = layer.chunkContent(md, "readme.md");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("performs text search", async () => {
    // Mock fetch so generateEmbedding doesn't try to reach model-router
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              embedding: Array.from({ length: 768 }, () => Math.random()),
            },
          ],
          model: "test-model",
        }),
    }) as unknown as typeof fetch;

    try {
      const { SemanticLayer } = await import("../layers/semantic");
      const layer = new SemanticLayer();
      const results = await layer.search("proj_1", "authentication");
      expect(Array.isArray(results)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("EpisodicLayer", () => {
  it("can be imported", async () => {
    const { EpisodicLayer } = await import("../layers/episodic");
    expect(EpisodicLayer).toBeDefined();
    const layer = new EpisodicLayer();
    expect(layer).toBeDefined();
  });
});

describe("ProceduralLayer", () => {
  it("can be imported", async () => {
    const { ProceduralLayer } = await import("../layers/procedural");
    expect(ProceduralLayer).toBeDefined();
    const layer = new ProceduralLayer();
    expect(layer).toBeDefined();
  });
});
