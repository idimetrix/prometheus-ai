import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter } from "../rate-limiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("should allow requests within limit", async () => {
    const result = await limiter.checkRateLimit("org1", "pro");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(200);
  });

  it("should track usage", async () => {
    await limiter.recordUsage("org1");
    const result = await limiter.checkRateLimit("org1", "hobby");
    expect(result.remaining).toBe(4); // 5 - 1
  });

  it("should deny when limit reached", async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.recordUsage("org1");
    }
    const result = await limiter.checkRateLimit("org1", "hobby");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("should have different limits per tier", async () => {
    const hobby = await limiter.checkRateLimit("org1", "hobby");
    const pro = await limiter.checkRateLimit("org2", "pro");
    const enterprise = await limiter.checkRateLimit("org3", "enterprise");

    expect(hobby.remaining).toBe(5);
    expect(pro.remaining).toBe(200);
    expect(enterprise.remaining).toBe(Infinity);
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
});
