# PROMETHEUS

AI-powered engineering platform with 12 specialist agents.

## Project Structure

- Turborepo monorepo with pnpm workspaces
- `apps/` - 9 services (web, api, orchestrator, queue-worker, socket-server, mcp-gateway, model-router, project-brain, sandbox-manager)
- `packages/` - 15 shared packages
- `infra/` - Docker, k8s manifests, deployment scripts
- `.claude/skills/` - Architecture, database, API, and deployment skill references

## Commands

```bash
pnpm dev          # Start all services in dev mode
pnpm build        # Build all packages
pnpm typecheck    # TypeScript check all packages
pnpm test         # Run all tests
pnpm test --filter=@prometheus/api    # Test specific package
pnpm lint         # Biome lint (read-only)
pnpm format       # Format with Ultracite (error-level)
pnpm check        # Ultracite read-only check (format + lint)
pnpm fix          # Ultracite fix (format + lint fix)
pnpm unsafe       # Biome check + format with unsafe auto-fixes
pnpm db:push      # Push DB schema changes (dev)
pnpm db:migrate   # Run DB migrations (prod)
pnpm db:generate  # Generate Drizzle migrations
pnpm db:pull      # Pull schema from existing DB
pnpm db:seed      # Seed database with sample data
pnpm db:studio    # Open Drizzle Studio GUI
pnpm db:check     # Check schema integrity
pnpm db:reset     # Destructive reset DB (force push)
pnpm db:drop      # Drop all tables
pnpm db:fresh     # Reset + seed (clean start)
pnpm db:setup     # Generate + migrate (combined)
```

## Dev Setup

```bash
docker compose up -d  # Start PostgreSQL, Redis, MinIO
cp .env.example .env  # Configure environment
pnpm install          # Install dependencies
pnpm db:push          # Create database tables
pnpm dev              # Start development
```

## Service URLs (Local Dev)

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

## Key Conventions

- Use Biome + Ultracite for formatting and linting (not Prettier/ESLint)
- Lefthook pre-commit hook auto-formats staged files; pre-push runs typecheck
- Use `...timestamps` spread from `@prometheus/db` schema helpers for createdAt/updatedAt columns
- Use tRPC for all API endpoints
- Validate inputs with Zod schemas from `@prometheus/validators`
- Use Drizzle ORM for database queries (never raw SQL)
- Use `@prometheus/logger` for structured logging
- Use `@prometheus/utils` generateId() for all IDs
- RLS via org_id on all tenant-scoped queries — see `drizzle-rls-patterns` skill
- tRPC + Hono patterns — see `trpc-hono-patterns` skill
- Full architecture map — see `prometheus-stack` skill
