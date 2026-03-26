/**
 * Language-specific context generation for agent system prompts.
 *
 * Given detected language information, produces contextual guidance that is
 * injected into role prompts via the `{LANGUAGE_CONTEXT}` placeholder.
 */

import type {
  DetectedLanguageInfo,
  LanguageDetectionResult,
  SupportedLanguage,
} from "./language-detector";

export type { LanguageDetectionResult } from "./language-detector";

// ---------------------------------------------------------------------------
// Per-language context templates
// ---------------------------------------------------------------------------

interface LanguageContextTemplate {
  /** CI/CD guidance (linting, formatting, build commands). */
  ci: string;
  /** General coding conventions and patterns. */
  conventions: string;
  /** Security considerations specific to this language. */
  security: string;
  /** Testing framework and patterns. */
  testing: string;
}

const LANGUAGE_TEMPLATES: Record<SupportedLanguage, LanguageContextTemplate> = {
  python: {
    conventions: `### Python Conventions
- Follow PEP 8 style guide. Use type hints on all function signatures (mypy strict mode).
- Use \`dataclasses\` or \`pydantic\` models for structured data, not plain dicts.
- Prefer \`pathlib.Path\` over \`os.path\` for file operations.
- Use virtual environments (\`venv\`, \`poetry\`, or \`uv\`) — never install into the global Python.
- Dependency management: \`pyproject.toml\` (preferred) or \`requirements.txt\`.
- Use \`async/await\` with \`asyncio\` for I/O-bound operations when the framework supports it.
- Prefer f-strings over \`.format()\` or \`%\` string formatting.`,
    testing: `### Python Testing
- Use **pytest** as the test runner. Structure tests in a \`tests/\` directory mirroring \`src/\`.
- Use \`pytest.fixture\` for shared setup; prefer factory fixtures over monolithic ones.
- Use \`pytest.mark.parametrize\` for data-driven tests.
- Mock external dependencies with \`unittest.mock.patch\` or \`pytest-mock\`.
- For async tests, use \`pytest-asyncio\` with \`@pytest.mark.asyncio\`.
- Aim for assertion-rich tests: assert on return values, side effects, and error messages.
- Run tests with: \`pytest -xvs\` (stop on first failure, verbose, no capture).`,
    ci: `### Python CI/CD
- Formatting: **black** (or **ruff format**) — run \`black .\` or \`ruff format .\` before committing.
- Linting: **ruff** (preferred) or **flake8** — run \`ruff check .\` to catch issues.
- Type checking: **mypy** — run \`mypy .\` with strict mode enabled.
- Dependency install: \`pip install -r requirements.txt\` or \`poetry install\`.
- CI pipeline order: install -> lint -> typecheck -> test -> build.`,
    security: `### Python Security
- Never use \`eval()\`, \`exec()\`, or \`__import__()\` with user input.
- Use parameterized queries with SQLAlchemy or Django ORM — never string-format SQL.
- Validate all inputs with Pydantic models or marshmallow schemas.
- Use \`secrets\` module for generating tokens, not \`random\`.
- Pin dependencies to exact versions in production.`,
  },

  go: {
    conventions: `### Go Conventions
- Follow standard Go conventions: exported names are PascalCase, unexported are camelCase.
- Handle errors explicitly — never discard errors with \`_\`. Use \`fmt.Errorf("context: %w", err)\` for wrapping.
- Use Go modules (\`go.mod\`) for dependency management.
- Prefer the standard library over third-party packages when feasible.
- Use interfaces for abstraction — accept interfaces, return structs.
- Use \`context.Context\` as the first parameter for functions that do I/O.
- Avoid init() functions — prefer explicit initialization.
- Use \`go fmt\` formatting (enforced by the compiler toolchain).`,
    testing: `### Go Testing
- Use the standard \`testing\` package. Test files are \`*_test.go\` in the same package.
- Use table-driven tests for exhaustive input coverage:
  \`\`\`go
  tests := []struct{ name string; input string; want string }{ ... }
  for _, tt := range tests {
      t.Run(tt.name, func(t *testing.T) { ... })
  }
  \`\`\`
- Use \`t.Helper()\` in test helper functions for better error reporting.
- Use \`testify/assert\` or \`testify/require\` for richer assertions (if already in deps).
- For integration tests, use build tags: \`//go:build integration\`.
- Run tests: \`go test ./...\` (all packages) or \`go test -v -run TestName ./pkg/\`.`,
    ci: `### Go CI/CD
- Formatting: \`go fmt ./...\` (or \`gofmt -s -w .\`) — must produce zero diffs.
- Linting: **golangci-lint** — run \`golangci-lint run\` for comprehensive static analysis.
- Vet: \`go vet ./...\` for suspicious constructs.
- Build: \`go build ./...\` to verify compilation.
- CI pipeline order: fmt check -> vet -> lint -> test -> build.`,
    security: `### Go Security
- Always validate and sanitize user input before use.
- Use \`crypto/rand\` for random bytes, not \`math/rand\`.
- Use parameterized queries with \`database/sql\` — never concatenate SQL strings.
- Set timeouts on HTTP clients and servers to prevent resource exhaustion.
- Use \`html/template\` (not \`text/template\`) for HTML output to prevent XSS.`,
  },

  rust: {
    conventions: `### Rust Conventions
- Follow Rust ownership and borrowing rules. Prefer borrowing (\`&T\`) over cloning.
- Use \`Result<T, E>\` for fallible operations — propagate errors with \`?\` operator.
- Define custom error types with \`thiserror\` or implement \`std::error::Error\`.
- Use \`clippy\` lints as guidance — fix all warnings before merging.
- Prefer iterators and combinators (\`.map()\`, \`.filter()\`, \`.collect()\`) over manual loops.
- Use \`cargo fmt\` formatting (rustfmt).
- Organize code with modules: \`mod.rs\` or inline \`mod\` declarations.
- Use \`#[derive(Debug, Clone, PartialEq)]\` on data types where appropriate.`,
    testing: `### Rust Testing
- Use the built-in \`#[test]\` attribute and \`cargo test\`.
- Place unit tests in a \`#[cfg(test)] mod tests { ... }\` block at the bottom of each file.
- Place integration tests in \`tests/\` directory at the crate root.
- Use \`assert_eq!\`, \`assert_ne!\`, and \`assert!\` macros for assertions.
- For async tests, use \`#[tokio::test]\` (or \`#[actix_rt::test]\` with actix).
- Use \`proptest\` or \`quickcheck\` for property-based testing of invariants.
- Run tests: \`cargo test\` (all) or \`cargo test test_name\` (specific).`,
    ci: `### Rust CI/CD
- Formatting: \`cargo fmt -- --check\` — must produce zero diffs.
- Linting: \`cargo clippy -- -D warnings\` — treat all warnings as errors.
- Build: \`cargo build\` (debug) or \`cargo build --release\` (optimized).
- CI pipeline order: fmt -> clippy -> test -> build.`,
    security: `### Rust Security
- Minimize \`unsafe\` blocks — document why they are necessary when used.
- Validate all external input before processing.
- Use \`sqlx\` or \`diesel\` with parameterized queries — never format SQL strings.
- Audit dependencies with \`cargo audit\`.
- Use \`secrecy\` crate for sensitive values to prevent accidental logging.`,
  },

  java: {
    conventions: `### Java Conventions
- Follow standard Java naming: PascalCase for classes, camelCase for methods/variables, UPPER_SNAKE for constants.
- Use records for immutable data carriers (Java 16+).
- Prefer \`Optional<T>\` over null returns. Never pass null as a method argument.
- Use dependency injection (constructor injection preferred) for testability.
- Follow SOLID principles — single responsibility per class.
- Use \`var\` for local variables when the type is obvious from the right-hand side.
- Close resources with try-with-resources, not finally blocks.`,
    testing: `### Java Testing
- Use **JUnit 5** (Jupiter) for unit tests, **Mockito** for mocking.
- Structure tests with \`@Nested\` classes for grouping related scenarios.
- Use \`@ParameterizedTest\` with \`@ValueSource\` or \`@MethodSource\` for data-driven tests.
- For Spring Boot: use \`@SpringBootTest\` for integration tests, \`@WebMvcTest\` for controller tests.
- Use \`AssertJ\` for fluent assertions: \`assertThat(result).isEqualTo(expected)\`.
- Place tests in \`src/test/java/\` mirroring the \`src/main/java/\` structure.
- Run tests: \`mvn test\` (Maven) or \`gradle test\` (Gradle).`,
    ci: `### Java CI/CD
- Build tool: **Maven** (\`mvn\`) or **Gradle** (\`gradle\`).
- Formatting: **google-java-format** or **Spotless** plugin.
- Linting: **Checkstyle**, **SpotBugs**, or **Error Prone**.
- Build: \`mvn package -DskipTests\` or \`gradle build -x test\`.
- CI pipeline order: compile -> lint/format check -> test -> package.`,
    security: `### Java Security
- Use PreparedStatement or JPA/Hibernate parameterized queries — never concatenate SQL.
- Validate inputs with Bean Validation (\`@Valid\`, \`@NotNull\`, \`@Size\`).
- Use \`java.security.SecureRandom\` for random values, not \`java.util.Random\`.
- Sanitize HTML output to prevent XSS (use OWASP Java Encoder).
- Keep dependencies updated — scan with \`mvn dependency-check:check\` or \`gradle dependencyCheckAnalyze\`.`,
  },

  ruby: {
    conventions: `### Ruby Conventions
- Follow the Ruby Style Guide: snake_case for methods/variables, PascalCase for classes/modules.
- Use \`frozen_string_literal: true\` magic comment at the top of every file.
- Prefer symbols over strings for hash keys.
- Use blocks, procs, and lambdas idiomatically. Prefer \`&:method_name\` shorthand.
- Use \`Bundler\` for dependency management with a \`Gemfile\`.
- Prefer keyword arguments for methods with more than 2 parameters.
- Use guard clauses (early returns) to reduce nesting.`,
    testing: `### Ruby Testing
- Use **RSpec** (preferred) or **Minitest** as the test framework.
- RSpec structure: \`describe\`, \`context\`, \`it\` blocks with descriptive strings.
- Use \`let\` and \`let!\` for lazy/eager test data setup.
- Use \`FactoryBot\` for test data factories, not fixtures.
- Mock external dependencies with RSpec mocks or \`WebMock\` for HTTP.
- For Rails: use \`rails_helper\`, \`request specs\` for API tests, \`system specs\` for E2E.
- Run tests: \`bundle exec rspec\` (all) or \`bundle exec rspec spec/path_spec.rb\` (specific).`,
    ci: `### Ruby CI/CD
- Formatting & Linting: **RuboCop** — run \`bundle exec rubocop\` to check, \`bundle exec rubocop -a\` to auto-fix.
- Type checking: **Sorbet** (if adopted) — run \`bundle exec srb tc\`.
- Dependency install: \`bundle install\`.
- CI pipeline order: install -> rubocop -> test -> build (if applicable).`,
    security: `### Ruby Security
- Use ActiveRecord parameterized queries — never interpolate into SQL strings.
- Use \`strong_parameters\` in Rails controllers — never use \`params.permit!\`.
- Sanitize HTML output with Rails \`sanitize\` helper or \`Loofah\`.
- Use \`SecureRandom\` for token generation, not \`rand\`.
- Run \`bundle audit\` to check for known vulnerabilities in dependencies.
- Enable CSRF protection in Rails (\`protect_from_forgery\`).`,
  },

  node: {
    conventions: `### Node.js/TypeScript Conventions
- Use TypeScript with strict mode enabled.
- Use async/await for all asynchronous operations.
- Prefer named exports over default exports.
- Use Biome/Ultracite for formatting and linting.
- Follow existing monorepo patterns (Turborepo, pnpm workspaces).`,
    testing: `### Node.js/TypeScript Testing
- Use Vitest for unit and integration tests.
- Use Playwright for E2E tests.
- Follow AAA pattern (Arrange, Act, Assert).
- Mock at boundaries (database, external APIs).`,
    ci: `### Node.js/TypeScript CI/CD
- Install: \`pnpm install\` (or npm/yarn as detected).
- Format & Lint: \`pnpm check\` or \`pnpm unsafe\` for auto-fix.
- Type check: \`pnpm typecheck\`.
- Test: \`pnpm test\`.
- Build: \`pnpm build\`.`,
    security: `### Node.js/TypeScript Security
- Validate all inputs with Zod schemas.
- Use parameterized queries via Drizzle ORM — never raw SQL.
- Use environment variables for secrets, never hardcode.
- Add rate limiting on public endpoints.`,
  },
};

