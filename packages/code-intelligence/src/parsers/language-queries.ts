/**
 * Tree-sitter S-expression query patterns for multi-language symbol extraction.
 *
 * Each language defines queries for extracting functions, classes, interfaces/types,
 * imports, and exports. These patterns use Tree-sitter's query language to locate
 * structural code elements across 15 supported languages.
 */

/**
 * Unified symbol kinds extracted from code.
 */
export const SymbolKind = {
  Function: "function",
  Class: "class",
  Interface: "interface",
  Type: "type",
  Variable: "variable",
  Module: "module",
  Component: "component",
  Import: "import",
  Export: "export",
  Method: "method",
  Property: "property",
  Enum: "enum",
  Constant: "constant",
} as const;

export type SymbolKind = (typeof SymbolKind)[keyof typeof SymbolKind];

/**
 * A single tree-sitter query pattern for extracting a specific symbol kind.
 */
export interface LanguageQuery {
  /** Optional capture name for the symbol name within the pattern */
  captureNames: string[];
  /** The symbol kind this query extracts */
  kind: SymbolKind;
  /** Tree-sitter S-expression pattern */
  pattern: string;
}

type LanguageQueryMap = Record<string, LanguageQuery[]>;

// ─── TypeScript / TSX Queries ────────────────────────────────────

const typescriptQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_declaration name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Function,
    pattern:
      "(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function)))",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(class_declaration name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Interface,
    pattern: "(interface_declaration name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Type,
    pattern: "(type_alias_declaration name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Enum,
    pattern: "(enum_declaration name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(import_statement source: (string) @source)",
    captureNames: ["source"],
  },
  {
    kind: SymbolKind.Export,
    pattern: "(export_statement declaration: (_) @decl)",
    captureNames: ["decl"],
  },
  {
    kind: SymbolKind.Method,
    pattern: "(method_definition name: (property_identifier) @name)",
    captureNames: ["name"],
  },
];

// ─── Python Queries ──────────────────────────────────────────────

const pythonQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_definition name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(class_definition name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(import_statement name: (dotted_name) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(import_from_statement module_name: (dotted_name) @module)",
    captureNames: ["module"],
  },
  {
    kind: SymbolKind.Variable,
    pattern: "(assignment left: (identifier) @name)",
    captureNames: ["name"],
  },
];

// ─── Go Queries ──────────────────────────────────────────────────

const goQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_declaration name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Method,
    pattern: "(method_declaration name: (field_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Type,
    pattern: "(type_declaration (type_spec name: (type_identifier) @name))",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Interface,
    pattern:
      "(type_declaration (type_spec name: (type_identifier) @name type: (interface_type)))",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(import_spec path: (interpreted_string_literal) @path)",
    captureNames: ["path"],
  },
];

// ─── Rust Queries ────────────────────────────────────────────────

const rustQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_item name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(struct_item name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Interface,
    pattern: "(trait_item name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Enum,
    pattern: "(enum_item name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Type,
    pattern: "(type_item name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(use_declaration argument: (_) @path)",
    captureNames: ["path"],
  },
  {
    kind: SymbolKind.Method,
    pattern:
      "(impl_item (declaration_list (function_item name: (identifier) @name)))",
    captureNames: ["name"],
  },
];

// ─── Java Queries ────────────────────────────────────────────────

const javaQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(method_declaration name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(class_declaration name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Interface,
    pattern: "(interface_declaration name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Enum,
    pattern: "(enum_declaration name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(import_declaration) @import",
    captureNames: ["import"],
  },
];

// ─── Ruby Queries ────────────────────────────────────────────────

const rubyQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(method name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(class name: (constant) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Module,
    pattern: "(module name: (constant) @name)",
    captureNames: ["name"],
  },
];

// ─── PHP Queries ─────────────────────────────────────────────────

const phpQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_definition name: (name) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(class_declaration name: (name) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Interface,
    pattern: "(interface_declaration name: (name) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Method,
    pattern: "(method_declaration name: (name) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(namespace_use_declaration) @import",
    captureNames: ["import"],
  },
];

