import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Redis
const mockGet = vi.fn().mockResolvedValue(null);
const mockPipeline = vi.fn().mockReturnValue({
  incr: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
});

vi.mock("@prometheus/queue", () => ({
  createRedisConnection: () => ({
    get: mockGet,
    pipeline: mockPipeline,
  }),
}));

import { RateLimiter } from "../rate-limiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(null);
    limiter = new RateLimiter();
  });

  it("should allow requests within limit", async () => {
    mockGet.mockResolvedValue("0");
    const result = await limiter.checkRateLimit("org1", "pro");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(200);
  });

  it("should track usage via Redis pipeline", async () => {
    await limiter.recordUsage("org1");
    expect(mockPipeline).toHaveBeenCalled();
  });

  it("should deny when limit reached", async () => {
    mockGet.mockResolvedValue("5"); // 5 tasks used for hobby (limit 5)
    const result = await limiter.checkRateLimit("org1", "hobby");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("should have different limits per tier", async () => {
    mockGet.mockResolvedValue("0");

    const hobby = await limiter.checkRateLimit("org1", "hobby");
    const pro = await limiter.checkRateLimit("org2", "pro");
    const enterprise = await limiter.checkRateLimit("org3", "enterprise");

    expect(hobby.remaining).toBe(5);
    expect(pro.remaining).toBe(200);
    expect(enterprise.allowed).toBe(true);
    expect(enterprise.remaining).toBe(Number.POSITIVE_INFINITY);
  });

  it("should check concurrency limits", async () => {
    const hobbyOk = await limiter.checkConcurrency("org1", "hobby", 0);
    expect(hobbyOk).toBe(true);

    const hobbyFull = await limiter.checkConcurrency("org1", "hobby", 1);
    expect(hobbyFull).toBe(false);

    const proOk = await limiter.checkConcurrency("org1", "pro", 4);
    expect(proOk).toBe(true);

    const proFull = await limiter.checkConcurrency("org1", "pro", 5);
    expect(proFull).toBe(false);
  });

  it("should return correct priority for tiers", () => {
    expect(limiter.getPriorityForTier("enterprise")).toBe(1);
    expect(limiter.getPriorityForTier("studio")).toBe(2);
    expect(limiter.getPriorityForTier("team")).toBe(3);
    expect(limiter.getPriorityForTier("pro")).toBe(5);
    expect(limiter.getPriorityForTier("starter")).toBe(8);
    expect(limiter.getPriorityForTier("hobby")).toBe(10);
    expect(limiter.getPriorityForTier("unknown")).toBe(10);
  });

  it("should handle null Redis response as zero count", async () => {
    mockGet.mockResolvedValue(null);
    const result = await limiter.checkRateLimit("org1", "hobby");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });
});
