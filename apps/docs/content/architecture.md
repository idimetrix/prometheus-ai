---
title: Architecture
description: Technical architecture of the Prometheus platform
order: 3
---

## System Overview

Prometheus is a monorepo built with Turborepo and pnpm workspaces. It consists of 9 services and 15+ shared packages.

## Services

### Web (`apps/web`)

Next.js 15 frontend with React 19. Handles the user interface including the dashboard, session views, project management, and real-time updates via SSE.

**Tech:** Next.js, React 19, Tailwind CSS, tRPC, Zustand, Clerk Auth

### API (`apps/api`)

Central API server built with Hono + tRPC. Handles all CRUD operations, authentication, and serves as the gateway for client requests.

**Tech:** Hono, tRPC, Drizzle ORM, Clerk

### Orchestrator (`apps/orchestrator`)

The brain of the agent system. Receives tasks from the API, creates execution plans, and coordinates the 12 specialist agents. Manages agent lifecycle and inter-agent communication.

### Queue Worker (`apps/queue-worker`)

Processes background jobs from the Redis-backed queue. Handles long-running tasks like code generation, test execution, and deployment workflows.

**Tech:** BullMQ, Redis

### Socket Server (`apps/socket-server`)

Handles real-time communication. Pushes session events, terminal output, and status updates to connected clients via Server-Sent Events (SSE).

### Project Brain (`apps/project-brain`)

Maintains project context and knowledge. Indexes codebases, stores architecture decisions, and provides context to other agents during execution.

### Model Router (`apps/model-router`)

Intelligent model selection and routing. Chooses the optimal AI model for each task based on complexity, cost, and latency requirements. Supports multiple providers.

### MCP Gateway (`apps/mcp-gateway`)

Model Context Protocol gateway. Enables agents to use external tools and integrations through a standardized protocol.

### Sandbox Manager (`apps/sandbox-manager`)

Manages isolated execution environments for running agent-generated code safely. Handles container lifecycle, resource limits, and security boundaries.

## Shared Packages

- `@prometheus/db` - Drizzle ORM schema and database utilities
- `@prometheus/types` - Shared TypeScript types
- `@prometheus/validators` - Zod validation schemas
- `@prometheus/auth` - Authentication utilities (Clerk)
- `@prometheus/ui` - Shared UI components
- `@prometheus/logger` - Structured logging
- `@prometheus/queue` - Queue job definitions
- `@prometheus/utils` - Common utilities
- `@prometheus/config-*` - Shared configurations
- `@prometheus/ai` - AI provider abstractions
- `@prometheus/agent-sdk` - Agent development SDK
- `@prometheus/billing` - Credit system and billing
- `@prometheus/feature-flags` - Feature flag system

## Data Flow

```
User submits task (Web)
       |
       v
   API (tRPC)
       |
       v
  Queue (BullMQ/Redis)
       |
       v
  Orchestrator
       |
    +---------+
    |         |
    v         v
  Agents    Agents
    |         |
    v         v
  Sandbox   Model Router
    |         |
    v         v
  Results -> Socket Server -> Web (SSE)
```

## Database

PostgreSQL with pgvector for embeddings. Uses Drizzle ORM with row-level security (RLS) via `org_id` on all tenant-scoped tables.

## Infrastructure

- **Containers:** Docker with multi-stage builds
- **Orchestration:** Kubernetes
- **Cache/Queue:** Redis (Valkey)
- **Object Storage:** MinIO (S3-compatible)
- **Auth:** Clerk
- **CI/CD:** GitHub Actions