// ─── C Queries ───────────────────────────────────────────────────

const cQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern:
      "(function_definition declarator: (function_declarator declarator: (identifier) @name))",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Type,
    pattern: "(type_definition declarator: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(struct_specifier name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Enum,
    pattern: "(enum_specifier name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(preproc_include path: (_) @path)",
    captureNames: ["path"],
  },
];

// ─── C++ Queries ─────────────────────────────────────────────────

const cppQueries: LanguageQuery[] = [
  ...cQueries,
  {
    kind: SymbolKind.Class,
    pattern: "(class_specifier name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Module,
    pattern: "(namespace_definition name: (identifier) @name)",
    captureNames: ["name"],
  },
];

// ─── Kotlin Queries ──────────────────────────────────────────────

const kotlinQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_declaration (simple_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(class_declaration (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Interface,
    pattern: "(class_declaration (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(import_header (identifier) @path)",
    captureNames: ["path"],
  },
];

// ─── Swift Queries ───────────────────────────────────────────────

const swiftQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_declaration name: (simple_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(class_declaration name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Interface,
    pattern: "(protocol_declaration name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Enum,
    pattern: "(enum_declaration name: (type_identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(import_declaration) @import",
    captureNames: ["import"],
  },
];

// ─── Scala Queries ───────────────────────────────────────────────

const scalaQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_definition name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Class,
    pattern: "(class_definition name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Interface,
    pattern: "(trait_definition name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Module,
    pattern: "(object_definition name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Import,
    pattern: "(import_declaration) @import",
    captureNames: ["import"],
  },
];

// ─── Lua Queries ─────────────────────────────────────────────────

const luaQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_declaration name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Function,
    pattern: "(function_declaration name: (dot_index_expression) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Variable,
    pattern:
      "(variable_declaration (assignment_statement (variable_list (identifier) @name)))",
    captureNames: ["name"],
  },
];

// ─── Bash Queries ────────────────────────────────────────────────

const bashQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(function_definition name: (word) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Variable,
    pattern: "(variable_assignment name: (variable_name) @name)",
    captureNames: ["name"],
  },
];

// ─── SQL Queries ─────────────────────────────────────────────────

const sqlQueries: LanguageQuery[] = [
  {
    kind: SymbolKind.Function,
    pattern: "(create_function_statement name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Type,
    pattern: "(create_table_statement name: (identifier) @name)",
    captureNames: ["name"],
  },
  {
    kind: SymbolKind.Type,
    pattern: "(create_view_statement name: (identifier) @name)",
    captureNames: ["name"],
  },
];

// ─── Language Query Map ──────────────────────────────────────────

const LANGUAGE_QUERIES: LanguageQueryMap = {
  typescript: typescriptQueries,
  tsx: typescriptQueries,
  javascript: typescriptQueries,
  python: pythonQueries,
  go: goQueries,
  rust: rustQueries,
  java: javaQueries,
  ruby: rubyQueries,
  php: phpQueries,
  c: cQueries,
  cpp: cppQueries,
  kotlin: kotlinQueries,
  swift: swiftQueries,
  scala: scalaQueries,
  lua: luaQueries,
  bash: bashQueries,
  sql: sqlQueries,
};

/**
 * Get all tree-sitter query patterns for a given language.
 *
 * @param language - The language identifier
 * @returns Array of query patterns, or an empty array for unsupported languages
 */
export function getLanguageQueries(language: string): LanguageQuery[] {
  return LANGUAGE_QUERIES[language] ?? [];
}

// ─── Node-type to SymbolKind mapping ─────────────────────────────

