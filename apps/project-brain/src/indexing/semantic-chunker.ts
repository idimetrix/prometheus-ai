/**
 * Phase 5.1: Semantic Chunking via SymbolTable.
 * Uses the existing parseTypeScript SymbolTable instead of regex chunkByDeclarations.
 * Extracts functions/classes/interfaces with import context headers.
 */
import { createLogger } from "@prometheus/logger";
import type { SymbolTable } from "../parsers/symbols";
import { parseTypeScript } from "../parsers/tree-sitter";

const logger = createLogger("project-brain:semantic-chunker");

const MAX_CHUNK_CHARS = 2000;

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
  const isTypeScript = ["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext);

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

  // Build import context header (shared across chunks from this file)
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

  // Extract functions as chunks
  for (const fn of symbols.functions) {
    const chunkContent = extractLines(lines, fn.line, fn.endLine);
    if (chunkContent.length > 0) {
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

  // Extract classes as chunks
  for (const cls of symbols.classes) {
    const chunkContent = extractLines(lines, cls.line, cls.endLine);
    if (chunkContent.length > 0) {
      // If class is too large, split by methods
      if (chunkContent.length > MAX_CHUNK_CHARS && cls.methods.length > 0) {
        // Class header chunk
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

        // Method chunks
        for (const method of cls.methods) {
          const methodContent = extractLines(
            lines,
            method.line,
            method.endLine
          );
          if (methodContent.length > 0) {
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
      } else {
        chunks.push({
          filePath,
          symbolType: "class",
          symbolName: cls.name,
          startLine: cls.line,
          endLine: cls.endLine,
          content: chunkContent,
          importContext,
        });
      }
    }
  }

  // Extract interfaces as chunks
  for (const iface of symbols.interfaces) {
    const chunkContent = extractLines(lines, iface.line, iface.line + 30); // Interfaces are usually short
    if (chunkContent.length > 0) {
      chunks.push({
        filePath,
        symbolType: "interface",
        symbolName: iface.name,
        startLine: iface.line,
        endLine: iface.line + 30,
        content: chunkContent,
        importContext,
      });
    }
  }

  // Extract type aliases as chunks
  for (const ta of symbols.typeAliases) {
    const chunkContent = extractLines(lines, ta.line, ta.line + 20);
    if (chunkContent.length > 0) {
      chunks.push({
        filePath,
        symbolType: "type",
        symbolName: ta.name,
        startLine: ta.line,
        endLine: ta.line + 20,
        content: chunkContent,
        importContext,
      });
    }
  }

  // If no symbols found, fall back to whole-file chunk
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

function extractLines(
  lines: string[],
  startLine: number,
  endLine: number
): string {
  // Lines are 1-based in the symbol table
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  const extracted = lines.slice(start, end).join("\n");
  // Truncate to max chunk size
  return extracted.slice(0, MAX_CHUNK_CHARS);
}

const REACT_COMPONENT_RE = /^[A-Z]/;
const JSX_RE = /return\s*\(?[\s\S]*<|tsx|jsx/;

function isReactComponent(name: string, content: string): boolean {
  return REACT_COMPONENT_RE.test(name) && JSX_RE.test(content);
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
