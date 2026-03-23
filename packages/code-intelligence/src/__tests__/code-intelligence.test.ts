import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  FILE_EXTENSION_MAP,
  LANGUAGE_GRAMMAR_URLS,
} from "../parsers/language-grammars";
import { TreeSitterParser } from "../parsers/tree-sitter-wasm";

// ---------- language-grammars.ts ----------

describe("FILE_EXTENSION_MAP", () => {
  it("maps .ts to typescript", () => {
    expect(FILE_EXTENSION_MAP.ts).toBe("typescript");
  });

  it("maps .tsx to tsx", () => {
    expect(FILE_EXTENSION_MAP.tsx).toBe("tsx");
  });

  it("maps .js to javascript", () => {
    expect(FILE_EXTENSION_MAP.js).toBe("javascript");
  });

  it("maps .py to python", () => {
    expect(FILE_EXTENSION_MAP.py).toBe("python");
  });

  it("maps .go to go", () => {
    expect(FILE_EXTENSION_MAP.go).toBe("go");
  });

  it("maps .rs to rust", () => {
    expect(FILE_EXTENSION_MAP.rs).toBe("rust");
  });

  it("maps .rb to ruby", () => {
    expect(FILE_EXTENSION_MAP.rb).toBe("ruby");
  });

  it("maps .java to java", () => {
    expect(FILE_EXTENSION_MAP.java).toBe("java");
  });

  it("maps multiple C++ extensions to cpp", () => {
    expect(FILE_EXTENSION_MAP.cpp).toBe("cpp");
    expect(FILE_EXTENSION_MAP.cc).toBe("cpp");
    expect(FILE_EXTENSION_MAP.cxx).toBe("cpp");
    expect(FILE_EXTENSION_MAP.hpp).toBe("cpp");
  });

  it("maps shell extensions to bash", () => {
    expect(FILE_EXTENSION_MAP.sh).toBe("bash");
    expect(FILE_EXTENSION_MAP.bash).toBe("bash");
    expect(FILE_EXTENSION_MAP.zsh).toBe("bash");
  });

  it("maps graphql and gql to graphql", () => {
    expect(FILE_EXTENSION_MAP.graphql).toBe("graphql");
    expect(FILE_EXTENSION_MAP.gql).toBe("graphql");
  });

  it("maps .yml and .yaml to yaml", () => {
    expect(FILE_EXTENSION_MAP.yml).toBe("yaml");
    expect(FILE_EXTENSION_MAP.yaml).toBe("yaml");
  });
});

describe("LANGUAGE_GRAMMAR_URLS", () => {
  it("has a URL for typescript", () => {
    expect(LANGUAGE_GRAMMAR_URLS.typescript).toContain(
      "tree-sitter-typescript"
    );
  });

  it("has URLs for all major languages", () => {
    const expectedLanguages = [
      "typescript",
      "javascript",
      "python",
      "go",
      "rust",
      "java",
      "ruby",
    ];
    for (const lang of expectedLanguages) {
      expect(LANGUAGE_GRAMMAR_URLS[lang]).toBeDefined();
    }
  });

  it("all URLs point to the CDN base", () => {
    for (const url of Object.values(LANGUAGE_GRAMMAR_URLS)) {
      expect(url).toContain("cdn.jsdelivr.net");
    }
  });
});

// ---------- TreeSitterParser static methods ----------

describe("TreeSitterParser.getLanguageForFile", () => {
  it("returns typescript for .ts files", () => {
    expect(TreeSitterParser.getLanguageForFile("src/index.ts")).toBe(
      "typescript"
    );
  });

  it("returns tsx for .tsx files", () => {
    expect(TreeSitterParser.getLanguageForFile("components/App.tsx")).toBe(
      "tsx"
    );
  });

  it("returns python for .py files", () => {
    expect(TreeSitterParser.getLanguageForFile("main.py")).toBe("python");
  });

  it("returns dockerfile for Dockerfile", () => {
    expect(TreeSitterParser.getLanguageForFile("Dockerfile")).toBe(
      "dockerfile"
    );
  });

  it("returns dockerfile for Dockerfile.prod", () => {
    expect(TreeSitterParser.getLanguageForFile("Dockerfile.prod")).toBe(
      "dockerfile"
    );
  });

  it("returns undefined for unknown extensions", () => {
    expect(TreeSitterParser.getLanguageForFile("image.png")).toBeUndefined();
  });

  it("returns undefined for files without extensions", () => {
    expect(TreeSitterParser.getLanguageForFile("Makefile")).toBeUndefined();
  });

  it("handles deeply nested paths", () => {
    expect(TreeSitterParser.getLanguageForFile("a/b/c/d/file.rs")).toBe("rust");
  });
});

describe("TreeSitterParser.isSupported", () => {
  it("returns true for supported languages", () => {
    expect(TreeSitterParser.isSupported("typescript")).toBe(true);
    expect(TreeSitterParser.isSupported("python")).toBe(true);
    expect(TreeSitterParser.isSupported("go")).toBe(true);
  });

  it("returns false for unsupported languages", () => {
    expect(TreeSitterParser.isSupported("brainfuck")).toBe(false);
    expect(TreeSitterParser.isSupported("")).toBe(false);
  });
});

describe("TreeSitterParser instance", () => {
  it("throws if parse is called before init", async () => {
    const parser = new TreeSitterParser();
    await expect(parser.parse("const x = 1;", "typescript")).rejects.toThrow(
      "not initialized"
    );
  });

  it("dispose resets the parser state", () => {
    const parser = new TreeSitterParser();
    // Should not throw even if not initialized
    expect(() => parser.dispose()).not.toThrow();
  });
});
