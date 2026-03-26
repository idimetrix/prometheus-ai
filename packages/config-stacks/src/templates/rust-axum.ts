import type { ProjectTemplate, ScaffoldFile } from "./types";

function scaffoldFiles(projectName: string): ScaffoldFile[] {
  const _crateName = projectName.replace(/-/g, "_");
  return [
    {
      path: "Cargo.toml",
      content: `[package]
name = "${projectName}"
version = "0.1.0"
edition = "2024"

[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
tower = "0.5"
tower-http = { version = "0.6", features = ["cors", "trace"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "postgres", "uuid", "time"] }
uuid = { version = "1", features = ["v4", "serde"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
thiserror = "2"
anyhow = "1"
dotenvy = "0.15"

[dev-dependencies]
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["test-util"] }
`,
    },
    {
      path: "src/main.rs",
      content: `use std::net::SocketAddr;

use axum::Router;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod error;
mod routes;
mod state;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost:5432/${projectName}".into());

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    sqlx::migrate!().run(&pool).await?;

    let state = state::AppState { db: pool };

    let app = Router::new()
        .merge(routes::router())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 4000));
    tracing::info!("Listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
`,
    },
    {
      path: "src/state.rs",
      content: `use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
}
`,
    },
    {
      path: "src/routes/mod.rs",
      content: `use axum::{Router, routing::get, Json};
use serde_json::{json, Value};

use crate::state::AppState;

pub mod health;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health_check))
        .route("/api/hello", get(hello))
}

async fn hello() -> Json<Value> {
    Json(json!({ "greeting": "Hello world!" }))
}
`,
    },
    {
      path: "src/routes/health.rs",
      content: `use axum::Json;
use serde_json::{json, Value};

pub async fn health_check() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
`,
    },
    {
      path: "src/error.rs",
      content: `use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found")]
    NotFound,
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            Self::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            Self::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".into(),
            ),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}
`,
    },
    {
      path: "migrations/00001_init.sql",
      content: `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
    },
    {
      path: ".env.example",
      content: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${projectName}
RUST_LOG=info
`,
    },
    {
      path: ".gitignore",
      content: `target/
.env
`,
    },
    {
      path: "Dockerfile",
      content: `FROM rust:1.83-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY . .
RUN cargo build --release

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/target/release/${projectName} /app
EXPOSE 4000
ENTRYPOINT ["/app"]
`,
    },
    {
      path: "README.md",
      content: `# ${projectName}

Rust API built with **Axum**, **SQLx**, and **PostgreSQL**.

## Getting Started

\`\`\`bash
cp .env.example .env
cargo run            # http://localhost:4000
\`\`\`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /api/hello | Greeting |
`,
    },
  ];
}

export const RUST_AXUM_TEMPLATE: ProjectTemplate = {
  id: "rust-axum",
  name: "Rust Axum API",
  description:
    "Rust API with Axum web framework, SQLx for type-safe PostgreSQL queries, and Tower middleware.",
  category: "Backend",
  techStack: ["Rust", "Axum", "SQLx", "PostgreSQL", "Tokio"],
  languages: ["Rust"],
  icon: "shield",
  estimatedMinutes: 5,
  scaffoldFiles,
};
