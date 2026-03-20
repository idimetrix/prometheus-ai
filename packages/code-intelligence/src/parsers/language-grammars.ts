/**
 * Language grammar mappings for Tree-sitter WASM parsers.
 *
 * Maps language identifiers to their CDN-hosted WASM grammar URLs
 * and file extensions to language identifiers.
 * Supports 40+ languages via a structured LanguageGrammar registry.
 */

const TREE_SITTER_CDN_BASE =
  "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@latest/out";

/**
 * Structured definition of a language grammar.
 */
export interface LanguageGrammar {
  /** File extensions (without leading dot) mapped to this language */
  extensions: string[];
  /** CDN URL or npm package for the Tree-sitter WASM grammar */
  grammarPackage: string;
  /** Tree-sitter highlight query S-expressions (optional) */
  highlightQueries?: string;
  /** Unique language identifier */
  languageId: string;
}

// ─── Grammar Registry ────────────────────────────────────────────

function grammar(
  languageId: string,
  extensions: string[],
  wasmName: string,
  highlightQueries?: string
): LanguageGrammar {
  return {
    languageId,
    extensions,
    grammarPackage: `${TREE_SITTER_CDN_BASE}/${wasmName}.wasm`,
    highlightQueries,
  };
}

/**
 * Registry of 40+ language grammars keyed by language ID.
 */
export const GRAMMAR_REGISTRY: Map<string, LanguageGrammar> = new Map([
  [
    "typescript",
    grammar(
      "typescript",
      ["ts", "mts", "cts"],
      "tree-sitter-typescript",
      "(function_declaration name: (identifier) @function)"
    ),
  ],
  [
    "tsx",
    grammar(
      "tsx",
      ["tsx"],
      "tree-sitter-tsx",
      "(function_declaration name: (identifier) @function)"
    ),
  ],
  [
    "javascript",
    grammar(
      "javascript",
      ["js", "jsx", "mjs", "cjs"],
      "tree-sitter-javascript",
      "(function_declaration name: (identifier) @function)"
    ),
  ],
  [
    "python",
    grammar(
      "python",
      ["py", "pyi", "pyw"],
      "tree-sitter-python",
      "(function_definition name: (identifier) @function)"
    ),
  ],
  [
    "rust",
    grammar(
      "rust",
      ["rs"],
      "tree-sitter-rust",
      "(function_item name: (identifier) @function)"
    ),
  ],
  [
    "go",
    grammar(
      "go",
      ["go"],
      "tree-sitter-go",
      "(function_declaration name: (identifier) @function)"
    ),
  ],
  [
    "java",
    grammar(
      "java",
      ["java"],
      "tree-sitter-java",
      "(method_declaration name: (identifier) @function)"
    ),
  ],
  [
    "c",
    grammar(
      "c",
      ["c", "h"],
      "tree-sitter-c",
      "(function_definition declarator: (function_declarator declarator: (identifier) @function))"
    ),
  ],
  [
    "cpp",
    grammar(
      "cpp",
      ["cpp", "cc", "cxx", "hpp", "hxx", "hh"],
      "tree-sitter-cpp",
      "(function_definition declarator: (function_declarator declarator: (identifier) @function))"
    ),
  ],
  [
    "csharp",
    grammar(
      "csharp",
      ["cs"],
      "tree-sitter-c-sharp",
      "(method_declaration name: (identifier) @function)"
    ),
  ],
  [
    "ruby",
    grammar(
      "ruby",
      ["rb", "rake", "gemspec"],
      "tree-sitter-ruby",
      "(method name: (identifier) @function)"
    ),
  ],
  [
    "php",
    grammar(
      "php",
      ["php"],
      "tree-sitter-php",
      "(function_definition name: (name) @function)"
    ),
  ],
  [
    "swift",
    grammar(
      "swift",
      ["swift"],
      "tree-sitter-swift",
      "(function_declaration name: (simple_identifier) @function)"
    ),
  ],
  [
    "kotlin",
    grammar(
      "kotlin",
      ["kt", "kts"],
      "tree-sitter-kotlin",
      "(function_declaration (simple_identifier) @function)"
    ),
  ],
  [
    "scala",
    grammar(
      "scala",
      ["scala", "sc"],
      "tree-sitter-scala",
      "(function_definition name: (identifier) @function)"
    ),
  ],
  [
    "dart",
    grammar(
      "dart",
      ["dart"],
      "tree-sitter-dart",
      "(function_signature name: (identifier) @function)"
    ),
  ],
  [
    "lua",
    grammar(
      "lua",
      ["lua"],
      "tree-sitter-lua",
      "(function_declaration name: (identifier) @function)"
    ),
  ],
  [
    "haskell",
    grammar(
      "haskell",
      ["hs", "lhs"],
      "tree-sitter-haskell",
      "(function name: (variable) @function)"
    ),
  ],
  [
    "elixir",
    grammar(
      "elixir",
      ["ex", "exs"],
      "tree-sitter-elixir",
      "(call target: (identifier) @keyword)"
    ),
  ],
  [
    "clojure",
    grammar("clojure", ["clj", "cljs", "cljc", "edn"], "tree-sitter-clojure"),
  ],
  [
    "r",
    grammar(
      "r",
      ["r", "R", "rmd"],
      "tree-sitter-r",
      "(function_definition name: (identifier) @function)"
    ),
  ],
  [
    "julia",
    grammar(
      "julia",
      ["jl"],
      "tree-sitter-julia",
      "(function_definition name: (identifier) @function)"
    ),
  ],
  [
    "zig",
    grammar(
      "zig",
      ["zig"],
      "tree-sitter-zig",
      "(function_declaration name: (identifier) @function)"
    ),
  ],
  ["nim", grammar("nim", ["nim", "nims"], "tree-sitter-nim")],
  [
    "ocaml",
    grammar(
      "ocaml",
      ["ml", "mli"],
      "tree-sitter-ocaml",
      "(value_definition pattern: (value_name) @function)"
    ),
  ],
  ["erlang", grammar("erlang", ["erl", "hrl"], "tree-sitter-erlang")],
  [
    "perl",
    grammar(
      "perl",
      ["pl", "pm"],
      "tree-sitter-perl",
      "(function_definition name: (identifier) @function)"
    ),
  ],
  [
    "bash",
    grammar(
      "bash",
      ["sh", "bash", "zsh"],
      "tree-sitter-bash",
      "(function_definition name: (word) @function)"
    ),
  ],
  ["sql", grammar("sql", ["sql"], "tree-sitter-sql")],
  [
    "html",
    grammar("html", ["html", "htm"], "tree-sitter-html", "(tag_name) @tag"),
  ],
  [
    "css",
    grammar(
      "css",
      ["css"],
      "tree-sitter-css",
      "(class_selector (class_name) @class)"
    ),
  ],
  ["scss", grammar("scss", ["scss", "sass"], "tree-sitter-scss")],
  ["json", grammar("json", ["json", "jsonc"], "tree-sitter-json")],
  ["yaml", grammar("yaml", ["yml", "yaml"], "tree-sitter-yaml")],
  ["toml", grammar("toml", ["toml"], "tree-sitter-toml")],
  ["markdown", grammar("markdown", ["md", "mdx"], "tree-sitter-markdown")],
  [
    "dockerfile",
    grammar("dockerfile", ["dockerfile"], "tree-sitter-dockerfile"),
  ],
  [
    "hcl",
    grammar(
      "hcl",
      ["hcl", "tf", "tfvars"],
      "tree-sitter-hcl",
      "(block (identifier) @keyword)"
    ),
  ],
  ["protobuf", grammar("protobuf", ["proto"], "tree-sitter-protobuf")],
  ["graphql", grammar("graphql", ["graphql", "gql"], "tree-sitter-graphql")],
  ["svelte", grammar("svelte", ["svelte"], "tree-sitter-svelte")],
  ["vue", grammar("vue", ["vue"], "tree-sitter-vue")],
  ["astro", grammar("astro", ["astro"], "tree-sitter-astro")],
]);

