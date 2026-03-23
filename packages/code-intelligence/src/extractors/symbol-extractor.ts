/**
 * Universal symbol extraction from Tree-sitter AST nodes.
 *
 * Extracts functions, classes, imports, exports, and interfaces from
 * parsed ASTs in a language-agnostic manner using Tree-sitter node types.
 */

import { createLogger } from "@prometheus/logger";
import type { Node } from "web-tree-sitter";
import type { SupportedLanguage } from "../parsers/tree-sitter-wasm";

const logger = createLogger("code-intelligence:symbol-extractor");

/**
 * Categories of symbols that can be extracted from source code.
 */
export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type_alias"
  | "enum"
  | "import"
  | "export"
  | "variable"
  | "method"
  | "property";

/**
 * A symbol extracted from the AST with location information.
 */
export interface ExtractedSymbol {
  /** End column (0-indexed) */
  endColumn: number;
  /** End line (0-indexed) */
  endLine: number;
  /** Whether the symbol is exported */
  isExported: boolean;
  /** The kind of symbol */
  kind: SymbolKind;
  /** Language-specific metadata */
  metadata: Record<string, unknown>;
  /** Symbol name (e.g., function name, class name) */
  name: string;
  /** Parent symbol name, if nested (e.g., method inside a class) */
  parent?: string;
  /** Source module for re-exports (e.g., "./utils") */
  reExportSource?: string;
  /** Full function/method signature (e.g., "(a: string, b: number) => boolean") */
  signature?: string;
  /** Start column (0-indexed) */
  startColumn: number;
  /** Start line (0-indexed) */
  startLine: number;
  /** The full text of the symbol's defining node */
  text: string;
  /** Type annotation or return type */
  typeInfo?: string;
}

/**
 * Collection of extracted symbols organized by kind.
 */
export interface SymbolTable {
  /** Symbols grouped by kind for quick lookup */
  byKind: Record<SymbolKind, ExtractedSymbol[]>;
  /** Total number of symbols extracted */
  count: number;
  /** Language that was parsed */
  language: SupportedLanguage;
  /** All extracted symbols in document order */
  symbols: ExtractedSymbol[];
}

/**
 * Tree-sitter node type names that correspond to each symbol kind.
 * These are the most common names across languages; language-specific
 * overrides are handled in `LANGUAGE_NODE_OVERRIDES`.
 */
const NODE_TYPE_TO_SYMBOL_KIND: Record<string, SymbolKind> = {
  // Functions
  function_declaration: "function",
  function_definition: "function",
  arrow_function: "function",
  function_item: "function", // Rust
  func_literal: "function", // Go

  // Methods
  method_declaration: "method",
  method_definition: "method",

  // Classes
  class_declaration: "class",
  class_definition: "class",
  struct_item: "class", // Rust
  struct_specifier: "class", // C/C++

  // Interfaces
  interface_declaration: "interface",
  abstract_class_declaration: "interface",
  trait_item: "interface", // Rust
  protocol_declaration: "interface", // Swift

  // Type aliases
  type_alias_declaration: "type_alias",
  type_item: "type_alias", // Rust

  // Enums
  enum_declaration: "enum",
  enum_item: "enum", // Rust
  enum_specifier: "enum", // C/C++

  // Imports
  import_statement: "import",
  import_declaration: "import",
  use_declaration: "import", // Rust

  // Exports
  export_statement: "export",

  // Variables / Constants
  lexical_declaration: "variable",
  variable_declaration: "variable",
  const_item: "variable", // Rust
  static_item: "variable", // Rust
};

/**
 * Language-specific node type overrides.
 */
const LANGUAGE_NODE_OVERRIDES: Partial<
  Record<SupportedLanguage, Record<string, SymbolKind>>
> = {
  python: {
    decorated_definition: "function", // handles @decorator\ndef ...
    class_definition: "class",
  },
  go: {
    function_declaration: "function",
    method_declaration: "method",
    type_declaration: "type_alias",
    type_spec: "type_alias",
  },
  ruby: {
    method: "method",
    singleton_method: "method",
    class: "class",
    module: "class",
  },
};

/**
 * Try to extract a name from a tree-sitter node.
 * Looks for common child field names across languages.
 */
function extractNodeName(node: Node): string | undefined {
  // Direct name field (most common)
  const nameNode =
    node.childForFieldName("name") ??
    node.childForFieldName("declarator") ??
    node.childForFieldName("pattern");

  if (nameNode) {
    // Handle complex declarators (e.g., C++ function_declarator)
    const innerName = nameNode.childForFieldName("name");
    if (innerName) {
      return innerName.text;
    }
    return nameNode.text;
  }

  // For variable declarations, look for the first identifier child
  for (const child of node.children) {
    if (child.type === "variable_declarator") {
      const varName = child.childForFieldName("name");
      if (varName) {
        return varName.text;
      }
    }
  }

  return undefined;
}

