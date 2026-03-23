import { describe, expect, it } from "vitest";
import {
  estimateMessageTokens,
  estimateTextCost,
  estimateTokens,
  remainingContextTokens,
  truncateToTokens,
} from "../tokens";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null-ish input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates ~4 chars per token for plain English", () => {
    const text = "This is a simple English sentence for testing purposes.";
    const tokens = estimateTokens(text);
    // Should be roughly text.length / 4, within reasonable range
    expect(tokens).toBeGreaterThan(text.length / 5);
    expect(tokens).toBeLessThan(text.length / 2);
  });

  it("estimates more tokens for code (lower chars-per-token)", () => {
    const prose = "a".repeat(100);
    const code = "function foo() { return bar[0] + baz(x, y); }".padEnd(
      100,
      ";"
    );
    const proseTokens = estimateTokens(prose);
    const codeTokens = estimateTokens(code);
    // Code should produce more tokens per character
    expect(codeTokens).toBeGreaterThanOrEqual(proseTokens);
  });

  it("handles very long text", () => {
    const text = "word ".repeat(10_000);
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(10_000); // at least 1 token per word
  });
});

describe("estimateMessageTokens", () => {
  it("adds framing overhead per message plus reply priming", () => {
    const messages = [{ role: "user", content: "" }];
    // Should be at least 4 (framing) + 3 (reply priming) = 7
    expect(estimateMessageTokens(messages)).toBeGreaterThanOrEqual(7);
  });

  it("accumulates tokens across messages", () => {
    const single = [{ role: "user", content: "Hello world" }];
    const double = [
      { role: "user", content: "Hello world" },
      { role: "assistant", content: "Hi there" },
    ];
    expect(estimateMessageTokens(double)).toBeGreaterThan(
      estimateMessageTokens(single)
    );
  });

  it("returns 3 for empty messages array (just reply priming)", () => {
    expect(estimateMessageTokens([])).toBe(3);
  });
});

describe("remainingContextTokens", () => {
  it("returns full window minus messages and reserve", () => {
    const messages = [{ role: "user", content: "" }];
    const used = estimateMessageTokens(messages);
    const remaining = remainingContextTokens(messages, 1000, 200);
    expect(remaining).toBe(1000 - used - 200);
  });

  it("returns 0 when messages exceed context window", () => {
    const messages = [{ role: "user", content: "x".repeat(100_000) }];
    expect(remainingContextTokens(messages, 100)).toBe(0);
  });

  it("works without reserve parameter", () => {
    const remaining = remainingContextTokens([], 1000);
    expect(remaining).toBe(1000 - 3); // just reply priming
  });
});

describe("truncateToTokens", () => {
  it("returns text unchanged if within limit", () => {
    const text = "short text";
    expect(truncateToTokens(text, 1000)).toBe(text);
  });

  it("truncates long text and adds marker", () => {
    const text = "x".repeat(10_000);
    const result = truncateToTokens(text, 100);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain("[truncated]");
  });

  it("returns empty string when maxTokens is very small", () => {
    const text = "x".repeat(10_000);
    const result = truncateToTokens(text, 1);
    expect(result).toBe("");
  });
});

describe("estimateTextCost", () => {
  it("calculates cost from input text and expected output tokens", () => {
    const cost = estimateTextCost("Hello world", 100, 0.001, 0.002);
    const inputTokens = estimateTokens("Hello world");
    expect(cost).toBeCloseTo(inputTokens * 0.001 + 100 * 0.002);
  });

  it("returns 0 when rates are 0", () => {
    expect(estimateTextCost("Hello world", 100, 0, 0)).toBe(0);
  });
});
