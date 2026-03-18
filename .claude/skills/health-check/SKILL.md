---
name: health-check
description: Check health of all Prometheus services, database, Redis, and BullMQ queues
user-invocable: true
disable-model-invocation: true
---

# Prometheus Health Check

Run the built-in health check script:

```bash
bash infra/scripts/healthcheck.sh
```

This checks all services and infrastructure automatically.

## Manual Checks

### Services
```bash
curl -s http://localhost:3000          # Web (Next.js)
curl -s http://localhost:4000/health   # API
curl -s http://localhost:4001          # Socket Server
curl -s http://localhost:4002/health   # Orchestrator
curl -s http://localhost:4003/health   # Project Brain
curl -s http://localhost:4004/health   # Model Router
curl -s http://localhost:4005/health   # MCP Gateway
curl -s http://localhost:4006/health   # Sandbox Manager
```

### Infrastructure
```bash
# PostgreSQL
pg_isready -h localhost -p 5432

# Redis
redis-cli ping

# MinIO
curl -s http://localhost:9000/minio/health/live

# Ollama
curl -s http://localhost:11434/api/tags
```

### BullMQ Queues
```bash
# Check queue depths via Redis
redis-cli LLEN bull:<queue-name>:wait
redis-cli LLEN bull:<queue-name>:active
redis-cli LLEN bull:<queue-name>:failed
```

### Production Health
```bash
curl -s https://api.prometheus.185.241.151.197.sslip.io/health
kubectl get pods -n prometheus
kubectl top pods -n prometheus
```

## Troubleshooting

- If a service is down, check logs: `pnpm --filter @prometheus/<service> dev` or `kubectl logs deployment/<service> -n prometheus`
- If DB is unreachable, verify Docker: `docker compose ps`
- If queues are backed up, check queue-worker logs and Redis memory: `redis-cli INFO memory`
