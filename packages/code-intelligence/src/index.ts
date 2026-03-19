/**
 * @prometheus/code-intelligence
 *
 * Multi-language code parsing, symbol extraction, and structural search
 * powered by Tree-sitter WASM and ast-grep.
 */

export type {
  ExtractedSymbol,
  SymbolKind,
  SymbolTable,
} from "./extractors/symbol-extractor";
// Symbol extraction
export { extractSymbols } from "./extractors/symbol-extractor";
export {
  FILE_EXTENSION_MAP,
  LANGUAGE_GRAMMAR_URLS,
} from "./parsers/language-grammars";
export type {
  ParseResult,
  SupportedLanguage,
} from "./parsers/tree-sitter-wasm";
// Parsers
export { TreeSitterParser } from "./parsers/tree-sitter-wasm";
export type { AstGrepLanguage, AstGrepMatch } from "./search/ast-grep-engine";
// ast-grep search
export { astGrepReplace, astGrepSearch } from "./search/ast-grep-engine";
export type {
  MatchRange,
  ZoektResult,
  ZoektSearchOptions,
  ZoektSearchResponse,
  ZoektSearchStats,
} from "./search/zoekt-client";
// Zoekt code search
export { ZoektClient } from "./search/zoekt-client";