// ---------------------------------------------------------------------------
// Framework-specific additions
// ---------------------------------------------------------------------------

const FRAMEWORK_CONTEXT: Record<string, string> = {
  fastapi: `
### FastAPI Patterns
- Use Pydantic models for request/response schemas.
- Use \`Depends()\` for dependency injection.
- Use \`APIRouter\` for route grouping.
- Use \`HTTPException\` for error responses with appropriate status codes.
- Use async def for route handlers that perform I/O.`,

  django: `
### Django Patterns
- Use class-based views (CBVs) for CRUD, function-based views for custom logic.
- Use Django REST Framework serializers for API input/output.
- Use Django ORM querysets — never raw SQL.
- Use \`select_related()\` and \`prefetch_related()\` to avoid N+1 queries.
- Manage database changes with Django migrations (\`manage.py makemigrations\`).`,

  flask: `
### Flask Patterns
- Use Blueprints for route grouping.
- Use Flask-SQLAlchemy or SQLAlchemy for database access.
- Use marshmallow or Pydantic for request validation.
- Register error handlers for consistent error responses.`,

  gin: `
### Gin Framework Patterns
- Use \`gin.Context\` for request/response handling.
- Group routes with \`router.Group()\`.
- Use middleware for cross-cutting concerns (auth, logging, CORS).
- Bind and validate request data with \`c.ShouldBindJSON()\`.
- Return consistent JSON responses with \`c.JSON()\`.`,

  fiber: `
### Fiber Framework Patterns
- Use \`fiber.Ctx\` for request/response handling.
- Group routes with \`app.Group()\`.
- Use middleware for auth, CORS, and rate limiting.
- Parse request body with \`c.BodyParser()\`.`,

  echo: `
### Echo Framework Patterns
- Use \`echo.Context\` for request/response handling.
- Group routes with \`e.Group()\`.
- Use middleware for cross-cutting concerns.
- Bind and validate with \`c.Bind()\`.`,

  axum: `
### Axum Framework Patterns
- Use extractors (\`Json\`, \`Path\`, \`Query\`, \`State\`) for request parsing.
- Use \`Router::new().route()\` for route definition.
- Use tower middleware for cross-cutting concerns.
- Return \`impl IntoResponse\` from handlers.
- Use \`tokio\` runtime for async operations.`,

  "actix-web": `
### Actix-Web Framework Patterns
- Use extractors (\`web::Json\`, \`web::Path\`, \`web::Query\`) for request parsing.
- Use \`web::scope()\` for route grouping.
- Use middleware for cross-cutting concerns.
- Use \`actix_rt\` for the async runtime.`,

  "spring-boot": `
### Spring Boot Patterns
- Use \`@RestController\` for API endpoints, \`@Service\` for business logic, \`@Repository\` for data access.
- Use constructor injection (not field injection) for dependencies.
- Use Spring Data JPA repositories for CRUD operations.
- Use \`@Transactional\` for operations that require atomicity.
- Use \`application.yml\` (preferred) or \`application.properties\` for configuration.
- Use profiles (\`@Profile\`) for environment-specific configuration.`,

  quarkus: `
### Quarkus Patterns
- Use JAX-RS annotations (\`@Path\`, \`@GET\`, \`@POST\`) for REST endpoints.
- Use CDI (\`@Inject\`, \`@ApplicationScoped\`) for dependency injection.
- Use Panache for simplified JPA/Hibernate operations.
- Use \`application.properties\` or \`application.yml\` for configuration.`,

  rails: `
### Ruby on Rails Patterns
- Follow Rails conventions: RESTful routes, MVC structure, convention over configuration.
- Use Active Record for database operations with migrations.
- Use strong parameters in controllers.
- Use concerns for shared model/controller behavior.
- Use service objects for complex business logic (keep controllers thin).
- Use Active Job for background processing.`,

  sinatra: `
### Sinatra Patterns
- Use modular style (\`class App < Sinatra::Base\`) for larger applications.
- Use before/after filters for cross-cutting concerns.
- Use Sequel or ActiveRecord for database access.`,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a language-specific context block for a single detected language.
 */
function buildLanguageBlock(info: DetectedLanguageInfo): string {
  const template = LANGUAGE_TEMPLATES[info.language];
  if (!template) {
    return "";
  }

  const parts = [
    `## Language Context: ${info.language.charAt(0).toUpperCase() + info.language.slice(1)}`,
    "",
    template.conventions,
    "",
    template.testing,
    "",
    template.ci,
    "",
    template.security,
  ];

  // Append framework-specific context if detected
  if (info.framework && FRAMEWORK_CONTEXT[info.framework]) {
    const fwCtx = FRAMEWORK_CONTEXT[info.framework];
    if (fwCtx) {
      parts.push("", fwCtx.trim());
    }
  }

  // Note the build tool if detected
  if (info.buildTool) {
    parts.push(
      "",
      `> **Detected build tool:** ${info.buildTool}. Use this tool for all build/dependency commands.`
    );
  }

  return parts.join("\n");
}

/**
 * Build the complete language context string from a detection result.
 *
 * For single-language projects, returns the full context block.
 * For multi-language projects (e.g., Python backend + Node frontend),
 * returns context for all detected languages, primary first.
 */
export function buildLanguageContext(
  detection: LanguageDetectionResult
): string {
  if (!detection.primary) {
    return "";
  }

  const blocks = detection.languages.map(buildLanguageBlock).filter(Boolean);

  if (blocks.length === 0) {
    return "";
  }

  if (blocks.length === 1) {
    return blocks[0] ?? "";
  }

  // Multi-language: add a header noting this is a polyglot project
  return [
    "## Multi-Language Project",
    "",
    `This project uses multiple languages: ${detection.languages.map((l) => l.language).join(", ")}. Follow the conventions for each language in the relevant parts of the codebase.`,
    "",
    blocks.join("\n\n---\n\n"),
  ].join("\n");
}

/**
 * Build a focused language context for a specific role.
 *
 * Different roles need different subsets of language context:
 * - backend-coder: conventions + security
 * - test-engineer: testing + conventions
 * - ci-loop: ci + testing
 * - security-auditor: security + conventions
 */
export function buildLanguageContextForRole(
  detection: LanguageDetectionResult,
  role: string
): string {
  if (!detection.primary) {
    return "";
  }

  // Most roles benefit from the full context
  const fullContextRoles = new Set([
    "backend-coder",
    "frontend-coder",
    "integration-coder",
    "architect",
  ]);

  if (fullContextRoles.has(role)) {
    return buildLanguageContext(detection);
  }

  // Roles that need focused subsets
  const info = detection.primary;
  const template = LANGUAGE_TEMPLATES[info.language];
  if (!template) {
    return "";
  }

  const parts: string[] = [
    `## Language Context: ${info.language.charAt(0).toUpperCase() + info.language.slice(1)}`,
    "",
  ];

  switch (role) {
    case "test-engineer":
      parts.push(template.testing, "", template.conventions);
      break;
    case "ci-loop":
      parts.push(template.ci, "", template.testing);
      break;
    case "security-auditor":
      parts.push(template.security, "", template.conventions);
      break;
    default:
      return buildLanguageContext(detection);
  }

  if (info.framework && FRAMEWORK_CONTEXT[info.framework]) {
    const fwCtx = FRAMEWORK_CONTEXT[info.framework];
    if (fwCtx) {
      parts.push("", fwCtx.trim());
    }
  }

  if (info.buildTool) {
    parts.push(
      "",
      `> **Detected build tool:** ${info.buildTool}. Use this tool for all build/dependency commands.`
    );
  }

  return parts.join("\n");
}
