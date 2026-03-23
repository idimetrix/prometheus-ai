/**
 * Language-specific prompt extensions for code generation agents.
 * Each variant adds language idioms, patterns, and linting rules
 * to guide agents toward idiomatic code in the target language.
 */

const LANGUAGE_GUIDELINES: Record<string, string> = {
  typescript: `## TypeScript Guidelines
- Use strict mode with \`noUncheckedIndexedAccess\` and \`exactOptionalPropertyTypes\`
- Prefer \`unknown\` over \`any\`; use type guards for narrowing
- Use \`as const\` assertions for literal types and immutable config objects
- Prefer \`interface\` for object shapes, \`type\` for unions/intersections
- Use discriminated unions for state machines and variant types
- Prefer \`readonly\` arrays and properties where mutation is not needed
- Use \`satisfies\` operator to validate types without widening
- Import types with \`import type { ... }\` to avoid runtime imports
- Use optional chaining (\`?.\`) and nullish coalescing (\`??\`) over manual checks
- Format with Biome or Prettier; lint with Biome or ESLint with strict config
- Prefer named exports over default exports
- Avoid enums; use \`as const\` objects or union types instead
- Use \`Map\`/\`Set\` for lookups instead of plain objects when keys are dynamic
- Handle async errors with try/catch; never leave promises unhandled
- Use \`Awaited<ReturnType<typeof fn>>\` for inferred async return types`,

  python: `## Python Guidelines
- Target Python 3.11+ with type hints on all function signatures
- Use \`dataclasses\` or \`pydantic\` models for structured data, not raw dicts
- Prefer f-strings over \`.format()\` or \`%\` formatting
- Use \`pathlib.Path\` instead of \`os.path\` for file operations
- Prefer list/dict/set comprehensions over \`map()\`/\`filter()\` with lambdas
- Use \`match/case\` (structural pattern matching) for complex conditionals
- Always use context managers (\`with\`) for file and resource handling
- Raise specific exceptions (e.g., \`ValueError\`, \`TypeError\`), never bare \`Exception\`
- Use \`logging\` module with structured formatters, not \`print()\` for debugging
- Format with \`ruff format\`; lint with \`ruff check\` (replaces black + flake8 + isort)
- Use \`__all__\` to control public API exports from modules
- Prefer \`enum.Enum\` for fixed sets of constants
- Use \`typing.Protocol\` for structural subtyping (duck typing with type safety)
- Avoid mutable default arguments (use \`None\` + assignment in body)
- Use \`asyncio\` with \`async/await\` for I/O-bound concurrency`,

  rust: `## Rust Guidelines
- Use \`Result<T, E>\` for fallible operations; avoid \`.unwrap()\` in production code
- Prefer \`.expect("context")\` over \`.unwrap()\` when panicking is intentional
- Use \`?\` operator for error propagation in functions returning \`Result\`
- Prefer \`thiserror\` for library errors, \`anyhow\` for application errors
- Use \`clippy\` with \`#![warn(clippy::all, clippy::pedantic)]\` for linting
- Format with \`rustfmt\` (cargo fmt)
- Prefer iterators and \`.collect()\` over manual loops with \`.push()\`
- Use \`&str\` for function parameters, \`String\` for owned data
- Prefer \`impl Trait\` in function signatures for zero-cost abstraction
- Use \`derive\` macros: \`Debug\`, \`Clone\`, \`PartialEq\` as baseline for structs
- Avoid \`unsafe\` unless performance-critical and well-documented
- Use \`Arc<Mutex<T>>\` or \`tokio::sync::Mutex\` for shared mutable state
- Prefer \`Option::map\`/\`and_then\` over \`if let Some(x)\` for transformations
- Use \`cargo doc\` comments (\`///\`) for all public items
- Use \`mod.rs\` or file-per-module patterns consistently`,

  go: `## Go Guidelines
- Return errors as the last return value; check them immediately
- Use \`errors.Is()\` and \`errors.As()\` for error comparison, not \`==\`
- Wrap errors with \`fmt.Errorf("context: %w", err)\` for stack context
- Use \`context.Context\` as the first parameter for functions with I/O
- Prefer table-driven tests with \`t.Run()\` subtests
- Use \`golangci-lint\` with strict config for linting; \`gofmt\`/\`goimports\` for formatting
- Prefer short variable declarations (\`:=\`) inside functions
- Use interfaces for dependencies (accept interfaces, return structs)
- Keep interfaces small (1-3 methods); define them where they are consumed
- Avoid \`init()\` functions; use explicit initialization
- Use \`sync.Pool\` for frequently allocated objects; \`sync.Map\` for concurrent maps
- Prefer channels for goroutine communication over shared memory
- Use \`defer\` for cleanup; order matters (LIFO)
- Name return values only when it improves documentation (naked returns are discouraged)
- Use struct embedding for composition, not inheritance patterns`,

  java: `## Java Guidelines
- Target Java 21+ with records, sealed interfaces, and pattern matching
- Use \`record\` types for immutable data carriers instead of POJOs
- Prefer \`sealed\` interfaces with \`permits\` for restricted type hierarchies
- Use \`Optional<T>\` for nullable returns; never return \`null\` from public methods
- Prefer \`var\` for local variables when the type is obvious from context
- Use \`Stream\` API for collection transformations; avoid side effects in streams
- Prefer \`switch\` expressions with arrow syntax and exhaustiveness checking
- Use \`try-with-resources\` for all \`AutoCloseable\` resources
- Format with \`google-java-format\`; lint with \`Checkstyle\` or \`Error Prone\`
- Use \`@Nullable\`/\`@NonNull\` annotations for null safety documentation
- Prefer composition over inheritance; favor interfaces with default methods
- Use \`ConcurrentHashMap\` over synchronized wrappers for concurrent access
- Prefer \`List.of()\`/\`Map.of()\` for immutable collections
- Use SLF4J with Logback for structured logging; never \`System.out.println\`
- Organize imports: java.*, javax.*, third-party, project; no wildcard imports`,

  kotlin: `## Kotlin Guidelines
- Use \`data class\` for value objects; \`sealed class\`/\`sealed interface\` for ADTs
- Prefer \`val\` over \`var\`; use immutable collections by default
- Use \`when\` expressions (exhaustive for sealed types) instead of if/else chains
- Use \`?.let { }\`, \`?:\` (elvis), and safe calls for null handling
- Prefer extension functions for utility operations on existing types
- Use \`suspend\` functions and \`Flow\` for async operations (coroutines)
- Prefer \`require()\`/\`check()\` for preconditions over manual if/throw
- Use \`object\` declarations for singletons; \`companion object\` for factory methods
- Format with \`ktlint\`; lint with \`detekt\` for static analysis
- Use scope functions appropriately: \`let\` (transform), \`apply\` (configure), \`also\` (side effect)
- Prefer \`lazy { }\` delegate for expensive computed properties
- Use \`inline\` functions for higher-order functions to avoid lambda allocation
- Avoid \`!!\` (non-null assertion); use safe alternatives or explicit checks
- Prefer named arguments for functions with multiple parameters of the same type
- Use \`sequence { }\` for lazy evaluation of large collection pipelines`,

  swift: `## Swift Guidelines
- Use \`struct\` by default; \`class\` only when reference semantics are needed
- Prefer \`guard let\`/\`guard var\` for early exits over nested \`if let\`
- Use \`enum\` with associated values for state machines and discriminated unions
- Prefer \`Result<Success, Failure>\` for functions that can fail
- Use \`async/await\` with structured concurrency (\`TaskGroup\`, \`async let\`)
- Prefer \`[weak self]\` in closures to avoid retain cycles
- Use \`Codable\` protocol for JSON serialization/deserialization
- Format with \`swift-format\`; lint with \`SwiftLint\` using strict rules
- Use \`@MainActor\` for UI-bound code; actors for thread-safe mutable state
- Prefer protocol-oriented design over class inheritance
- Use \`defer\` for cleanup code that must run on scope exit
- Prefer \`map\`/\`compactMap\`/\`flatMap\` over manual loops with append
- Use \`@frozen\` for public enums that won't gain new cases
- Avoid force unwrapping (\`!\`); use optional binding or nil coalescing (\`??\`)
- Use access control: \`private\` by default, \`internal\`/\`public\` as needed`,

  "c++": `## C++ Guidelines
- Target C++20 or later; use concepts, ranges, and \`std::format\`
- Prefer \`std::unique_ptr\` for single ownership, \`std::shared_ptr\` only when shared
- Use RAII for all resource management; never manual new/delete in application code
- Prefer \`std::optional<T>\` over sentinel values or out-parameters
- Use \`std::variant\` and \`std::visit\` for type-safe unions
- Prefer \`constexpr\` functions and variables for compile-time computation
- Use \`std::span<T>\` for non-owning views of contiguous memory
- Use \`std::string_view\` for read-only string parameters
- Format with \`clang-format\`; lint with \`clang-tidy\` and \`cppcheck\`
- Prefer range-based for loops and \`std::ranges\` algorithms over raw iterators
- Use \`[[nodiscard]]\` on functions whose return values must not be ignored
- Avoid \`const_cast\` and \`reinterpret_cast\`; minimize \`static_cast\`
- Use structured bindings (\`auto [a, b] = ...\`) for tuple/pair decomposition
- Prefer \`enum class\` over unscoped enums for type safety
- Use namespaces to organize code; avoid \`using namespace std;\` in headers`,

  ruby: `## Ruby Guidelines
- Use frozen string literal comment (\`# frozen_string_literal: true\`) at file top
- Prefer \`Symbol\` keys in hashes over string keys for internal use
- Use \`&.\` (safe navigation) for nil-safe method chains
- Prefer \`each_with_object\` or \`reduce\` over manual accumulator patterns
- Use \`Struct\` or \`Data\` (Ruby 3.2+) for simple value objects
- Prefer blocks and \`yield\` for inversion-of-control patterns
- Use \`raise\` with specific exception classes, not generic \`RuntimeError\`
- Format with \`rubocop\` using project-specific \`.rubocop.yml\`
- Prefer \`unless\` for simple negative conditions; avoid \`unless...else\`
- Use \`fetch\` with default for hash access to avoid silent nil returns
- Prefer string interpolation (\`"hello #{name}"\`) over concatenation
- Use \`private\`/\`protected\` visibility modifiers; keep public API minimal
- Prefer \`Module#prepend\` over \`alias_method\` for method wrapping
- Use \`Enumerable\` methods (\`map\`, \`select\`, \`reject\`, \`find\`) over manual loops
- Use \`begin/rescue/ensure\` for error handling; log errors with structured data`,

  php: `## PHP Guidelines
- Target PHP 8.2+; use typed properties, enums, readonly classes, and fibers
- Use strict types: declare \`declare(strict_types=1);\` at file top
- Use union types and intersection types for precise type declarations
- Prefer \`match\` expression over \`switch\` for value-returning conditionals
- Use \`readonly\` properties and classes for immutable value objects
- Prefer named arguments for functions with multiple optional parameters
- Use \`enum\` (backed enums) instead of class constants for fixed sets
- Use \`null-safe operator\` (\`?->\`) for null-safe method chains
- Format with \`PHP-CS-Fixer\` or \`Laravel Pint\`; lint with \`PHPStan\` level 9
- Use PSR-4 autoloading; follow PSR-12 coding style
- Prefer constructor promotion for simple dependency injection
- Use \`array_map\`/\`array_filter\`/\`array_reduce\` over manual foreach loops
- Use interfaces for dependency injection; avoid concrete class dependencies
- Prefer exceptions over error codes; use custom exception hierarchies
- Use \`Fiber\` or libraries like ReactPHP/Amp for async I/O operations`,
};

