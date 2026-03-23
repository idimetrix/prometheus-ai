import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "../encryption";
import {
  chunk,
  clamp,
  debounce,
  deepClone,
  formatBytes,
  isPlainObject,
  keyBy,
  omit,
  pick,
  sha256,
  sleep,
  throttle,
  truncate,
  unique,
} from "../helpers";
import { generateId } from "../id";
import { retry } from "../retry";
import { slugify } from "../slug";

const PREFIX_ID_RE = /^usr_.{21}$/;
const URL_SAFE_RE = /^[A-Za-z0-9_-]+$/;
const HEX_64_RE = /^[0-9a-f]{64}$/;
const NO_PREFIX_RE = /^[a-z]+_/;

// ============================================================================
// generateId
// ============================================================================

describe("generateId", () => {
  it("generates unique IDs on each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it("generates ID with default length of 21", () => {
    expect(generateId()).toHaveLength(21);
  });

  it("generates ID with 'usr' prefix", () => {
    const id = generateId("usr");
    expect(id).toMatch(PREFIX_ID_RE);
  });

  it("generates ID with 'prj' prefix", () => {
    const id = generateId("prj");
    expect(id.startsWith("prj_")).toBe(true);
    expect(id).toHaveLength(25);
  });

  it("generates ID with 'org' prefix", () => {
    const id = generateId("org");
    expect(id.startsWith("org_")).toBe(true);
  });

  it("generates ID with 'ses' prefix", () => {
    const id = generateId("ses");
    expect(id.startsWith("ses_")).toBe(true);
  });

  it("generates ID with custom length", () => {
    const id = generateId(undefined, 10);
    expect(id).toHaveLength(10);
  });

  it("generates prefixed ID with custom length", () => {
    const id = generateId("tsk", 12);
    expect(id.startsWith("tsk_")).toBe(true);
    expect(id).toHaveLength(16); // "tsk_" + 12
  });

  it("generates ID without prefix when prefix is undefined", () => {
    const id = generateId(undefined);
    // No prefix separator pattern "xxx_" at start
    expect(id).not.toMatch(NO_PREFIX_RE);
    expect(id).toHaveLength(21);
  });

  it("generates URL-safe IDs", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateId();
      expect(id).toMatch(URL_SAFE_RE);
    }
  });
});

// ============================================================================
// slugify
// ============================================================================

describe("slugify", () => {
  it("converts text to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Hello! @World# $Test%")).toBe("hello-world-test");
  });

  it("collapses multiple spaces into a single hyphen", () => {
    expect(slugify("Hello   World")).toBe("hello-world");
  });

  it("replaces underscores with hyphens", () => {
    expect(slugify("hello_world_test")).toBe("hello-world-test");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("-hello world-")).toBe("hello-world");
    expect(slugify("---hello---")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(slugify("   ")).toBe("");
  });

  it("preserves already slugified text", () => {
    expect(slugify("hello-world")).toBe("hello-world");
  });

  it("handles mixed case and numbers", () => {
    expect(slugify("My Project v2.0")).toBe("my-project-v20");
  });

  it("handles unicode by removing non-word characters", () => {
    expect(slugify("café au lait")).toBe("caf-au-lait");
  });
});

// ============================================================================
// truncate
// ============================================================================

describe("truncate", () => {
  it("returns string unchanged when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns string unchanged when exactly at limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates with default suffix", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
  });

  it("truncates with custom suffix", () => {
    expect(truncate("hello world", 8, "...")).toBe("hello...");
  });

  it("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });

  it("handles maxLength of 1 with single char suffix", () => {
    expect(truncate("hello", 1, ".")).toBe(".");
  });
});

// ============================================================================
// sha256
// ============================================================================

describe("sha256", () => {
  it("produces consistent hashes for same input", () => {
    const hash1 = sha256("test");
    const hash2 = sha256("test");
    expect(hash1).toBe(hash2);
  });

  it("produces a 64-character hex string", () => {
    const hash = sha256("test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(HEX_64_RE);
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256("hello")).not.toBe(sha256("world"));
  });

  it("handles empty string", () => {
    const hash = sha256("");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(HEX_64_RE);
  });

  it("handles unicode input", () => {
    const hash = sha256("こんにちは");
    expect(hash).toHaveLength(64);
  });

  it("produces known SHA-256 digest for 'test'", () => {
    expect(sha256("test")).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );
  });
});

// ============================================================================
// sleep
// ============================================================================

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    vi.useFakeTimers();
    const promise = sleep(200);
    vi.advanceTimersByTime(200);
    await promise;
    vi.useRealTimers();
  });

  it("resolves with undefined", async () => {
    vi.useFakeTimers();
    const promise = sleep(10);
    vi.advanceTimersByTime(10);
    const result = await promise;
    expect(result).toBeUndefined();
    vi.useRealTimers();
  });
});

// ============================================================================
// chunk
// ============================================================================

