---
title: Kubernetes Deployment
description: Production deployment guide for Kubernetes
order: 11
---

## Prerequisites

- Kubernetes cluster (1.28+)
- kubectl configured for your cluster
- Helm 3.x installed
- Container registry access (for pushing images)
- PostgreSQL database (managed service recommended)
- Redis instance (managed service recommended)

## Architecture

In a production Kubernetes deployment, Prometheus runs as a set of microservices:

```
Ingress -> Web (Next.js)
        -> API (Hono/tRPC)
        -> Socket Server (SSE)

Internal:
  API -> Orchestrator -> Queue Worker
                      -> Project Brain
                      -> Model Router
                      -> MCP Gateway
                      -> Sandbox Manager
```

## Deployment Order

Deploy services in this order to respect dependencies:

1. **Infrastructure** — PostgreSQL, Redis, MinIO (or use managed services)
2. **Shared services** — Model Router, Project Brain, MCP Gateway
3. **Core services** — API, Queue Worker, Orchestrator
4. **Frontend** — Web, Socket Server
5. **Ingress** — Configure routing rules

## Namespace Setup

```bash
kubectl create namespace prometheus
kubectl config set-context --current --namespace=prometheus
```

## Secrets

Create secrets for sensitive configuration:

```bash
kubectl create secret generic prometheus-secrets \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/prometheus" \
  --from-literal=REDIS_URL="redis://host:6379" \
  --from-literal=CLERK_SECRET_KEY="sk_live_..." \
  --from-literal=STRIPE_SECRET_KEY="sk_live_..." \
  --from-literal=OPENAI_API_KEY="sk-..." \
  --from-literal=ANTHROPIC_API_KEY="sk-ant-..."
```

## Deploying Services

Apply the Kubernetes manifests from the `infra/k8s/` directory:

```bash
kubectl apply -f infra/k8s/
```

Or deploy individual services:

```bash
kubectl apply -f infra/k8s/api.yaml
kubectl apply -f infra/k8s/web.yaml
kubectl apply -f infra/k8s/orchestrator.yaml
kubectl apply -f infra/k8s/queue-worker.yaml
kubectl apply -f infra/k8s/socket-server.yaml
kubectl apply -f infra/k8s/project-brain.yaml
kubectl apply -f infra/k8s/model-router.yaml
kubectl apply -f infra/k8s/mcp-gateway.yaml
kubectl apply -f infra/k8s/sandbox-manager.yaml
```

## Scaling Configuration

### Horizontal Pod Autoscaler

Configure autoscaling for compute-intensive services:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### Recommended Replica Counts

| Service | Min Replicas | Max Replicas | CPU Request | Memory Request |
|---------|-------------|-------------|-------------|----------------|
| Web | 2 | 6 | 250m | 512Mi |
| API | 2 | 10 | 500m | 1Gi |
| Orchestrator | 2 | 8 | 500m | 1Gi |
| Queue Worker | 2 | 12 | 500m | 1Gi |
| Socket Server | 2 | 6 | 250m | 512Mi |
| Project Brain | 1 | 4 | 500m | 2Gi |
| Model Router | 2 | 6 | 250m | 512Mi |
| MCP Gateway | 1 | 4 | 250m | 512Mi |
| Sandbox Manager | 1 | 4 | 1000m | 2Gi |

### Sandbox Manager Considerations

The Sandbox Manager creates isolated containers for code execution. Ensure:

- The service account has permissions to create and manage pods
- Resource quotas allow for sandbox pod creation
- Node affinity rules isolate sandbox workloads from other services

## Monitoring

### Health Checks

All services expose `/health` endpoints. Configure liveness and readiness probes:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 4000
  initialDelaySeconds: 10
  periodSeconds: 30
readinessProbe:
  httpGet:
    path: /health
    port: 4000
  initialDelaySeconds: 5
  periodSeconds: 10
```

### Metrics

Services expose Prometheus-compatible metrics on `/metrics`. Configure a Prometheus scrape target or use your cluster's monitoring stack (e.g., kube-prometheus-stack).

### Logging

Services use structured JSON logging via `@prometheus/logger`. Collect logs with Fluentd, Fluent Bit, or your preferred log aggregator. Key log fields:

- `service` — Service name
- `level` — Log level (info, warn, error)
- `traceId` — Request trace ID for correlation
- `orgId` — Tenant identifier

## Ingress

Configure ingress for external access:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: prometheus-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 3000
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 4000
          - path: /events
            pathType: Prefix
            backend:
              service:
                name: socket-server
                port:
                  number: 4001
```
