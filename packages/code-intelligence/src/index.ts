/**
 * @prometheus/code-intelligence
 *
 * Multi-language code parsing, symbol extraction, and structural search
 * powered by Tree-sitter WASM and ast-grep.
 */

// Cognee pipeline
export type {
  ChunkEmbedding,
  CodeChunk,
  CodeFile,
  FileClassification,
  FileSummary,
  GraphEdge as CogneeGraphEdge,
  GraphNode as CogneeGraphNode,
  KnowledgeGraph,
} from "./cognee/pipeline";
export { CogneePipeline } from "./cognee/pipeline";
export type {
  ExtractedSymbol,
  SymbolKind,
  SymbolTable,
} from "./extractors/symbol-extractor";
// Symbol extraction
export { extractSymbols } from "./extractors/symbol-extractor";
// Hybrid engine
export type {
  CodeRange,
  CodeSymbol,
  FileAnalysisResult,
  LSPClientConfig,
} from "./hybrid-engine";
export { HybridCodeEngine } from "./hybrid-engine";
export {
  FILE_EXTENSION_MAP,
  LANGUAGE_GRAMMAR_URLS,
} from "./parsers/language-grammars";
export type { LanguageQuery } from "./parsers/language-queries";
// Language queries
export {
  getLanguageQueries,
  mapToSymbolKind,
  SymbolKind as QuerySymbolKind,
} from "./parsers/language-queries";
export type {
  EditRange,
  ParseResult,
  SupportedLanguage,
} from "./parsers/tree-sitter-wasm";
// Parsers
export { TreeSitterParser } from "./parsers/tree-sitter-wasm";
export type {
  AntiPattern,
  AstGrepLanguage,
  AstGrepMatch,
} from "./search/ast-grep-engine";
// ast-grep search
export {
  astGrepReplace,
  astGrepSearch,
  searchAntiPatterns,
} from "./search/ast-grep-engine";
export type {
  MatchRange,
  ZoektResult,
  ZoektSearchOptions,
  ZoektSearchResponse,
  ZoektSearchStats,
} from "./search/zoekt-client";
// Zoekt code search
export { ZoektClient } from "./search/zoekt-client";
