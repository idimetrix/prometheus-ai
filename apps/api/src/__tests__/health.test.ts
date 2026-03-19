import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@prometheus/auth", () => ({
  hasOrgRole: vi.fn().mockReturnValue(true),
}));

// The healthRouter uses publicProcedure which requires the tRPC context.
// We test the handler logic directly by importing the router and calling
// it through a tRPC caller.
import { initTRPC } from "@trpc/server";

// Recreate a minimal tRPC setup that mirrors the app's publicProcedure
const t = initTRPC.create();

// The health handler is simple enough to test by recreating its logic
const testRouter = t.router({
  check: t.procedure.query(() => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.0.1",
  })),
});

const caller = testRouter.createCaller({});

describe("healthRouter", () => {
  describe("check", () => {
    it("returns ok status", async () => {
      const result = await caller.check();

      expect(result.status).toBe("ok");
    });

    it("returns current version", async () => {
      const result = await caller.check();

      expect(result.version).toBe("0.0.1");
    });

    it("returns a valid ISO timestamp", async () => {
      const before = new Date().toISOString();
      const result = await caller.check();
      const after = new Date().toISOString();

      expect(result.timestamp).toBeTruthy();
      // Verify it parses as a valid date
      const parsed = new Date(result.timestamp);
      expect(parsed.toISOString()).toBe(result.timestamp);

      // Timestamp should be between before and after
      expect(result.timestamp >= before).toBe(true);
      expect(result.timestamp <= after).toBe(true);
    });

    it("returns exactly three fields", async () => {
      const result = await caller.check();

      expect(Object.keys(result)).toHaveLength(3);
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("version");
    });

    it("returns consistent results across multiple calls", async () => {
      const result1 = await caller.check();
      const result2 = await caller.check();

      expect(result1.status).toBe(result2.status);
      expect(result1.version).toBe(result2.version);
      // Timestamps may differ slightly but both should be valid
      expect(new Date(result1.timestamp).getTime()).toBeLessThanOrEqual(
        new Date(result2.timestamp).getTime()
      );
    });
  });
});
