import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/db", () => {
  const selectChain: any = {};
  selectChain.from = vi.fn().mockReturnValue(selectChain);
  selectChain.where = vi.fn().mockReturnValue(selectChain);
  selectChain.orderBy = vi.fn().mockReturnValue(selectChain);
  selectChain.limit = vi.fn().mockResolvedValue([]);
  selectChain.groupBy = vi.fn().mockReturnValue(selectChain);

  const insertChain: any = {};
  insertChain.values = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{ id: "mem_1" }]),
  });

  const deleteChain: any = {};
  deleteChain.where = vi.fn().mockResolvedValue(undefined);

  const updateChain: any = {};
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
    const { SemanticLayer } = await import("../layers/semantic");
    const layer = new SemanticLayer();
    const results = await layer.search("proj_1", "authentication");
    expect(Array.isArray(results)).toBe(true);
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