describe("chunk", () => {
  it("chunks array into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns the whole array in a single chunk if size >= length", () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("handles empty array", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("handles chunk size of 1", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("handles array that divides evenly", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

// ============================================================================
// pick / omit
// ============================================================================

describe("pick", () => {
  it("picks specified keys", () => {
    expect(pick({ a: 1, b: 2, c: 3 }, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("ignores keys that don't exist", () => {
    const obj = { a: 1 } as Record<string, number>;
    expect(pick(obj, ["a", "b" as keyof typeof obj])).toEqual({ a: 1 });
  });

  it("returns empty object when no keys specified", () => {
    expect(pick({ a: 1 }, [])).toEqual({});
  });
});

describe("omit", () => {
  it("omits specified keys", () => {
    expect(omit({ a: 1, b: 2, c: 3 }, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("returns same object shape when omitting no keys", () => {
    const obj = { a: 1, b: 2 };
    expect(omit(obj, [])).toEqual({ a: 1, b: 2 });
  });

  it("returns empty object when omitting all keys", () => {
    expect(omit({ a: 1, b: 2 }, ["a", "b"])).toEqual({});
  });
});

// ============================================================================
// formatBytes
// ============================================================================

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes to KB", () => {
    expect(formatBytes(1024)).toBe("1 KB");
  });

  it("formats bytes to MB", () => {
    expect(formatBytes(1_048_576)).toBe("1 MB");
  });

  it("formats bytes to GB", () => {
    expect(formatBytes(1_073_741_824)).toBe("1 GB");
  });

  it("formats with custom decimal places", () => {
    expect(formatBytes(1536, 1)).toBe("1.5 KB");
  });

  it("formats sub-KB values", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
});

// ============================================================================
// clamp
// ============================================================================

describe("clamp", () => {
  it("returns value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns min when value equals min", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("returns max when value equals max", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

// ============================================================================
// deepClone
// ============================================================================

describe("deepClone", () => {
  it("deep clones nested objects", () => {
    const obj = { a: { b: [1, 2, 3] } };
    const clone = deepClone(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.a).not.toBe(obj.a);
    expect(clone.a.b).not.toBe(obj.a.b);
  });

  it("clones primitive values", () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone("hello")).toBe("hello");
    expect(deepClone(null)).toBeNull();
    expect(deepClone(true)).toBe(true);
  });

  it("clones arrays", () => {
    const arr = [1, [2, 3]];
    const clone = deepClone(arr);
    expect(clone).toEqual(arr);
    expect(clone).not.toBe(arr);
    expect(clone[1]).not.toBe(arr[1]);
  });
});

// ============================================================================
// isPlainObject
// ============================================================================

describe("isPlainObject", () => {
  it("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isPlainObject("str")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

// ============================================================================
// keyBy
// ============================================================================

describe("keyBy", () => {
  it("creates a map keyed by the specified property", () => {
    const items = [
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ];
    expect(keyBy(items, "id")).toEqual({
      a: { id: "a", name: "Alice" },
      b: { id: "b", name: "Bob" },
    });
  });

  it("overwrites duplicate keys with the last item", () => {
    const items = [
      { id: "a", name: "First" },
      { id: "a", name: "Second" },
    ];
    expect(keyBy(items, "id")).toEqual({
      a: { id: "a", name: "Second" },
    });
  });

  it("handles empty array", () => {
    expect(keyBy([], "id" as never)).toEqual({});
  });
});

// ============================================================================
// unique
// ============================================================================

describe("unique", () => {
  it("removes duplicates from primitive arrays", () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  it("removes duplicates by key", () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 1, name: "c" },
    ];
    expect(unique(items, "id")).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });

  it("handles empty array", () => {
    expect(unique([])).toEqual([]);
  });

  it("handles array with no duplicates", () => {
    expect(unique([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("removes duplicate strings", () => {
    expect(unique(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });
});

// ============================================================================
// debounce
// ============================================================================

describe("debounce", () => {
  it("only executes after delay passes", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("resets the timer on each call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ============================================================================
// throttle
// ============================================================================

describe("throttle", () => {
  it("executes immediately on first call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("blocks subsequent calls within the interval", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("allows calls after the interval has passed", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    vi.advanceTimersByTime(100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

// ============================================================================
// retry
// ============================================================================

describe("retry", () => {
  it("returns result on first success", async () => {
    const result = await retry(async () => "ok");
    expect(result).toBe("ok");
  });

  it("retries and eventually succeeds", async () => {
    let attempt = 0;
    const result = await retry(
      async () => {
        await Promise.resolve();
        attempt++;
        if (attempt < 3) {
          throw new Error("not yet");
        }
        return "done";
      },
      { maxAttempts: 3, delayMs: 10 }
    );
    expect(result).toBe("done");
    expect(attempt).toBe(3);
  });

  it("throws after exhausting max attempts", async () => {
    await expect(
      retry(
        async () => {
          await Promise.resolve();
          throw new Error("always fails");
        },
        { maxAttempts: 2, delayMs: 10 }
      )
    ).rejects.toThrow("always fails");
  });

  it("calls onRetry callback with error and attempt number", async () => {
    const onRetry = vi.fn();
    await retry(
      vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok"),
      { maxAttempts: 3, delayMs: 10, onRetry }
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it("does not call onRetry on successful first attempt", async () => {
    const onRetry = vi.fn();
    await retry(async () => "ok", { onRetry });
    expect(onRetry).not.toHaveBeenCalled();
  });
});

// ============================================================================
// encrypt / decrypt
// ============================================================================

describe("encrypt / decrypt", () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterAll(() => {
    if (originalKey) {
      process.env.ENCRYPTION_KEY = originalKey;
    } else {
      process.env.ENCRYPTION_KEY = undefined;
    }
  });

  it("round-trips a plain string", () => {
    const text = "my-secret-api-key-12345";
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const text = "same-input";
    expect(encrypt(text)).not.toBe(encrypt(text));
  });

  it("round-trips an empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("round-trips unicode text", () => {
    const text = "こんにちは世界 🌍 emoji";
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it("round-trips a very long string", () => {
    const text = "x".repeat(10_000);
    expect(decrypt(encrypt(text))).toBe(text);
  });

  it("throws when ENCRYPTION_KEY is missing", () => {
    const saved = process.env.ENCRYPTION_KEY;
    Reflect.deleteProperty(process.env, "ENCRYPTION_KEY");
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY");
    process.env.ENCRYPTION_KEY = saved;
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("test");
    const tampered = `${encrypted.slice(0, -3)}ZZZ`;
    expect(() => decrypt(tampered)).toThrow();
  });
});
