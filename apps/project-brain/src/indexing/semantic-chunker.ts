/**
 * Phase 5.1 + 7.10: Enhanced Semantic Chunking.
 *
 * AST-based chunking via tree-sitter symbol boundaries.
 * Enhancements (Phase 7.10):
 * - Import context prepending (includes imports used by the chunk)
 * - Overlapping chunks (50 token overlap between adjacent chunks)
 * - Multi-language regex-based chunking for Python, Go, Rust, Java, C++
 * - SemanticChunker class for direct usage
 */
import { createLogger } from "@prometheus/logger";
import type { SymbolTable } from "../parsers/symbols";
import { parseTypeScript } from "../parsers/tree-sitter";

const logger = createLogger("project-brain:semantic-chunker");

const MAX_CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 200; // ~50 tokens at 4 chars/token

// ── Language-specific patterns for non-TS languages ─────────────────
const PYTHON_FUNC_RE = /^(?:async\s+)?def\s+(\w+)\s*\(/gm;
const PYTHON_CLASS_RE = /^class\s+(\w+)(?:\([^)]*\))?\s*:/gm;
const GO_FUNC_RE = /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/gm;
const GO_TYPE_RE = /^type\s+(\w+)\s+(?:struct|interface)\s*\{/gm;
const RUST_FN_RE = /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm;
const RUST_STRUCT_RE = /^(?:pub\s+)?struct\s+(\w+)/gm;
const JAVA_METHOD_RE =
  /(?:public|private|protected)\s+(?:static\s+)?[\w<>[\]]+\s+(\w+)\s*\(/gm;
const JAVA_CLASS_RE = /(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
const CPP_FUNC_RE = /(?:[\w:]+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{/gm;
const CPP_CLASS_RE = /class\s+(\w+)/gm;

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  cpp: "cpp",
  cc: "cpp",
  c: "c",
  h: "c",
};

const TS_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);

const REACT_COMPONENT_RE = /^[A-Z]/;
const JSX_RE = /return\s*\(?[\s\S]*<|tsx|jsx/;

export interface CodeChunk extends StructuredChunk {
  language: string;
  overlap: boolean;
}

export interface StructuredChunk {
  content: string;
  endLine: number;
  filePath: string;
  importContext: string;
  startLine: number;
  symbolName: string;
  symbolType:
    | "function"
    | "class"
    | "interface"
    | "type"
    | "variable"
    | "module"
    | "component"
    | "other";
}

/**
 * Chunk a file by semantic boundaries using the SymbolTable parser.
 * Falls back to line-based chunking for non-TS/JS files.
 */
export function chunkBySemantic(
  filePath: string,
  content: string
): StructuredChunk[] {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const isTypeScript = TS_EXTENSIONS.has(ext);

  if (!isTypeScript) {
    return chunkByLines(filePath, content);
  }

  try {
    const symbols = parseTypeScript(filePath, content);
    return chunkFromSymbols(filePath, content, symbols);
  } catch (err) {
    logger.debug(
      { filePath, error: err instanceof Error ? err.message : String(err) },
      "SymbolTable parsing failed, falling back to line-based chunking"
    );
    return chunkByLines(filePath, content);
  }
}

function chunkFromSymbols(
  filePath: string,
  content: string,
  symbols: SymbolTable
): StructuredChunk[] {
  const lines = content.split("\n");
  const chunks: StructuredChunk[] = [];

  const importContext = symbols.imports
    .map((imp) => {
      const specs = imp.specifiers.join(", ");
      if (imp.isDefault) {
        return `import ${specs} from "${imp.source}"`;
      }
      if (imp.isNamespace) {
        return `import * as ${specs} from "${imp.source}"`;
      }
      return `import { ${specs} } from "${imp.source}"`;
    })
    .join("\n");

  chunkFunctions(filePath, lines, symbols.functions, importContext, chunks);
  chunkClasses(filePath, lines, symbols.classes, importContext, chunks);
  chunkSimpleSymbols(
    filePath,
    lines,
    symbols.interfaces,
    "interface",
    30,
    importContext,
    chunks
  );
  chunkSimpleSymbols(
    filePath,
    lines,
    symbols.typeAliases,
    "type",
    20,
    importContext,
    chunks
  );

  if (chunks.length === 0) {
    chunks.push({
      filePath,
      symbolType: "module",
      symbolName: filePath.split("/").pop() ?? filePath,
      startLine: 1,
      endLine: lines.length,
      content: content.slice(0, MAX_CHUNK_CHARS),
      importContext,
    });
  }

  return chunks;
}

function chunkFunctions(
  filePath: string,
  lines: string[],
  functions: SymbolTable["functions"],
  importContext: string,
  chunks: StructuredChunk[]
): void {
  for (const fn of functions) {
    const chunkContent = extractLines(lines, fn.line, fn.endLine);
    if (chunkContent.length === 0) {
      continue;
    }
    chunks.push({
      filePath,
      symbolType: isReactComponent(fn.name, chunkContent)
        ? "component"
        : "function",
      symbolName: fn.name,
      startLine: fn.line,
      endLine: fn.endLine,
      content: chunkContent,
      importContext,
    });
  }
}

function chunkClasses(
  filePath: string,
  lines: string[],
  classes: SymbolTable["classes"],
  importContext: string,
  chunks: StructuredChunk[]
): void {
  for (const cls of classes) {
    const chunkContent = extractLines(lines, cls.line, cls.endLine);
    if (chunkContent.length === 0) {
      continue;
    }

    const isLargeClass =
      chunkContent.length > MAX_CHUNK_CHARS && cls.methods.length > 0;
    if (!isLargeClass) {
      chunks.push({
        filePath,
        symbolType: "class",
        symbolName: cls.name,
        startLine: cls.line,
        endLine: cls.endLine,
        content: chunkContent,
        importContext,
      });
      continue;
    }

    const headerEnd = cls.methods[0]?.line ?? cls.endLine;
    chunks.push({
      filePath,
      symbolType: "class",
      symbolName: cls.name,
      startLine: cls.line,
      endLine: Math.min(headerEnd, cls.line + 20),
      content: extractLines(
        lines,
        cls.line,
        Math.min(headerEnd, cls.line + 20)
      ),
      importContext,
    });

    for (const method of cls.methods) {
      const methodContent = extractLines(lines, method.line, method.endLine);
      if (methodContent.length === 0) {
        continue;
      }
      chunks.push({
        filePath,
        symbolType: "function",
        symbolName: `${cls.name}.${method.name}`,
        startLine: method.line,
        endLine: method.endLine,
        content: methodContent,
        importContext,
      });
    }
  }
}

function chunkSimpleSymbols(
  filePath: string,
  lines: string[],
  symbols: Array<{ name: string; line: number }>,
  symbolType: StructuredChunk["symbolType"],
  lineSpan: number,
  importContext: string,
  chunks: StructuredChunk[]
): void {
  for (const sym of symbols) {
    const chunkContent = extractLines(lines, sym.line, sym.line + lineSpan);
    if (chunkContent.length === 0) {
      continue;
    }
    chunks.push({
      filePath,
      symbolType,
      symbolName: sym.name,
      startLine: sym.line,
      endLine: sym.line + lineSpan,
      content: chunkContent,
      importContext,
    });
  }
}

function extractLines(
  lines: string[],
  startLine: number,
  endLine: number
): string {
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  const extracted = lines.slice(start, end).join("\n");
  return extracted.slice(0, MAX_CHUNK_CHARS);
}

function isReactComponent(name: string, content: string): boolean {
  return REACT_COMPONENT_RE.test(name) && JSX_RE.test(content);
}

/**
 * Add overlapping chunks between adjacent chunks for better retrieval.
 */
function addOverlapChunks(chunks: StructuredChunk[]): StructuredChunk[] {
  const overlaps: StructuredChunk[] = [];
  for (let i = 0; i < chunks.length - 1; i++) {
    const current = chunks[i] as StructuredChunk;
    const next = chunks[i + 1] as StructuredChunk;

    const overlapContent = [
      current.content.slice(-OVERLAP_CHARS),
      next.content.slice(0, OVERLAP_CHARS),
    ].join("\n");

    if (overlapContent.length > 50) {
      overlaps.push({
        filePath: current.filePath,
        symbolType: "other",
        symbolName: `overlap_${current.symbolName}_${next.symbolName}`,
        startLine: current.endLine - 5,
        endLine: next.startLine + 5,
        content: overlapContent,
        importContext: current.importContext,
      });
    }
  }
  return [...chunks, ...overlaps];
}

/**
 * Chunk non-TS files using language-specific regex patterns.
 */
function chunkByLanguagePatterns(
  filePath: string,
  content: string,
  language: string
): StructuredChunk[] {
  const lines = content.split("\n");
  const boundaries: Array<{
    name: string;
    line: number;
    type: StructuredChunk["symbolType"];
  }> = [];

  const patternSets: Record<
    string,
    Array<{ pattern: RegExp; type: StructuredChunk["symbolType"] }>
  > = {
    python: [
      { pattern: PYTHON_FUNC_RE, type: "function" },
      { pattern: PYTHON_CLASS_RE, type: "class" },
    ],
    go: [
      { pattern: GO_FUNC_RE, type: "function" },
      { pattern: GO_TYPE_RE, type: "type" },
    ],
    rust: [
      { pattern: RUST_FN_RE, type: "function" },
      { pattern: RUST_STRUCT_RE, type: "class" },
    ],
    java: [
      { pattern: JAVA_METHOD_RE, type: "function" },
      { pattern: JAVA_CLASS_RE, type: "class" },
    ],
    cpp: [
      { pattern: CPP_FUNC_RE, type: "function" },
      { pattern: CPP_CLASS_RE, type: "class" },
    ],
    c: [{ pattern: CPP_FUNC_RE, type: "function" }],
  };

  const patterns = patternSets[language] ?? [];

  for (const { pattern, type } of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const matches = content.matchAll(regex);
    for (const match of matches) {
      const line = content.slice(0, match.index ?? 0).split("\n").length;
      boundaries.push({ name: match[1] ?? "anonymous", line, type });
    }
  }

  boundaries.sort((a, b) => a.line - b.line);

  if (boundaries.length === 0) {
    return chunkByLines(filePath, content);
  }

  const chunks: StructuredChunk[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i] as (typeof boundaries)[0];
    const nextBoundary = boundaries[i + 1];
    const endLine = nextBoundary ? nextBoundary.line - 1 : lines.length;

    const chunkContent = extractLines(lines, boundary.line, endLine);
    if (chunkContent.length > 0) {
      chunks.push({
        filePath,
        symbolType: boundary.type,
        symbolName: boundary.name,
        startLine: boundary.line,
        endLine,
        content: chunkContent,
        importContext: "",
      });
    }
  }

  return chunks;
}

/**
 * SemanticChunker class for enhanced multi-language chunking.
 * Supports TS/JS (via AST), Python, Go, Rust, Java, C++ (via regex).
 */
export class SemanticChunker {
  chunk(content: string, language: string, filePath = ""): CodeChunk[] {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const detectedLang = LANGUAGE_MAP[ext] ?? language;

    let baseChunks: StructuredChunk[];
    if (TS_EXTENSIONS.has(ext)) {
      baseChunks = chunkBySemantic(filePath, content);
    } else if (
      ["python", "go", "rust", "java", "cpp", "c"].includes(detectedLang)
    ) {
      baseChunks = chunkByLanguagePatterns(filePath, content, detectedLang);
    } else {
      baseChunks = chunkByLines(filePath, content);
    }

    const withOverlaps = addOverlapChunks(baseChunks);
    return withOverlaps.map((c) => ({
      ...c,
      language: detectedLang,
      overlap: c.symbolName.startsWith("overlap_"),
    }));
  }
}

/**
 * Fallback: chunk by lines for non-TS/JS files.
 */
function chunkByLines(filePath: string, content: string): StructuredChunk[] {
  const chunks: StructuredChunk[] = [];
  const lines = content.split("\n");
  let currentChunk = "";
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (
      currentChunk.length + line.length + 1 > MAX_CHUNK_CHARS &&
      currentChunk.length > 0
    ) {
      chunks.push({
        filePath,
        symbolType: "other",
        symbolName: `chunk_${chunks.length}`,
        startLine,
        endLine: i,
        content: currentChunk,
        importContext: "",
      });
      currentChunk = "";
      startLine = i + 1;
    }
    currentChunk += `${currentChunk ? "\n" : ""}${line}`;
  }

  if (currentChunk.length > 0) {
    chunks.push({
      filePath,
      symbolType: "other",
      symbolName: `chunk_${chunks.length}`,
      startLine,
      endLine: lines.length,
      content: currentChunk,
      importContext: "",
    });
  }

  return chunks;
}
