---
title: Docker Compose Deployment
description: Self-hosting Prometheus with Docker Compose
order: 10
---

## Prerequisites

- Docker 24+ and Docker Compose v2
- Node.js 22+ (for building images)
- At least 8 GB RAM available for containers
- A domain name (optional, for production use)

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/your-org/prometheus.git
cd prometheus
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration. Required variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/prometheus` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `CLERK_SECRET_KEY` | Clerk authentication secret | (required) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | (required) |
| `STRIPE_SECRET_KEY` | Stripe API key for billing | (optional) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | (optional) |
| `MINIO_ACCESS_KEY` | MinIO access key | `minioadmin` |
| `MINIO_SECRET_KEY` | MinIO secret key | `minioadmin` |
| `OPENAI_API_KEY` | OpenAI API key for model router | (required for AI features) |
| `ANTHROPIC_API_KEY` | Anthropic API key for model router | (required for AI features) |

### 3. Start all services

```bash
docker compose up -d
```

This starts all services including infrastructure (PostgreSQL, Redis, MinIO) and application services.

### 4. Run database migrations

```bash
docker compose exec api pnpm db:push
```

### 5. Verify health

Check that all services are running:

```bash
docker compose ps
```

Verify service health endpoints:

```bash
curl http://localhost:4000/health   # API
curl http://localhost:3000           # Web UI
curl http://localhost:4002/health   # Orchestrator
```

## Service Configuration

### Resource Limits

You can configure resource limits in `docker-compose.yml`:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "1.0"
```

### Persistent Storage

Data is persisted in Docker volumes:

- `prometheus-postgres` — PostgreSQL data
- `prometheus-redis` — Redis data
- `prometheus-minio` — MinIO object storage

### Networking

All services communicate on an internal Docker network. Only the following ports are exposed:

| Port | Service |
|------|---------|
| 3000 | Web UI |
| 4000 | API |
| 4001 | Socket Server (SSE) |

## Updating

To update to a new version:

```bash
git pull origin main
docker compose build
docker compose up -d
docker compose exec api pnpm db:migrate
```

## Troubleshooting

### Services fail to start

Check logs for the failing service:

```bash
docker compose logs api --tail 50
docker compose logs orchestrator --tail 50
```

### Database connection errors

Ensure PostgreSQL is healthy and the `DATABASE_URL` is correct:

```bash
docker compose exec postgres pg_isready
```

### Redis connection errors

Verify Redis is running:

```bash
docker compose exec redis redis-cli ping
```

### Out of memory

Increase Docker memory allocation or reduce service resource limits. Monitor usage with:

```bash
docker stats
```

### Port conflicts

If ports are already in use, update the port mappings in `docker-compose.yml` or stop conflicting services.
