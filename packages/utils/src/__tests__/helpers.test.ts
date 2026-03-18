import { describe, expect, it, vi } from "vitest";
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

describe("truncate", () => {
  it("returns string unchanged if within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates with default suffix", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
  });

  it("truncates with custom suffix", () => {
    expect(truncate("hello world", 8, "...")).toBe("hello...");
  });
});

describe("debounce", () => {
  it("debounces calls", async () => {
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
});

describe("throttle", () => {
  it("throttles calls", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled();
    throttled();

    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("sha256", () => {
  it("produces consistent hashes", () => {
    const hash1 = sha256("test");
    const hash2 = sha256("test");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("sleep", () => {
  it("resolves after delay", async () => {
    vi.useFakeTimers();
    const promise = sleep(100);
    vi.advanceTimersByTime(100);
    await promise;
    vi.useRealTimers();
  });
});

describe("chunk", () => {
  it("chunks array into groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("handles empty array", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("pick", () => {
  it("picks specified keys", () => {
    expect(pick({ a: 1, b: 2, c: 3 }, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });
});

describe("omit", () => {
  it("omits specified keys", () => {
    expect(omit({ a: 1, b: 2, c: 3 }, ["b"])).toEqual({ a: 1, c: 3 });
  });
});

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1_048_576)).toBe("1 MB");
    expect(formatBytes(1536, 1)).toBe("1.5 KB");
  });
});

describe("clamp", () => {
  it("clamps values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("deepClone", () => {
  it("deep clones objects", () => {
    const obj = { a: { b: [1, 2, 3] } };
    const clone = deepClone(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.a).not.toBe(obj.a);
  });
});

describe("isPlainObject", () => {
  it("identifies plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("str")).toBe(false);
  });
});

describe("keyBy", () => {
  it("creates map from array", () => {
    const items = [
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ];
    expect(keyBy(items, "id")).toEqual({
      a: { id: "a", name: "Alice" },
      b: { id: "b", name: "Bob" },
    });
  });
});

describe("unique", () => {
  it("removes duplicates from primitives", () => {
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
});