/**
 * Determine if a node represents an exported symbol.
 */
function isNodeExported(node: Node): boolean {
  const parent = node.parent;
  if (!parent) {
    return false;
  }

  // JS/TS: export statement wraps the declaration
  if (parent.type === "export_statement") {
    return true;
  }

  // Check for export keyword in the node text (e.g., "export function ...")
  const firstChild = node.firstChild;
  if (firstChild && firstChild.type === "export") {
    return true;
  }

  // Rust: pub keyword
  if (node.text.startsWith("pub ")) {
    return true;
  }

  // Go: capitalized names are exported
  const name = extractNodeName(node);
  if (name && name.length > 0) {
    const firstChar = name.charAt(0);
    if (
      firstChar === firstChar.toUpperCase() &&
      firstChar !== firstChar.toLowerCase()
    ) {
      // Could be Go — only treat as exported if it's actually Go
      // This is handled at the caller level via language parameter
      return false; // Don't auto-mark here, handle in extractSymbols
    }
  }

  return false;
}

/**
 * Extract function/method signature from a tree-sitter node.
 * Returns the parameter list and return type as a string.
 */
function extractSignature(node: Node): string | undefined {
  const params = node.childForFieldName("parameters");
  const returnType = node.childForFieldName("return_type");

  if (!params) {
    return undefined;
  }

  let sig = params.text;
  if (returnType) {
    sig += `: ${returnType.text}`;
  }

  return sig;
}

/**
 * Extract type information from a node.
 * For type aliases, interfaces, and variables with type annotations.
 */
function extractTypeInfo(node: Node, kind: SymbolKind): string | undefined {
  if (kind === "type_alias") {
    // Type alias: the value after '='
    const value = node.childForFieldName("value");
    if (value) {
      return value.text;
    }
  }

  if (kind === "interface") {
    // Interface body
    const body = node.childForFieldName("body");
    if (body) {
      return body.text;
    }
  }

  if (kind === "function" || kind === "method") {
    const returnType = node.childForFieldName("return_type");
    if (returnType) {
      return returnType.text;
    }
  }

  if (kind === "variable") {
    // Check for type annotation on variable declarator
    for (const child of node.children) {
      if (child.type === "variable_declarator") {
        const typeAnnotation = child.childForFieldName("type");
        if (typeAnnotation) {
          return typeAnnotation.text;
        }
      }
    }
  }

  return undefined;
}

/**
 * Extract class hierarchy info (extends/implements).
 */
function extractClassHierarchy(node: Node): {
  extendsClass?: string;
  implementsInterfaces?: string[];
} {
  const result: { extendsClass?: string; implementsInterfaces?: string[] } = {};

  for (const child of node.children) {
    if (child.type === "extends_clause" || child.type === "class_heritage") {
      // The extends target is typically the first type identifier
      const typeNode = child.childForFieldName("value") ?? child.children[1];
      if (typeNode) {
        result.extendsClass = typeNode.text;
      }
    }

    if (child.type === "implements_clause") {
      result.implementsInterfaces = [];
      for (const impl of child.children) {
        if (impl.type === "type_identifier" || impl.type === "generic_type") {
          result.implementsInterfaces.push(impl.text);
        }
      }
    }
  }

  return result;
}

/**
 * Extract re-export source from an export statement node.
 * Detects patterns like: export { X } from './y'
 */
