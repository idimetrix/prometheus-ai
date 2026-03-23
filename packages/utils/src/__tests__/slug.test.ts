import { describe, expect, it } from "vitest";
import { slugify } from "../slug";

describe("slugify", () => {
  it("should convert text to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should remove special characters", () => {
    expect(slugify("Hello! @World#")).toBe("hello-world");
  });

  it("should handle multiple spaces", () => {
    expect(slugify("Hello   World")).toBe("hello-world");
  });

  it("should handle underscores", () => {
    expect(slugify("hello_world")).toBe("hello-world");
  });

  it("should trim leading/trailing hyphens", () => {
    expect(slugify("-hello world-")).toBe("hello-world");
  });

  it("should handle empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("should handle already slugified text", () => {
    expect(slugify("hello-world")).toBe("hello-world");
  });
});
