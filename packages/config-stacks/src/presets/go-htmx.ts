import type { TechStackPresetExtended } from "./types";

export const GO_HTMX_PRESET: TechStackPresetExtended = {
  id: "go-htmx",
  name: "Go + HTMX",
  description: "Go stdlib + Axum-style patterns + HTMX + Templ + PostgreSQL",
  languages: ["Go"],
  frameworks: ["Go stdlib", "Chi router", "HTMX", "Templ"],
  database: "PostgreSQL 16",
  orm: "sqlc",
  auth: "Session-based with bcrypt",
  testing: ["Go testing", "testify", "Playwright"],
  deployment: ["Docker", "GitHub Actions"],
  packageManager: "go modules",
  linters: ["golangci-lint"],
  icon: "terminal",

  dependencies: {
    runtime: {
      "github.com/go-chi/chi/v5": "v5.1.0",
      "github.com/jackc/pgx/v5": "v5.7.0",
      "github.com/a-h/templ": "v0.3.0",
      "github.com/gorilla/sessions": "v1.4.0",
      "github.com/go-playground/validator/v10": "v10.23.0",
      "github.com/rs/zerolog": "v1.33.0",
      "golang.org/x/crypto": "latest",
    },
    dev: {
      "github.com/sqlc-dev/sqlc": "v1.27.0",
      "github.com/golangci/golangci-lint": "v1.62.0",
      "github.com/air-verse/air": "v1.61.0",
    },
  },

  fileTemplates: {
    "cmd/server/main.go":
      "Entry point with Chi router, middleware chain, and graceful shutdown",
    "internal/handler/routes.go": "Route definitions grouped by resource",
    "internal/handler/middleware.go":
      "Auth, logging, recovery, org-scoping middleware",
    "internal/db/queries.sql": "SQL queries for sqlc generation",
    "internal/db/sqlc.yaml": "sqlc configuration file",
    "internal/templates/layout.templ": "Base HTML layout with HTMX script",
    "internal/templates/pages/index.templ":
      "Landing page with HTMX interactions",
    Dockerfile: "Multi-stage Go build with distroless base",
  },

  conventions: {
    routing:
      "Chi router with grouped routes. HTMX partial responses for dynamic UI",
    stateManagement:
      "Server-side state. HTMX swaps for partial page updates. No client-side state management needed",
    apiPattern:
      "HTTP handlers returning HTML partials (for HTMX) or JSON (for API). Chi middleware chain",
    componentPattern:
      "Templ components for type-safe HTML templates. HTMX attributes for interactivity",
    styling: "Tailwind CSS via standalone CLI. Minimal JavaScript",
    projectStructure: "Standard Go project layout: cmd/, internal/, pkg/",
  },

  agentHints: {
    architect:
      "Design with Go stdlib patterns. Use Chi for routing. HTMX for dynamic UI without a JS framework. sqlc for type-safe SQL.",
    frontend_coder:
      "Write Templ templates with HTMX attributes. Use hx-get, hx-post, hx-swap for dynamic behavior. Minimal custom JS.",
    backend_coder:
      "Write Go handlers following standard patterns. Use sqlc for database access. Implement middleware for cross-cutting concerns.",
    test_engineer:
      "Use Go table-driven tests. httptest for handler testing. testify for assertions. Playwright for E2E.",
    deploy_engineer:
      "Multi-stage Docker with scratch or distroless base. Single binary deployment. Health check endpoint.",
  },
};
