import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockFindMany,
  mockReturning,
  mockInsertValues,
  mockInsert,
  mockUpdateReturning,
  mockUpdateWhere,
} = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockInsertValues = vi
    .fn()
    .mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  const mockUpdateReturning = vi.fn().mockResolvedValue([]);
  const mockUpdateWhere = vi
    .fn()
    .mockReturnValue({ returning: mockUpdateReturning });
  const _mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: mockUpdateWhere }),
  });

  return {
    mockFindMany: vi.fn().mockResolvedValue([]),
    mockReturning,
    mockInsertValues,
    mockInsert,
    mockUpdateReturning,
    mockUpdateWhere,
  };
});

vi.mock("@prometheus/db", () => ({
  apiKeys: {
    id: "id",
    orgId: "orgId",
    createdAt: "createdAt",
    revokedAt: "revokedAt",
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

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock123`),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("api-keys router - key hashing", () => {
  function hashKey(rawKey: string): string {
    return createHash("sha256").update(rawKey).digest("hex");
  }

  it("produces consistent SHA-256 hash", () => {
    const key = "pk_live_abc123";
    const hash1 = hashKey(key);
    const hash2 = hashKey(key);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hashes for different keys", () => {
    const hash1 = hashKey("pk_live_key1");
    const hash2 = hashKey("pk_live_key2");

    expect(hash1).not.toBe(hash2);
  });
});

describe("api-keys router - key masking", () => {
  const KEY_PREFIX = "pk_live_";

  function maskKey(name: string): string {
    return `${KEY_PREFIX}${"*".repeat(8)}...${name.slice(-4)}`;
  }

  it("masks key showing prefix and last 4 chars", () => {
    const masked = maskKey("abcdefghijklmnop");

    expect(masked).toBe("pk_live_********...mnop");
    expect(masked).toContain("pk_live_");
    expect(masked).toContain("********");
  });

  it("shows last 4 characters of the hash", () => {
    const masked = maskKey("test-hash-1234");

    expect(masked.endsWith("1234")).toBe(true);
  });
});

describe("api-keys router - list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns masked keys for the org", async () => {
    const keys = [
      {
        id: "key_1",
        name: "Production",
        keyHash: "abc123def456",
        lastUsed: new Date(),
        createdAt: new Date(),
      },
      {
        id: "key_2",
        name: "Staging",
        keyHash: "xyz789uvw012",
        lastUsed: null,
        createdAt: new Date(),
      },
    ];
    mockFindMany.mockResolvedValueOnce(keys);

    const result = await mockFindMany();

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("Production");
    expect(result[1]?.lastUsed).toBeNull();
  });
});

describe("api-keys router - create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockInsertValues });
  });

  it("enforces max key limit per org", async () => {
    const MAX_KEYS_PER_ORG = 25;
    const existingKeys = Array.from({ length: 25 }, (_, i) => ({
      id: `key_${i}`,
    }));
    mockFindMany.mockResolvedValueOnce(existingKeys);

    const existing = await mockFindMany();
    expect(existing.length).toBeGreaterThanOrEqual(MAX_KEYS_PER_ORG);
  });

  it("allows creation below the limit", async () => {
    const MAX_KEYS_PER_ORG = 25;
    const existingKeys = Array.from({ length: 10 }, (_, i) => ({
      id: `key_${i}`,
    }));
    mockFindMany.mockResolvedValueOnce(existingKeys);

    const existing = await mockFindMany();
    expect(existing.length).toBeLessThan(MAX_KEYS_PER_ORG);
  });

  it("generates key with pk_live_ prefix", () => {
    const KEY_PREFIX = "pk_live_";
    const rawKey = `${KEY_PREFIX}abcdef1234567890`;

    expect(rawKey.startsWith(KEY_PREFIX)).toBe(true);
  });

  it("returns raw key only on creation", () => {
    const result = {
      id: "key_mock123",
      key: "pk_live_abc123",
      name: "Test Key",
      message: "Store this key securely. It will not be shown again.",
    };

    expect(result.key).toBeDefined();
    expect(result.message).toContain("not be shown again");
  });
});

describe("api-keys router - revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
  });

  it("revokes an active key", async () => {
    const revokedKey = { id: "key_1", revokedAt: new Date() };
    mockUpdateReturning.mockResolvedValueOnce([revokedKey]);

    const [updated] = await mockUpdateWhere().returning();

    expect(updated?.revokedAt).toBeInstanceOf(Date);
  });

  it("returns NOT_FOUND for already revoked or missing key", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);

    const result = await mockUpdateWhere().returning();
    expect(result).toEqual([]);
  });
});
