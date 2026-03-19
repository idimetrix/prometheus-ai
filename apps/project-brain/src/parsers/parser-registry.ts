/**
 * Phase 5.2: Multi-Language Parser Registry.
 * TS/JS: uses existing parseTypeScript
 * Python/Go/Rust/Java: regex-based structural extraction producing same SymbolTable interface
 * Fallback: indentation-based chunking
 */
import { createLogger } from "@prometheus/logger";
import type {
  ParsedClass,
  ParsedFunction,
  ParsedImport,
  SymbolTable,
} from "./symbols";
import { parseTypeScript } from "./tree-sitter";

const logger = createLogger("project-brain:parser-registry");

type LanguageParser = (filePath: string, content: string) => SymbolTable;

const PYTHON_FUNC_RE =
  /^(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S+))?\s*:/gm;
const PYTHON_CLASS_RE = /^class\s+(\w+)(?:\(([^)]*)\))?\s*:/gm;
const PYTHON_IMPORT_RE = /^(?:from\s+(\S+)\s+)?import\s+(.+)/gm;

const GO_FUNC_RE = /^func\s+(?:\((\w+)\s+\*?\w+\)\s+)?(\w+)\s*\(([^)]*)\)/gm;
const GO_IMPORT_RE = /import\s+(?:"([^"]+)"|\(([^)]+)\))/gs;
const GO_STRUCT_RE = /^type\s+(\w+)\s+struct\s*\{/gm;

const RUST_FN_RE =
  /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/gm;
const RUST_STRUCT_RE = /^(?:pub\s+)?struct\s+(\w+)/gm;
const RUST_USE_RE = /^use\s+([^;]+);/gm;

const JAVA_METHOD_RE =
  /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)/gm;
