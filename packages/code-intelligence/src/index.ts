/**
 * @prometheus/code-intelligence
 *
 * Multi-language code parsing, symbol extraction, and structural search
 * powered by Tree-sitter WASM and ast-grep.
 */

// ─── AST Diff Analyzer ──────────────────────────────────────────
export type {
  EntityKind,
  StructuralChange,
  StructuralChangeType,
  StructuralDiffResult,
} from "./analyzers/ast-diff";
export { AstDiffAnalyzer } from "./analyzers/ast-diff";

// ─── Cognee pipeline ────────────────────────────────────────────
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

// ─── Context Selector ───────────────────────────────────────────
export type {
  ContextChunk,
  ContextSelectionResult,
} from "./context/context-selector";
export { CodeContextSelector } from "./context/context-selector";

// ─── Cross-File Resolver ────────────────────────────────────────
export type {
  ExportedSymbol,
  ImportedSymbol,
  ResolvedSymbol,
} from "./extractors/cross-file-resolver";
export { CrossFileResolver } from "./extractors/cross-file-resolver";

// ─── Symbol extraction ──────────────────────────────────────────
export type {
  ExtractedSymbol,
  SymbolKind,
  SymbolTable,
} from "./extractors/symbol-extractor";
export { extractSymbols } from "./extractors/symbol-extractor";

// ─── Hybrid engine ──────────────────────────────────────────────
export type {
  CodeRange,
  CodeSymbol,
  FileAnalysisResult,
  LSPClientConfig,
} from "./hybrid-engine";
export { HybridCodeEngine } from "./hybrid-engine";

// ─── Incremental Indexer ────────────────────────────────────────
export type {
  IndexedFileInfo,
  IndexFileCallback,
  IndexResult,
  IndexStatus,
} from "./indexing/incremental-indexer";
export { IncrementalIndexer } from "./indexing/incremental-indexer";

// ─── Language Grammars ──────────────────────────────────────────
export type { LanguageGrammar } from "./parsers/language-grammars";
export {
  FILE_EXTENSION_MAP,
  GRAMMAR_REGISTRY,
  getGrammar,
  getGrammarByExtension,
  getSupportedLanguages,
  LANGUAGE_GRAMMAR_URLS,
} from "./parsers/language-grammars";

// ─── Language Queries ───────────────────────────────────────────
export type { LanguageQuery, QueryPattern } from "./parsers/language-queries";
export {
  getLanguageQueries,
  getQueryPatterns,
  mapToSymbolKind,
  SymbolKind as QuerySymbolKind,
} from "./parsers/language-queries";

// ─── Parsers ────────────────────────────────────────────────────
export type {
  EditRange,
  ParseResult,
  SupportedLanguage,
} from "./parsers/tree-sitter-wasm";
export { TreeSitterParser } from "./parsers/tree-sitter-wasm";

// ─── ast-grep search ────────────────────────────────────────────
export type {
  AntiPattern,
  AstGrepLanguage,
  AstGrepMatch,
} from "./search/ast-grep-engine";
export {
  astGrepReplace,
  astGrepSearch,
  searchAntiPatterns,
} from "./search/ast-grep-engine";

// ─── Zoekt code search ─────────────────────────────────────────
export type {
  MatchRange,
  ZoektResult,
  ZoektSearchOptions,
  ZoektSearchResponse,
  ZoektSearchStats,
} from "./search/zoekt-client";
export { ZoektClient } from "./search/zoekt-client";
