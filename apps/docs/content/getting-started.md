---
title: Getting Started
description: Set up and start using Prometheus in minutes
order: 2
---

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker and Docker Compose
- A GitHub account (for repository integration)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/prometheus.git
cd prometheus
pnpm install
```

### 2. Start infrastructure services

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, and MinIO for local development.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

- `DATABASE_URL` - PostgreSQL connection string (default works with docker compose)
- `REDIS_URL` - Redis connection string (default works with docker compose)
- `CLERK_SECRET_KEY` - Get from Clerk dashboard
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Get from Clerk dashboard

### 4. Set up the database

```bash
pnpm db:push
```

### 5. Start all services

```bash
pnpm dev
```

This starts all 9 services using Turborepo:

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3000 |
| API | http://localhost:4000 |
| Socket Server | http://localhost:4001 |
| Orchestrator | http://localhost:4002 |
| Project Brain | http://localhost:4003 |
| Model Router | http://localhost:4004 |
| MCP Gateway | http://localhost:4005 |
| Sandbox Manager | http://localhost:4006 |

### 6. Create your first project

1. Open http://localhost:3000
2. Sign in or create an account
3. Create a new project by connecting a GitHub repository
4. Submit your first task

## Development Commands

```bash
pnpm dev          # Start all services
pnpm build        # Build all packages
pnpm typecheck    # TypeScript check
pnpm test         # Run all tests
pnpm db:push      # Push DB schema changes
pnpm db:migrate   # Run DB migrations
```

## Running a single service

```bash
pnpm dev --filter=@prometheus/web    # Just the web UI
pnpm dev --filter=@prometheus/api    # Just the API
```
