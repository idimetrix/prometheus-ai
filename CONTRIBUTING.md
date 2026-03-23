# Contributing to Prometheus

Thank you for your interest in contributing to Prometheus! This guide will help you get started.

## Table of Contents

- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Plugin Development](#plugin-development)
- [Template Contributions](#template-contributions)
- [Code of Conduct](#code-of-conduct)

---

## Development Setup

### Prerequisites

- **Node.js** 20+ (LTS recommended)
- **pnpm** 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker** and Docker Compose (for PostgreSQL, Redis, MinIO)

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/your-org/prometheus.git
cd prometheus

# 2. Start infrastructure services
docker compose up -d

# 3. Install dependencies
pnpm install

# 4. Configure environment
cp .env.example .env
# Edit .env with your local settings

# 5. Set up the database
pnpm db:push

# 6. Start development
pnpm dev
```

### Service URLs (Local Dev)

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| Socket Server | http://localhost:4001 |
| Orchestrator | http://localhost:4002 |
| Project Brain | http://localhost:4003 |
| Model Router | http://localhost:4004 |
| MCP Gateway | http://localhost:4005 |
| Sandbox Manager | http://localhost:4006 |

### Useful Commands

```bash
pnpm dev          # Start all services
pnpm build        # Build all packages
pnpm typecheck    # TypeScript check
pnpm test         # Run all tests
pnpm lint         # Lint check (read-only)
pnpm unsafe       # Auto-fix lint + formatting
```

---

## Code Style

Prometheus uses **Ultracite** (built on Biome) for formatting and linting. There is no Prettier or ESLint configuration -- Ultracite handles everything.

### Key Rules

- **TypeScript:** Use explicit types, avoid `any`. Prefer `unknown` + type guards.
- **Async/Await:** Always use `async/await` over raw promise chains.
- **React:** Functional components with hooks. Named exports preferred.
- **Imports:** Use `@prometheus/*` package aliases. No relative imports across package boundaries.
- **IDs:** Always use `generateId()` from `@prometheus/utils`.
- **Logging:** Use `createLogger()` from `@prometheus/logger`.
- **Database:** Drizzle ORM only -- never write raw SQL.
- **Validation:** Zod schemas from `@prometheus/validators` for all inputs.

### Before Committing

The repository has a Lefthook pre-commit hook that auto-formats staged files. You can also run manually:

```bash
pnpm unsafe       # Fix all formatting + lint issues
pnpm typecheck    # Verify TypeScript compiles cleanly
pnpm test         # Ensure tests pass
```

---

## Pull Request Process

### Branch Naming

- `feat/description` -- New features
- `fix/description` -- Bug fixes
- `refactor/description` -- Code refactoring
- `docs/description` -- Documentation changes
- `claude/issue-NUMBER` -- AI-generated branches

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add workflow builder component
fix: resolve race condition in queue worker
refactor: extract shared validation logic
chore: update dependencies
docs: add API documentation for PM router
test: add integration tests for transfer learning
```

### PR Checklist

Before submitting a pull request:

1. [ ] `pnpm unsafe` passes with no remaining issues
2. [ ] `pnpm typecheck` passes with zero errors
3. [ ] `pnpm test` passes (all tests green)
4. [ ] `pnpm build` succeeds
5. [ ] PR description explains **what** and **why**
6. [ ] If adding a new API route, it is registered in the router index
7. [ ] If adding a new package, it is added to `pnpm-workspace.yaml`

### Review Process

- All PRs require at least one approval before merge
- CI must pass (lint, typecheck, test, build)
- Squash merge is preferred for feature branches

---

## Issue Guidelines

### Bug Reports

Use the **"Report a Bug"** issue template. Include:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)

### Feature Requests

Use the **"Feature Request"** issue template. Include:

- Problem description (what pain point does this solve?)
- Proposed solution
- Alternatives considered

---

## Plugin Development

Prometheus supports a plugin system for extending agent capabilities.

### Plugin Structure

```
my-plugin/
  package.json
  src/
    index.ts        # Plugin entry point
    manifest.json   # Plugin metadata
```

### Plugin Manifest

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your Name",
  "permissions": ["read:projects", "write:tasks"],
  "entryPoint": "src/index.ts"
}
```

### Plugin API

Plugins receive a context object with access to:

- `ctx.db` -- Database client (scoped to the org)
- `ctx.logger` -- Structured logger
- `ctx.events` -- Event emitter for lifecycle hooks

### Testing Plugins

```bash
# Run plugin tests
pnpm test --filter=my-plugin
```

---

## Template Contributions

Prometheus uses project templates to bootstrap new projects.

### Adding a Template

1. Create a directory under `packages/templates/`
2. Include a `template.json` manifest:

```json
{
  "name": "my-template",
  "description": "Template description",
  "category": "web|api|fullstack|library",
  "files": ["**/*"],
  "variables": {
    "projectName": { "description": "Project name", "default": "my-project" }
  }
}
```

3. Add template files with `{{variable}}` placeholders
4. Add tests to verify template generation works correctly

---

## Code of Conduct

We are committed to providing a welcoming and inclusive experience for everyone. All contributors are expected to:

- Be respectful and considerate in all interactions
- Accept constructive criticism gracefully
- Focus on what is best for the community and the project
- Show empathy towards other community members

Harassment, discrimination, and disrespectful behavior will not be tolerated. Violations may result in removal from the project.

For concerns, contact the maintainers at conduct@prometheus.dev.
