import { describe, expect, it, vi } from "vitest";
import { retry } from "../retry";

describe("retry", () => {
  it("should return result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await retry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and succeed", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockResolvedValue("success");

    const result = await retry(fn, { maxAttempts: 3, delayMs: 10 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should throw after max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(retry(fn, { maxAttempts: 3, delayMs: 10 })).rejects.toThrow(
      "always fails"
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should call onRetry callback", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    await retry(fn, { maxAttempts: 3, delayMs: 10, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it("should apply exponential backoff", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValue("ok");

    const start = Date.now();
    await retry(fn, { maxAttempts: 3, delayMs: 50, backoffMultiplier: 2 });
    const elapsed = Date.now() - start;

    // First retry: 50ms, second retry: 100ms = ~150ms total
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });
});