/** Normalized aliases mapping to canonical language names */
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  javascript: "typescript",
  py: "python",
  python3: "python",
  rs: "rust",
  golang: "go",
  kt: "kotlin",
  "c++": "c++",
  cpp: "c++",
  cxx: "c++",
  rb: "ruby",
  swift: "swift",
  java: "java",
  php: "php",
  typescript: "typescript",
  python: "python",
  rust: "rust",
  go: "go",
  kotlin: "kotlin",
  ruby: "ruby",
};

/**
 * Returns language-specific prompt guidelines for the given language.
 * Covers idiomatic patterns, common pitfalls, linting/formatting tools,
 * and import conventions for the top 10 supported languages.
 *
 * @param language - Language name or common alias (e.g., "ts", "py", "rs")
 * @returns Language guidelines string, or a generic fallback if unsupported
 */
export function getLanguageGuidelines(language: string): string {
  const normalized = language.toLowerCase().trim();
  const canonical = LANGUAGE_ALIASES[normalized] ?? normalized;
  const guidelines = LANGUAGE_GUIDELINES[canonical];

  if (guidelines) {
    return guidelines;
  }

  return `## ${language} Guidelines
- Follow the language's official style guide and idioms
- Use the community-standard linter and formatter
- Handle errors explicitly; never silently swallow exceptions
- Prefer immutable data structures where possible
- Write clear, self-documenting code with meaningful names`;
}

/**
 * Returns the list of all supported language identifiers.
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_GUIDELINES);
}
