---
title: Troubleshooting
description: Common issues, diagnostics, and solutions
order: 20
---

## Common Issues

### Services fail to start

**Symptoms:** `pnpm dev` exits with errors or services crash on startup.

**Solutions:**

1. Ensure infrastructure is running:
   ```bash
   docker compose up -d
   docker compose ps  # All should be healthy
   ```

2. Check that `.env` exists and has required variables:
   ```bash
   cp .env.example .env  # If missing
   ```

3. Verify Node.js version (22+ required):
   ```bash
   node --version
   ```

4. Clean and reinstall dependencies:
   ```bash
   rm -rf node_modules
   pnpm install
   ```

### Database connection refused

**Symptoms:** `ECONNREFUSED` errors when starting the API or running migrations.

**Solutions:**

1. Verify PostgreSQL is running:
   ```bash
   docker compose exec postgres pg_isready
   ```

2. Check `DATABASE_URL` in `.env` matches the Docker Compose config.

3. If you changed the database password, recreate the volume:
   ```bash
   docker compose down -v
   docker compose up -d
   pnpm db:push
   ```

### Redis connection errors

**Symptoms:** Queue worker or socket server fails to connect.

**Solutions:**

1. Verify Redis is running:
   ```bash
   docker compose exec redis redis-cli ping
   # Should respond: PONG
   ```

2. Check `REDIS_URL` in `.env`.

### Authentication failures

**Symptoms:** 401 errors or redirect loops on the web UI.

**Solutions:**

1. Verify Clerk keys in `.env`:
   - `CLERK_SECRET_KEY` — Starts with `sk_test_` or `sk_live_`
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Starts with `pk_test_` or `pk_live_`

2. Ensure both keys are from the same Clerk application.

3. For local development, use test keys from the Clerk dashboard.

### TypeScript errors after pulling changes

**Symptoms:** `pnpm typecheck` fails after `git pull`.

**Solutions:**

1. Regenerate database types:
   ```bash
   pnpm db:generate
   ```

2. Clean build caches and rebuild:
   ```bash
   pnpm clean
   pnpm build
   pnpm typecheck
   ```

### Sessions stuck in "running" state

**Symptoms:** A session shows as running but no progress is being made.

**Solutions:**

1. Check the queue worker is running:
   ```bash
   curl http://localhost:4000/health
   ```

2. Check Redis for stalled jobs:
   ```bash
   docker compose exec redis redis-cli LLEN bull:sessions:wait
   ```

3. Cancel and retry the session from the dashboard.

### Out of credits

**Symptoms:** Operations fail with `INSUFFICIENT_CREDITS` error.

**Solutions:**

1. Check usage on the dashboard under **Settings > Billing**.
2. Upgrade your plan or wait for the billing period to reset.
3. Use `plan` mode instead of `task` mode to preview without spending credits.

## Service Health Checks

Each service exposes a health endpoint:

| Service | Health URL |
|---------|-----------|
| API | `http://localhost:4000/health` |
| Orchestrator | `http://localhost:4002/health` |
| Project Brain | `http://localhost:4003/health` |
| Model Router | `http://localhost:4004/health` |
| MCP Gateway | `http://localhost:4005/health` |
| Sandbox Manager | `http://localhost:4006/health` |

Check all services at once:

```bash
for port in 4000 4002 4003 4004 4005 4006; do
  echo "Port $port: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$port/health)"
done
```

## Log Locations

### Development

Logs are printed to stdout by each service. Use the Turborepo output:

```bash
pnpm dev  # All logs interleaved
pnpm dev --filter=@prometheus/api  # Single service logs
```

### Docker Compose

```bash
docker compose logs api --tail 100 -f
docker compose logs --tail 50  # All services
```

### Kubernetes

```bash
kubectl logs -f deployment/api -n prometheus
kubectl logs -f deployment/orchestrator -n prometheus --tail 100
```

## Getting Help

1. **Documentation** — Check the docs at `/docs` for guides and references.
2. **GitHub Issues** — Search existing issues or create a new one at the project repository.
3. **Community** — Join the community Discord for discussions and support.
4. **Email Support** — Starter plan and above: support@prometheus.dev
5. **Priority Support** — Pro plan and above: priority response times.
