/**
 * Language grammar mappings for Tree-sitter WASM parsers.
 *
 * Maps language identifiers to their CDN-hosted WASM grammar URLs
 * and file extensions to language identifiers.
 */

const TREE_SITTER_CDN_BASE =
  "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@latest/out";

/**
 * CDN URLs for Tree-sitter WASM grammar files, keyed by language ID.
 */
export const LANGUAGE_GRAMMAR_URLS: Record<string, string> = {
  typescript: `${TREE_SITTER_CDN_BASE}/tree-sitter-typescript.wasm`,
  tsx: `${TREE_SITTER_CDN_BASE}/tree-sitter-tsx.wasm`,
  javascript: `${TREE_SITTER_CDN_BASE}/tree-sitter-javascript.wasm`,
  python: `${TREE_SITTER_CDN_BASE}/tree-sitter-python.wasm`,
  go: `${TREE_SITTER_CDN_BASE}/tree-sitter-go.wasm`,
  rust: `${TREE_SITTER_CDN_BASE}/tree-sitter-rust.wasm`,
  java: `${TREE_SITTER_CDN_BASE}/tree-sitter-java.wasm`,
  c: `${TREE_SITTER_CDN_BASE}/tree-sitter-c.wasm`,
  cpp: `${TREE_SITTER_CDN_BASE}/tree-sitter-cpp.wasm`,
  ruby: `${TREE_SITTER_CDN_BASE}/tree-sitter-ruby.wasm`,
  php: `${TREE_SITTER_CDN_BASE}/tree-sitter-php.wasm`,
  swift: `${TREE_SITTER_CDN_BASE}/tree-sitter-swift.wasm`,
  kotlin: `${TREE_SITTER_CDN_BASE}/tree-sitter-kotlin.wasm`,
  scala: `${TREE_SITTER_CDN_BASE}/tree-sitter-scala.wasm`,
  haskell: `${TREE_SITTER_CDN_BASE}/tree-sitter-haskell.wasm`,
  lua: `${TREE_SITTER_CDN_BASE}/tree-sitter-lua.wasm`,
  bash: `${TREE_SITTER_CDN_BASE}/tree-sitter-bash.wasm`,
  css: `${TREE_SITTER_CDN_BASE}/tree-sitter-css.wasm`,
  html: `${TREE_SITTER_CDN_BASE}/tree-sitter-html.wasm`,
  json: `${TREE_SITTER_CDN_BASE}/tree-sitter-json.wasm`,
  yaml: `${TREE_SITTER_CDN_BASE}/tree-sitter-yaml.wasm`,
  toml: `${TREE_SITTER_CDN_BASE}/tree-sitter-toml.wasm`,
  sql: `${TREE_SITTER_CDN_BASE}/tree-sitter-sql.wasm`,
  graphql: `${TREE_SITTER_CDN_BASE}/tree-sitter-graphql.wasm`,
  protobuf: `${TREE_SITTER_CDN_BASE}/tree-sitter-protobuf.wasm`,
  dockerfile: `${TREE_SITTER_CDN_BASE}/tree-sitter-dockerfile.wasm`,
  markdown: `${TREE_SITTER_CDN_BASE}/tree-sitter-markdown.wasm`,
};

/**
 * Maps file extensions (without leading dot) to language identifiers.
 */
export const FILE_EXTENSION_MAP: Record<string, string> = {
  // TypeScript
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",

  // JavaScript
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",

  // Python
  py: "python",
  pyi: "python",
  pyw: "python",

  // Go
  go: "go",

  // Rust
  rs: "rust",

  // Java
  java: "java",

  // C / C++
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",

  // Ruby
  rb: "ruby",
  rake: "ruby",
  gemspec: "ruby",

  // PHP
  php: "php",

  // Swift
  swift: "swift",

  // Kotlin
  kt: "kotlin",
  kts: "kotlin",

  // Scala
  scala: "scala",
  sc: "scala",

  // Haskell
  hs: "haskell",
  lhs: "haskell",

  // Lua
  lua: "lua",

  // Bash / Shell
  sh: "bash",
  bash: "bash",
  zsh: "bash",

  // CSS
  css: "css",

  // HTML
  html: "html",
  htm: "html",

  // JSON
  json: "json",
  jsonc: "json",

  // YAML
  yml: "yaml",
  yaml: "yaml",

  // TOML
  toml: "toml",

  // SQL
  sql: "sql",

  // GraphQL
  graphql: "graphql",
  gql: "graphql",

  // Protobuf
  proto: "protobuf",

  // Dockerfile
  dockerfile: "dockerfile",

  // Markdown
  md: "markdown",
  mdx: "markdown",
};
