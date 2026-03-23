---
name: deploy
description: Deploy Prometheus services to production k3s cluster at 185.241.151.197
user-invocable: true
disable-model-invocation: true
---

# Deploy Prometheus

## Pre-flight Checks

1. Ensure all tests pass: `pnpm test`
2. Ensure build succeeds: `pnpm build`
3. Ensure no uncommitted changes: `git status`
4. Confirm target environment with user

## Deployment Steps

### 1. Build and Push Images
```bash
# Build all service images
docker compose -f infra/docker/docker-compose.prod.yml build

# Push to container registry
docker compose -f infra/docker/docker-compose.prod.yml push
```

### 2. Deploy to k3s
```bash
# Deploy to production
bash infra/scripts/deploy.sh production

# Or deploy to staging
bash infra/scripts/deploy.sh staging
```

The deploy script:
- Applies kustomize overlays from `infra/k8s/overlays/<environment>`
- Updates image tags on deployments (web, api, queue-worker, socket-server)
- Waits for rollout completion (300s timeout)

### 3. Verify Deployment
```bash
# Check all pods are running
kubectl get pods -n prometheus

# Run health checks against production
bash infra/scripts/healthcheck.sh
```

### 4. Production Health Endpoints
- Web: https://prometheus.185.241.151.197.sslip.io
- API: https://api.prometheus.185.241.151.197.sslip.io/health

### Rollback
If deployment fails:
```bash
bash infra/scripts/rollback.sh production
```

## Important Notes
- Always deploy to staging first and verify before production
- Database migrations (`pnpm db:migrate`) must be run separately before deploying if schema changed
- Check KEDA scaler status after deploy: `kubectl get scaledobjects -n prometheus`