function extractReExportSource(node: Node): string | undefined {
  // Check if this is a re-export (export ... from '...')
  if (node.type !== "export_statement") {
    return undefined;
  }

  const source = node.childForFieldName("source");
  if (source) {
    // Remove quotes from the string literal
    return source.text.replace(/^["']|["']$/g, "");
  }

  // Fallback: look for a string child after 'from'
  let foundFrom = false;
  for (const child of node.children) {
    if (child.type === "from") {
      foundFrom = true;
      continue;
    }
    if (foundFrom && child.type === "string") {
      return child.text.replace(/^["']|["']$/g, "");
    }
  }

  return undefined;
}

/**
 * Check if a node is a dynamic import expression.
 */
function isDynamicImport(node: Node): boolean {
  return (
    node.type === "call_expression" &&
    node.children.length > 0 &&
    node.children[0]?.type === "import"
  );
}

/**
 * Extract dynamic import source from a call expression.
 */
function extractDynamicImportSource(node: Node): string | undefined {
  if (!isDynamicImport(node)) {
    return undefined;
  }

  const args = node.childForFieldName("arguments");
  if (args && args.children.length > 1) {
    const firstArg = args.children[1];
    if (firstArg?.type === "string") {
      return firstArg.text.replace(/^["']|["']$/g, "");
    }
  }

  return undefined;
}

/**
 * Walk the AST and collect symbols.
 */
function tryExtractDynamicImport(
  node: Node,
  parentName: string | undefined
): ExtractedSymbol | null {
  if (!isDynamicImport(node)) {
    return null;
  }
  const source = extractDynamicImportSource(node);
  if (!source) {
    return null;
  }
  return {
    name: source,
    kind: "import",
    startLine: node.startPosition.row,
    endLine: node.endPosition.row,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
    text: node.text,
    parent: parentName,
    isExported: false,
    metadata: { isDynamic: true },
    reExportSource: undefined,
  };
}

function buildSymbolMetadata(
  kind: SymbolKind,
  node: Node
): { metadata: Record<string, unknown>; reExportSource: string | undefined } {
  const reExportSource =
    kind === "export" ? extractReExportSource(node) : undefined;

  const hierarchy =
    kind === "class" || kind === "interface"
      ? extractClassHierarchy(node)
      : undefined;

  const metadata: Record<string, unknown> = {};
  if (hierarchy?.extendsClass) {
    metadata.extends = hierarchy.extendsClass;
  }
  if (
    hierarchy?.implementsInterfaces &&
    hierarchy.implementsInterfaces.length > 0
  ) {
    metadata.implements = hierarchy.implementsInterfaces;
  }
  if (reExportSource) {
    metadata.reExportSource = reExportSource;
  }

  return { metadata, reExportSource };
}

function walkTree(
  node: Node,
  language: SupportedLanguage,
  parentName?: string
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  const dynamicImport = tryExtractDynamicImport(node, parentName);
  if (dynamicImport) {
    symbols.push(dynamicImport);
  }

  const overrides = LANGUAGE_NODE_OVERRIDES[language] ?? {};
  const kind = overrides[node.type] ?? NODE_TYPE_TO_SYMBOL_KIND[node.type];

  if (kind) {
    const name =
      extractNodeName(node) ?? `<anonymous:${node.startPosition.row}>`;
    const isExported = isNodeExported(node) || checkGoExport(name, language);
    const signature =
      kind === "function" || kind === "method"
        ? extractSignature(node)
        : undefined;
    const typeInfo = extractTypeInfo(node, kind);
    const { metadata, reExportSource } = buildSymbolMetadata(kind, node);

    symbols.push({
      name,
      kind,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      text: node.text,
      parent: parentName,
      isExported,
      metadata,
      signature,
      typeInfo,
      reExportSource,
    });

    if (kind === "class" || kind === "interface") {
      for (const child of node.children) {
        symbols.push(...walkTree(child, language, name));
      }
      return symbols;
    }
  }

  for (const child of node.children) {
    symbols.push(...walkTree(child, language, parentName));
  }

  return symbols;
}

/**
 * In Go, capitalized identifiers are exported.
 */
function checkGoExport(name: string, language: SupportedLanguage): boolean {
  if (language !== "go") {
    return false;
  }
  if (name.length === 0) {
    return false;
  }
  const firstChar = name.charAt(0);
  return (
    firstChar === firstChar.toUpperCase() &&
    firstChar !== firstChar.toLowerCase()
  );
}

/**
 * Group symbols by their kind.
 */
function groupByKind(
  symbols: ExtractedSymbol[]
): Record<SymbolKind, ExtractedSymbol[]> {
  const groups: Record<SymbolKind, ExtractedSymbol[]> = {
    function: [],
    class: [],
    interface: [],
    type_alias: [],
    enum: [],
    import: [],
    export: [],
    variable: [],
    method: [],
    property: [],
  };

  for (const symbol of symbols) {
    groups[symbol.kind].push(symbol);
  }

  return groups;
}

/**
 * Extract all symbols from a parsed Tree-sitter tree.
 *
 * Walks the AST and identifies functions, classes, interfaces, imports,
 * exports, and other named declarations. Works across all supported languages
 * using Tree-sitter's consistent node type naming.
 *
 * @param tree - A parsed Tree-sitter tree
 * @param language - The language the tree was parsed as
 * @returns A SymbolTable containing all extracted symbols
 *
 * @example
 * ```ts
 * const parser = new TreeSitterParser();
 * await parser.init();
 * const result = await parser.parse(code, "typescript");
 * const symbols = extractSymbols(result.tree, "typescript");
 *
 * for (const fn of symbols.byKind.function) {
 *   console.log(`Function: ${fn.name} at line ${fn.startLine}`);
 * }
 * ```
 */
export function extractSymbols(
  tree: import("web-tree-sitter").Tree,
  language: SupportedLanguage
): SymbolTable {
  const start = performance.now();
  const symbols = walkTree(tree.rootNode, language);
  const elapsed = Math.round(performance.now() - start);

  logger.debug(
    { language, symbolCount: symbols.length, durationMs: elapsed },
    `Extracted ${symbols.length} symbols from ${language} AST in ${elapsed}ms`
  );

  return {
    symbols,
    byKind: groupByKind(symbols),
    language,
    count: symbols.length,
  };
}
