# Staging Deployment Checklist (GAP-002)

Step-by-step checklist for deploying Prometheus to staging.

---

## Prerequisites

- [ ] Kubernetes cluster is accessible (`kubectl cluster-info`)
- [ ] `prometheus-staging` namespace exists (`kubectl get ns prometheus-staging`)
- [ ] Container registry credentials configured (`kubectl get secret regcred -n prometheus-staging`)
- [ ] Secrets created from template (`kubectl get secret app-secrets -n prometheus-staging`)
  - DATABASE_URL, REDIS_URL, CLERK_SECRET_KEY, STRIPE_SECRET_KEY, ENCRYPTION_KEY
- [ ] ConfigMap applied (`kubectl get configmap app-config -n prometheus-staging`)
- [ ] DNS records point to cluster ingress:
  - `app.staging.prometheus.dev` -> Ingress IP
  - `api.staging.prometheus.dev` -> Ingress IP
  - `ws.staging.prometheus.dev` -> Ingress IP
- [ ] TLS certificates provisioned (cert-manager or manual)
- [ ] PostgreSQL and Redis are healthy in the cluster

## Pre-Deploy Verification

```bash
# Run readiness checks
bash infra/scripts/readiness-check.sh

# Verify code quality
pnpm typecheck
pnpm unsafe
pnpm test
```

- [ ] All readiness checks pass (or only warnings)
- [ ] TypeScript compiles cleanly
- [ ] Lint and format pass
- [ ] Tests pass

## Build and Push Images

```bash
# Build all service images (from repo root)
IMAGE_TAG=$(git rev-parse --short HEAD)
for svc in web api queue-worker socket-server orchestrator project-brain model-router mcp-gateway sandbox-manager; do
  docker build -f infra/docker/Dockerfile.${svc} -t ghcr.io/prometheus/${svc}:${IMAGE_TAG} .
  docker push ghcr.io/prometheus/${svc}:${IMAGE_TAG}
done
```

- [ ] All 9 images built successfully
- [ ] All 9 images pushed to registry

## Deploy (Recommended Order)

Infrastructure services must be healthy before deploying application services.

### 1. Infrastructure (already running)

- [ ] PostgreSQL is healthy
- [ ] Redis is healthy
- [ ] PgBouncer is healthy

### 2. Core Services (no inter-service dependencies)

```bash
bash infra/scripts/deploy.sh staging ${IMAGE_TAG}
```

The deploy script applies the kustomize overlay and updates all services. The recommended internal deployment order is:

1. **api** - Core API, used by most other services
2. **queue-worker** - Background job processing
3. **socket-server** - WebSocket connections
4. **orchestrator** - Agent orchestration
5. **project-brain** - Project intelligence
6. **model-router** - LLM routing
7. **mcp-gateway** - MCP protocol gateway
8. **sandbox-manager** - Code sandbox management
9. **web** - Frontend (depends on API being available)

### 3. Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n prometheus-staging

# Check rollout status
kubectl rollout status deployment --all -n prometheus-staging --timeout=300s
```

- [ ] All deployments have desired replica count
- [ ] All pods are in Running state
- [ ] No pods in CrashLoopBackOff

## Post-Deploy Health Checks

```bash
# Run health verification against staging
bash infra/scripts/verify-health.sh --host app.staging.prometheus.dev

# Or via K8s mode
bash infra/scripts/verify-health.sh --k8s staging --retries 3

# Or use the existing healthcheck script
bash infra/scripts/healthcheck.sh --k8s staging
```

- [ ] All 9 services report GREEN
- [ ] Web UI loads at `https://app.staging.prometheus.dev`
- [ ] API responds at `https://api.staging.prometheus.dev/health`
- [ ] WebSocket connects at `wss://ws.staging.prometheus.dev`

## Smoke Tests

- [ ] User can sign in via Clerk
- [ ] Project creation works
- [ ] Agent orchestration responds to a prompt
- [ ] File operations work in sandbox

## Rollback Procedure

If any service fails after deployment:

### Roll Back a Single Service

```bash
bash infra/scripts/rollback.sh <service> prometheus-staging
# Example:
bash infra/scripts/rollback.sh api prometheus-staging
```

### Roll Back All Services

```bash
bash infra/scripts/rollback.sh all prometheus-staging
```

### Roll Back to a Specific Revision

```bash
# Check revision history
kubectl rollout history deployment/api -n prometheus-staging

# Roll back to specific revision
bash infra/scripts/rollback.sh api prometheus-staging 3
```

### Emergency: Scale Down

```bash
# Scale a crashing service to 0
kubectl scale deployment/<service> --replicas=0 -n prometheus-staging
```

### Post-Rollback

- [ ] Re-run health checks: `bash infra/scripts/verify-health.sh --k8s staging`
- [ ] Investigate root cause in pod logs: `kubectl logs -n prometheus-staging deploy/<service>`
- [ ] Check events: `kubectl get events -n prometheus-staging --sort-by='.lastTimestamp'`

---

## K8s Manifest Coverage

All 9 application services have deployment manifests in `infra/k8s/base/`:

| Service | deployment.yaml | service.yaml | hpa.yaml | pdb.yaml |
|---------|:-:|:-:|:-:|:-:|
| web | Y | Y | Y | - |
| api | Y | Y | Y | Y |
| queue-worker | Y | - | KEDA | Y |
| socket-server | Y | Y | Y | Y |
| orchestrator | Y | (in deployment) | Y | Y |
| project-brain | Y | - | Y | - |
| model-router | Y | - | Y | Y |
| mcp-gateway | Y | - | Y | - |
| sandbox-manager | Y | - | - | - |

Note: Some services include their Service definition within the deployment.yaml file (e.g., orchestrator). Queue-worker uses KEDA for autoscaling instead of HPA.

## docker-compose.yml Note

The root `docker-compose.yml` contains **infrastructure services only** (PostgreSQL, PgBouncer, Redis, LiteLLM, MinIO, Ollama, Qdrant, Zoekt). Application services (web, api, etc.) run via `pnpm dev` in local development. This is by design -- the compose file provides the backing services while app code runs natively for faster iteration.
