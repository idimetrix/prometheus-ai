# PROMETHEUS

AI-powered engineering platform with 12 specialist agents.

## Project Structure

- Turborepo monorepo with pnpm workspaces
- `apps/` - 9 services (web, api, orchestrator, queue-worker, socket-server, mcp-gateway, model-router, project-brain, sandbox-manager)
- `packages/` - 15 shared packages
- `infra/` - Docker, k8s manifests, deployment scripts

## Commands

```bash
pnpm dev          # Start all services in dev mode
pnpm build        # Build all packages
pnpm typecheck    # TypeScript check all packages
pnpm test         # Run all tests
pnpm db:push      # Push DB schema changes
pnpm db:migrate   # Run DB migrations
```

## Dev Setup

```bash
docker compose up -d  # Start PostgreSQL, Redis, MinIO
cp .env.example .env  # Configure environment
pnpm install          # Install dependencies
pnpm db:push          # Create database tables
pnpm dev              # Start development
```

## Tech Stack

- **Frontend:** Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, Zustand, tRPC client
- **Backend:** tRPC v11, Hono, Drizzle ORM, PostgreSQL 16 + pgvector, Redis/Valkey, BullMQ
- **Auth:** Clerk
- **Billing:** Stripe
- **AI:** Multi-provider LLM routing (Ollama, Cerebras, Groq, Gemini, Anthropic, OpenAI)
- **Infra:** Docker, k3s, KEDA, Traefik, GitHub Actions

## Key Conventions

- Use tRPC for all API endpoints
- Validate inputs with Zod schemas from `@prometheus/validators`
- Use Drizzle ORM for database queries (never raw SQL)
- Use `@prometheus/logger` for structured logging
- Use `@prometheus/utils` generateId() for all IDs
- RLS via org_id on all tenant-scoped queries