// ─── Derived lookup tables (backwards-compatible) ────────────────

/**
 * CDN URLs for Tree-sitter WASM grammar files, keyed by language ID.
 */
export const LANGUAGE_GRAMMAR_URLS: Record<string, string> = Object.fromEntries(
  [...GRAMMAR_REGISTRY.values()].map((g) => [g.languageId, g.grammarPackage])
);

/**
 * Maps file extensions (without leading dot) to language identifiers.
 */
export const FILE_EXTENSION_MAP: Record<string, string> = Object.fromEntries(
  [...GRAMMAR_REGISTRY.values()].flatMap((g) =>
    g.extensions.map((ext) => [ext, g.languageId])
  )
);

// ─── Public API ──────────────────────────────────────────────────

/**
 * Get the grammar definition for a language by its ID.
 *
 * @param languageId - The language identifier (e.g. "typescript", "rust")
 * @returns The grammar definition, or undefined if not registered
 */
export function getGrammar(languageId: string): LanguageGrammar | undefined {
  return GRAMMAR_REGISTRY.get(languageId);
}

/** Internal extension-to-grammar lookup (built once, lazily) */
let extensionIndex: Map<string, LanguageGrammar> | null = null;

function getExtensionIndex(): Map<string, LanguageGrammar> {
  if (!extensionIndex) {
    extensionIndex = new Map<string, LanguageGrammar>();
    for (const g of GRAMMAR_REGISTRY.values()) {
      for (const ext of g.extensions) {
        extensionIndex.set(ext, g);
      }
    }
  }
  return extensionIndex;
}

/**
 * Get the grammar definition for a file extension (without leading dot).
 *
 * @param ext - File extension, e.g. "ts", "py", "rs"
 * @returns The grammar definition, or undefined if no match
 */
export function getGrammarByExtension(
  ext: string
): LanguageGrammar | undefined {
  return getExtensionIndex().get(ext.toLowerCase());
}

/**
 * Get a sorted list of all supported language IDs.
 *
 * @returns Array of language identifiers (e.g. ["astro", "bash", "c", ...])
 */
export function getSupportedLanguages(): string[] {
  return [...GRAMMAR_REGISTRY.keys()].sort();
}