const JAVA_CLASS_RE =
  /^\s*(?:public\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/gm;
const JAVA_IMPORT_RE = /^import\s+(?:static\s+)?([^;]+);/gm;

const INDENT_RE = /^(\s*)\S/;
const GO_EXPORTED_RE = /^[A-Z]/;

const parserMap = new Map<string, LanguageParser>();

function registerParser(extensions: string[], parser: LanguageParser): void {
  for (const ext of extensions) {
    parserMap.set(ext, parser);
  }
}

function emptyTable(filePath: string): SymbolTable {
  return {
    filePath,
    functions: [],
    classes: [],
    imports: [],
    interfaces: [],
    typeAliases: [],
    exports: [],
    variables: [],
  };
}

function countLinesBefore(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

// TypeScript/JavaScript
registerParser(["ts", "tsx", "js", "jsx", "mjs", "cjs"], parseTypeScript);

// Python
registerParser(["py"], (filePath: string, content: string): SymbolTable => {
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];
  const imports: ParsedImport[] = [];
  const lines = content.split("\n");

  for (const match of content.matchAll(PYTHON_FUNC_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    functions.push({
      name: match[2] ?? "",
      line,
      endLine: findPythonBlockEnd(lines, line),
      isAsync: !!match[1],
      isGenerator: false,
      exported: true,
      params: (match[3] ?? "")
        .split(",")
        .filter(Boolean)
        .map((p) => ({
          name: p.trim().split(":")[0]?.trim() ?? p.trim(),
          optional: p.includes("="),
        })),
      returnType: match[4],
    });
  }

  for (const match of content.matchAll(PYTHON_CLASS_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    classes.push({
      name: match[1] ?? "",
      line,
      endLine: findPythonBlockEnd(lines, line),
      exported: true,
      isAbstract: false,
      extends: match[2]?.split(",")[0]?.trim(),
      methods: [],
      properties: [],
    });
  }

  for (const match of content.matchAll(PYTHON_IMPORT_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    imports.push({
      source: match[1] ?? match[2] ?? "",
      specifiers: (match[2] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      isDefault: false,
      isNamespace: false,
      isTypeOnly: false,
      line,
    });
  }

  return { ...emptyTable(filePath), functions, classes, imports };
});

// Go
registerParser(["go"], (filePath: string, content: string): SymbolTable => {
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];
  const imports: ParsedImport[] = [];

  for (const match of content.matchAll(GO_FUNC_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    functions.push({
      name: match[2] ?? "",
      line,
      endLine: line + 20,
      isAsync: false,
      isGenerator: false,
      exported: GO_EXPORTED_RE.test(match[2] ?? ""),
      params: (match[3] ?? "")
        .split(",")
        .filter(Boolean)
        .map((p) => ({
          name: p.trim().split(" ")[0] ?? p.trim(),
          optional: false,
        })),
    });
  }

  for (const match of content.matchAll(GO_STRUCT_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    classes.push({
      name: match[1] ?? "",
      line,
      endLine: line + 20,
      exported: GO_EXPORTED_RE.test(match[1] ?? ""),
      isAbstract: false,
      methods: [],
      properties: [],
    });
  }

  for (const match of content.matchAll(GO_IMPORT_RE)) {
    const source = match[1] ?? "";
    const multiImports =
      match[2]
        ?.split("\n")
        .map((l) => l.trim().replace(/"/g, ""))
        .filter(Boolean) ?? [];
    const sources = source ? [source] : multiImports;
    for (const src of sources) {
      imports.push({
        source: src,
        specifiers: [src.split("/").pop() ?? src],
        isDefault: false,
        isNamespace: false,
        isTypeOnly: false,
        line: countLinesBefore(content, match.index ?? 0),
      });
    }
  }

  return { ...emptyTable(filePath), functions, classes, imports };
});

// Rust
registerParser(["rs"], (filePath: string, content: string): SymbolTable => {
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];
  const imports: ParsedImport[] = [];

  for (const match of content.matchAll(RUST_FN_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    const prefix = content.slice(Math.max(0, match.index - 10), match.index);
    functions.push({
      name: match[1] ?? "",
      line,
      endLine: line + 20,
      isAsync: prefix.includes("async"),
      isGenerator: false,
      exported: prefix.includes("pub"),
      params: (match[2] ?? "")
        .split(",")
        .filter(Boolean)
        .map((p) => ({
          name: p.trim().split(":")[0]?.trim() ?? p.trim(),
          optional: false,
        })),
      returnType: match[3],
    });
  }

  for (const match of content.matchAll(RUST_STRUCT_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    const prefix = content.slice(Math.max(0, match.index - 5), match.index);
    classes.push({
      name: match[1] ?? "",
      line,
      endLine: line + 20,
      exported: prefix.includes("pub"),
      isAbstract: false,
      methods: [],
      properties: [],
    });
  }

  for (const match of content.matchAll(RUST_USE_RE)) {
    imports.push({
      source: match[1]?.trim() ?? "",
      specifiers: [
        match[1]
          ?.split("::")
          .pop()
          ?.replace(/[{}\s]/g, "") ?? "",
      ],
      isDefault: false,
      isNamespace: false,
      isTypeOnly: false,
      line: countLinesBefore(content, match.index),
    });
  }

  return { ...emptyTable(filePath), functions, classes, imports };
});

// Java
registerParser(["java"], (filePath: string, content: string): SymbolTable => {
  const functions: ParsedFunction[] = [];
  const classes: ParsedClass[] = [];
  const imports: ParsedImport[] = [];

  for (const match of content.matchAll(JAVA_METHOD_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    functions.push({
      name: match[1] ?? "",
      line,
      endLine: line + 20,
      isAsync: false,
      isGenerator: false,
      exported: true,
      params: (match[2] ?? "")
        .split(",")
        .filter(Boolean)
        .map((p) => ({
          name: p.trim().split(" ").pop() ?? p.trim(),
          optional: false,
        })),
    });
  }

  for (const match of content.matchAll(JAVA_CLASS_RE)) {
    const line = countLinesBefore(content, match.index ?? 0);
    const prefix = content.slice(Math.max(0, match.index - 20), match.index);
    classes.push({
      name: match[1] ?? "",
      line,
      endLine: line + 50,
      exported: true,
      isAbstract: prefix.includes("abstract"),
      extends: match[2],
      implements: match[3]
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      methods: [],
      properties: [],
    });
  }

  for (const match of content.matchAll(JAVA_IMPORT_RE)) {
    imports.push({
      source: match[1]?.trim() ?? "",
      specifiers: [match[1]?.split(".").pop() ?? ""],
      isDefault: false,
      isNamespace: false,
      isTypeOnly: false,
      line: countLinesBefore(content, match.index),
    });
  }

  return { ...emptyTable(filePath), functions, classes, imports };
});

/**
 * Parse a file using the appropriate language parser.
 * Falls back to empty symbol table for unsupported languages.
 */
export function parseFile(filePath: string, content: string): SymbolTable {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const parser = parserMap.get(ext);

  if (!parser) {
    logger.debug({ filePath, ext }, "No parser registered for extension");
    return emptyTable(filePath);
  }

  return parser(filePath, content);
}

/**
 * Get list of supported file extensions.
 */
export function getSupportedExtensions(): string[] {
  return Array.from(parserMap.keys());
}

function findPythonBlockEnd(lines: string[], startLine: number): number {
  const startLineContent = lines[startLine - 1] ?? "";
  const startIndent = startLineContent.match(INDENT_RE)?.[1]?.length ?? 0;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      continue;
    }
    const indent = line.match(INDENT_RE)?.[1]?.length ?? 0;
    if (indent <= startIndent && i > startLine) {
      return i;
    }
  }
  return lines.length;
}
