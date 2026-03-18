# Prometheus

AI-powered engineering platform with 12 specialist agents that autonomously handle software development tasks — from requirements discovery through deployment.

## What It Does

Prometheus orchestrates a fleet of AI agents that can:

- **Discover** requirements via structured 5-question framework
- **Architect** systems with blueprints, schemas, and API contracts
- **Plan** sprints with task decomposition and dependency mapping
- **Code** frontend (React/Next.js) and backend (tRPC/Drizzle) features
- **Test** with unit, integration, and E2E coverage
- **Fix** CI failures via automated test-fail-analyze-fix loops
- **Audit** code for OWASP vulnerabilities
- **Deploy** with Docker, Kubernetes, and CI/CD pipelines

Users submit tasks via a web UI, and agents execute them in isolated sandboxes with real-time streaming of progress.

## Architecture

```
Browser → Traefik → [ web | api | socket-server ]
                          ↓
              [ queue-worker → orchestrator ]
                    ↓              ↓
            [ model-router ]  [ sandbox-manager ]
                    ↓              ↓
            [ 7 LLM providers ]  [ Docker containers ]
                          ↓
              [ project-brain (5-layer memory) ]
                          ↓
              [ PostgreSQL + pgvector | Redis | MinIO ]
```

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed diagrams, schemas, and scaling analysis.

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, Zustand |
| **API** | tRPC v11, Hono, Zod validation |
| **Database** | PostgreSQL 16 + pgvector, Drizzle ORM |
| **Queue** | BullMQ, Redis/Valkey 8 |
| **Real-Time** | Socket.io, Server-Sent Events |
| **Auth** | Clerk |
| **Billing** | Stripe (6 plan tiers, credit-based) |
| **AI** | Multi-provider routing (Ollama, Cerebras, Groq, Gemini, Anthropic, OpenAI, DeepSeek) |
| **Infra** | Docker, k3s, KEDA, Traefik, GitHub Actions |

> See [TECHNOLOGIES.md](./TECHNOLOGIES.md) for the full technology breakdown.

## Project Structure

```
prometheus/
├── apps/
│   ├── web/                  # Next.js frontend (:3000)
│   ├── api/                  # tRPC + Hono backend (:4000)
│   ├── socket-server/        # Socket.io real-time (:4001)
│   ├── orchestrator/         # Agent lifecycle management
│   ├── queue-worker/         # BullMQ job consumer
│   ├── model-router/         # Multi-provider LLM routing (:4002)
│   ├── sandbox-manager/      # Docker container isolation (:4003)
│   ├── mcp-gateway/          # External integrations (:4004)
│   └── project-brain/        # 5-layer memory system (:4005)
├── packages/
│   ├── db/                   # Drizzle ORM schemas (30+ tables)
│   ├── ai/                   # LLM client + model registry (15 models)
│   ├── agent-sdk/            # Agent roles + tool definitions
│   ├── billing/              # Plan tiers + credit system
│   ├── queue/                # BullMQ queue definitions
│   ├── validators/           # Zod schemas
│   ├── logger/               # Structured logging
│   └── utils/                # Shared utilities
└── infra/
    ├── docker/               # Multi-stage Dockerfiles
    └── k8s/base/             # HPA, KEDA, Traefik, monitoring
```

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker

### Setup

```bash
# Start infrastructure (PostgreSQL, Redis, MinIO)
docker compose up -d

# Configure environment
cp .env.example .env
# Edit .env with your API keys (Clerk, Stripe, LLM providers)

# Install dependencies
pnpm install

# Create database tables
pnpm db:push

# Start all services
pnpm dev
```

### Commands

```bash
pnpm dev          # Start all 9 services in dev mode
pnpm build        # Build all packages
pnpm typecheck    # TypeScript check across monorepo
pnpm test         # Run all tests
pnpm db:push      # Push DB schema changes
pnpm db:migrate   # Run DB migrations
```

## 12 Agent Roles

| Agent | Model | Purpose |
|-------|-------|---------|
| Orchestrator | qwen3.5:27b | Coordinates agents, resolves conflicts |
| Discovery | gemini-2.5-flash | Requirements elicitation |
| Architect | deepseek-r1:32b | System design, blueprints |
| Planner | qwen3.5:27b | Sprint planning, task breakdown |
| Frontend Coder | qwen3-coder-next | React/Next.js implementation |
| Backend Coder | qwen3-coder-next | API/service implementation |
| Integration Coder | qwen3-235b | Frontend ↔ backend wiring |
| Test Engineer | llama-3.3-70b | Unit, integration, E2E tests |
| CI Loop | qwen3-235b | Automated fix cycles |
| Security Auditor | deepseek-r1:32b | OWASP vulnerability scanning |
| Deploy Engineer | qwen3-coder-next | Docker, k8s, CI/CD |

## Model Routing

Intelligent routing across 15 models from 7 providers with automatic fallback chains:

- **Tier 0** — Local Ollama models (free, unlimited)
- **Tier 1** — Free APIs: Cerebras (30 RPM), Groq (30 RPM), Gemini (15 RPM)
- **Tier 2** — Low-cost: DeepSeek ($0.14/$0.28 per 1M tokens)
- **Tier 3** — Mid-tier: Claude Sonnet ($3/$15 per 1M tokens)
- **Tier 4** — Premium: Claude Opus ($15/$75 per 1M tokens)

80%+ of requests served by free Tier 0/1 models.

## Scaling

Designed for 1000+ monthly active users:

- **API**: 2→6 pods via HPA (CPU 60%, Memory 75%)
- **Queue Workers**: 2→16 pods via KEDA (Redis queue depth trigger)
- **Web**: 2→8 pods via HPA (CPU 70%)
- **Database**: PostgreSQL StatefulSet with 20Gi PVC
- **Est. cost**: $150-375/mo at 1000 MAU

## License

Proprietary. All rights reserved.
