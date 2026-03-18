import { describe, it, expect } from "vitest";
import { generateId } from "../id";

describe("generateId", () => {
  it("should generate a unique ID", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it("should generate ID with default length of 21", () => {
    const id = generateId();
    expect(id.length).toBe(21);
  });

  it("should generate ID with prefix", () => {
    const id = generateId("usr");
    expect(id.startsWith("usr_")).toBe(true);
    expect(id.length).toBe(25); // "usr_" + 21
  });

  it("should generate ID with custom length", () => {
    const id = generateId(undefined, 10);
    expect(id.length).toBe(10);
  });

  it("should generate prefixed ID with custom length", () => {
    const id = generateId("ses", 12);
    expect(id.startsWith("ses_")).toBe(true);
    expect(id.length).toBe(16); // "ses_" + 12
  });
});