const NODE_TYPE_MAP: Record<string, Record<string, SymbolKind>> = {
  typescript: {
    function_declaration: SymbolKind.Function,
    arrow_function: SymbolKind.Function,
    class_declaration: SymbolKind.Class,
    interface_declaration: SymbolKind.Interface,
    type_alias_declaration: SymbolKind.Type,
    enum_declaration: SymbolKind.Enum,
    import_statement: SymbolKind.Import,
    export_statement: SymbolKind.Export,
    method_definition: SymbolKind.Method,
    property_signature: SymbolKind.Property,
    lexical_declaration: SymbolKind.Variable,
  },
  python: {
    function_definition: SymbolKind.Function,
    class_definition: SymbolKind.Class,
    import_statement: SymbolKind.Import,
    import_from_statement: SymbolKind.Import,
    assignment: SymbolKind.Variable,
  },
  go: {
    function_declaration: SymbolKind.Function,
    method_declaration: SymbolKind.Method,
    type_declaration: SymbolKind.Type,
    interface_type: SymbolKind.Interface,
    import_spec: SymbolKind.Import,
    struct_type: SymbolKind.Class,
  },
  rust: {
    function_item: SymbolKind.Function,
    struct_item: SymbolKind.Class,
    trait_item: SymbolKind.Interface,
    enum_item: SymbolKind.Enum,
    type_item: SymbolKind.Type,
    use_declaration: SymbolKind.Import,
    impl_item: SymbolKind.Class,
  },
  java: {
    method_declaration: SymbolKind.Function,
    class_declaration: SymbolKind.Class,
    interface_declaration: SymbolKind.Interface,
    enum_declaration: SymbolKind.Enum,
    import_declaration: SymbolKind.Import,
  },
  ruby: {
    method: SymbolKind.Function,
    class: SymbolKind.Class,
    module: SymbolKind.Module,
  },
  php: {
    function_definition: SymbolKind.Function,
    class_declaration: SymbolKind.Class,
    interface_declaration: SymbolKind.Interface,
    method_declaration: SymbolKind.Method,
  },
  c: {
    function_definition: SymbolKind.Function,
    struct_specifier: SymbolKind.Class,
    enum_specifier: SymbolKind.Enum,
    type_definition: SymbolKind.Type,
    preproc_include: SymbolKind.Import,
  },
  cpp: {
    function_definition: SymbolKind.Function,
    class_specifier: SymbolKind.Class,
    struct_specifier: SymbolKind.Class,
    enum_specifier: SymbolKind.Enum,
    namespace_definition: SymbolKind.Module,
    preproc_include: SymbolKind.Import,
  },
  kotlin: {
    function_declaration: SymbolKind.Function,
    class_declaration: SymbolKind.Class,
    import_header: SymbolKind.Import,
  },
  swift: {
    function_declaration: SymbolKind.Function,
    class_declaration: SymbolKind.Class,
    protocol_declaration: SymbolKind.Interface,
    enum_declaration: SymbolKind.Enum,
    import_declaration: SymbolKind.Import,
  },
  scala: {
    function_definition: SymbolKind.Function,
    class_definition: SymbolKind.Class,
    trait_definition: SymbolKind.Interface,
    object_definition: SymbolKind.Module,
    import_declaration: SymbolKind.Import,
  },
  lua: {
    function_declaration: SymbolKind.Function,
  },
  bash: {
    function_definition: SymbolKind.Function,
    variable_assignment: SymbolKind.Variable,
  },
  sql: {
    create_function_statement: SymbolKind.Function,
    create_table_statement: SymbolKind.Type,
    create_view_statement: SymbolKind.Type,
  },
};

/**
 * Map a tree-sitter node type to a unified SymbolKind for a given language.
 *
 * @param language - The language identifier
 * @param nodeType - The tree-sitter node type string
 * @returns The corresponding SymbolKind, or SymbolKind.Variable as fallback
 */
export function mapToSymbolKind(
  language: string,
  nodeType: string
): SymbolKind {
  const langMap = NODE_TYPE_MAP[language] ?? NODE_TYPE_MAP.typescript;
  return langMap?.[nodeType] ?? SymbolKind.Variable;
}
