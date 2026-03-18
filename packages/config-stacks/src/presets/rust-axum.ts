import type { TechStackPresetExtended } from "./types";

export const RUST_AXUM_PRESET: TechStackPresetExtended = {
  id: "rust-axum",
  name: "Rust + Axum",
  description: "Axum web framework + SQLx + PostgreSQL + Tokio async runtime",
  languages: ["Rust"],
  frameworks: ["Axum", "Tokio", "Tower", "SQLx"],
  database: "PostgreSQL 16",
  orm: "SQLx",
  auth: "JWT + argon2",
  testing: ["cargo test", "reqwest", "tokio::test"],
  deployment: ["Docker", "GitHub Actions"],
  packageManager: "cargo",
  linters: ["clippy", "rustfmt"],
  icon: "shield",

  dependencies: {
    runtime: {
      axum: "0.8",
      tokio: "1.42",
      tower: "0.5",
      "tower-http": "0.6",
      sqlx: "0.8",
      serde: "1.0",
      serde_json: "1.0",
      jsonwebtoken: "9.3",
      argon2: "0.5",
      tracing: "0.1",
      "tracing-subscriber": "0.3",
      uuid: "1.11",
      thiserror: "2.0",
      anyhow: "1.0",
    },
    dev: {
      reqwest: "0.12",
      testcontainers: "0.23",
      fake: "3.0",
    },
  },

  fileTemplates: {
    "src/main.rs":
      "Entry point with Axum router, middleware layers, and graceful shutdown",
    "src/routes/mod.rs": "Route module aggregating all route groups",
    "src/routes/auth.rs": "Authentication routes (register, login, refresh)",
    "src/handlers/mod.rs": "Handler functions organized by domain",
    "src/db/mod.rs": "Database pool setup and migration runner",
    "src/db/queries/mod.rs": "SQLx query functions with compile-time checking",
    "src/middleware/auth.rs": "JWT extraction and validation middleware",
    "src/error.rs": "Custom error types with IntoResponse implementations",
    "migrations/": "SQLx migrations directory",
    Dockerfile:
      "Multi-stage build: cargo-chef for caching, distroless for runtime",
  },

  conventions: {
    routing: "Axum Router with nested route groups. Tower middleware layers",
    stateManagement:
      "Server-side state via Axum State extractor. Arc<AppState> for shared state",
    apiPattern:
      "JSON API with Axum extractors (Path, Query, Json). Custom error types with proper HTTP status codes",
    componentPattern:
      "Handler functions accepting extractors. Service layer for business logic. Repository pattern for DB access",
    styling: "Not applicable (backend only). Can pair with any frontend",
    projectStructure:
      "src/routes/, src/handlers/, src/db/, src/middleware/, src/error.rs",
  },

  agentHints: {
    architect:
      "Design with Axum extractors and Tower middleware. Use SQLx for compile-time checked queries. Custom error types for clean error handling.",
    frontend_coder:
      "This is a backend-only preset. Pair with a separate frontend preset if needed.",
    backend_coder:
      "Write async handlers with Axum extractors. Use SQLx query macros for type-safe SQL. Implement Tower middleware for cross-cutting concerns.",
    test_engineer:
      "Use #[tokio::test] for async tests. testcontainers for integration tests with real PostgreSQL. reqwest for API-level tests.",
    deploy_engineer:
      "Multi-stage Docker with cargo-chef for dependency caching. Distroless or scratch base image. Single statically-linked binary.",
  },
};
