---
name: prometheus-stack
description: Prometheus monorepo architecture — 9 services with ports, 15 packages, dependency graph, and development commands
user-invocable: false
---

# Prometheus Architecture Map

## Services (apps/)

| Service | Port | Env Var | Health Endpoint |
|---------|------|---------|-----------------|
| **web** (Next.js frontend) | 3000 | — | `http://localhost:3000` |
| **api** (tRPC + Hono) | 4000 | `PORT` | `http://localhost:4000/health` |
| **socket-server** (WebSocket) | 4001 | `SOCKET_PORT` | `http://localhost:4001` |
| **orchestrator** (Agent orchestration) | 4002 | `ORCHESTRATOR_PORT` | `http://localhost:4002/health` |
| **project-brain** (Context/memory) | 4003 | `PROJECT_BRAIN_PORT` | `http://localhost:4003/health` |
| **model-router** (LLM routing) | 4004 | `MODEL_ROUTER_PORT` | `http://localhost:4004/health` |
| **mcp-gateway** (MCP protocol) | 4005 | `MCP_GATEWAY_PORT` | `http://localhost:4005/health` |
| **sandbox-manager** (Code execution) | 4006 | `SANDBOX_MANAGER_PORT` | `http://localhost:4006/health` |
| **queue-worker** (BullMQ consumer) | — | — | — |

## Packages (packages/)

| Package | Purpose |
|---------|---------|
| `@prometheus/db` | Drizzle ORM schemas, migrations, database client |
| `@prometheus/auth` | Clerk auth helpers, `getAuthContext()` |
| `@prometheus/billing` | Stripe integration, subscription management |
| `@prometheus/ai` | Multi-provider LLM abstraction |
| `@prometheus/agent-sdk` | Agent definition and execution SDK |
| `@prometheus/queue` | BullMQ queue definitions and workers |
| `@prometheus/logger` | Structured logging via `createLogger()` |
| `@prometheus/types` | Shared TypeScript types |
| `@prometheus/validators` | Zod schemas for input validation |
| `@prometheus/utils` | Utilities including `generateId()` |
| `@prometheus/ui` | shadcn/ui component library |
| `@prometheus/config-typescript` | Shared tsconfig |
| `@prometheus/config-eslint` | Shared ESLint config |
| `@prometheus/config-tailwind` | Shared Tailwind config |
| `@prometheus/config-stacks` | Stack/template definitions |

## Infrastructure

- **PostgreSQL 16** + pgvector (port 5432)
- **Redis/Valkey** (port 6379) — BullMQ queues, pub/sub, caching
- **MinIO** (port 9000) — S3-compatible object storage
- **Ollama** (port 11434) — Local LLM inference

## Key Commands

```bash
pnpm dev                              # Start all services
pnpm build                            # Build everything
pnpm typecheck                        # TypeScript check all
pnpm test                             # Run all tests
pnpm test --filter=@prometheus/<pkg>  # Test specific package
pnpm db:push                          # Push schema changes
pnpm db:migrate                       # Run migrations
docker compose up -d                  # Start infra (PG, Redis, MinIO)
bash infra/scripts/healthcheck.sh     # Check all service health
bash infra/scripts/deploy.sh <env>    # Deploy to environment
```

## Production

- Server: 185.241.151.197
- Orchestration: k3s with KEDA autoscaling
- Ingress: Traefik
- CI/CD: GitHub Actions
- Container registry: ghcr.io
