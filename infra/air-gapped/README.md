# Prometheus Air-Gapped Deployment

Fully offline deployment of the Prometheus AI platform with zero external dependencies. All LLM inference runs locally via Ollama. No API keys, cloud services, or internet access required.

## Prerequisites

- Docker Engine 24+ with Compose V2
- Minimum 32 GB RAM (Ollama models require significant memory)
- Minimum 100 GB disk space (models, databases, artifacts)
- GPU recommended (NVIDIA with CUDA support for faster inference)
- All Docker images pre-pulled or loaded from a local registry

## Architecture

| Component | Image | Purpose |
|-----------|-------|---------|
| PostgreSQL 16 + pgvector | `pgvector/pgvector:pg16` | Primary database with vector search |
| PgBouncer | `bitnami/pgbouncer` | Connection pooling |
| Dragonfly | `dragonflydb/dragonfly` | Redis-compatible cache/queue |
| MinIO | `minio/minio` | S3-compatible object storage |
| Ollama | `ollama/ollama` | Local LLM serving |
| LiteLLM | `ghcr.io/berriai/litellm` | LLM proxy (Ollama-only routing) |
| Zoekt | `ghcr.io/sourcegraph/zoekt-webserver` | Code search |
| Inngest | `inngest/inngest` | Job queue / workflow engine |
| Prometheus Services (9) | `prometheus/*` | Application services |

## Models

The following models are automatically pulled on first startup:

| Model | Size | Purpose |
|-------|------|---------|
| `qwen3-coder-next` | ~16 GB | Primary coding model |
| `qwen3.5:27b` | ~16 GB | General-purpose model |
| `deepseek-r1:32b` | ~19 GB | Reasoning model |
| `nomic-embed-text` | ~274 MB | Embeddings |

## Quick Start

1. **Prepare images** (on a machine with internet access):

   ```bash
   # Pull all required images
   docker pull pgvector/pgvector:pg16
   docker pull bitnami/pgbouncer:latest
   docker pull docker.dragonflydb.io/dragonflydb/dragonfly:latest
   docker pull minio/minio:latest
   docker pull ollama/ollama:latest
   docker pull ghcr.io/berriai/litellm:main-latest
   docker pull ghcr.io/sourcegraph/zoekt-webserver:latest
   docker pull inngest/inngest:latest

   # Save to a tarball for transfer
   docker save -o prometheus-airgap-images.tar \
     pgvector/pgvector:pg16 \
     bitnami/pgbouncer:latest \
     docker.dragonflydb.io/dragonflydb/dragonfly:latest \
     minio/minio:latest \
     ollama/ollama:latest \
     ghcr.io/berriai/litellm:main-latest \
     ghcr.io/sourcegraph/zoekt-webserver:latest \
     inngest/inngest:latest
   ```

2. **Transfer** the tarball and Prometheus application images to the air-gapped host.

3. **Load images** on the air-gapped host:

   ```bash
   docker load -i prometheus-airgap-images.tar
   docker load -i prometheus-app-images.tar
   ```

4. **Configure environment**:

   ```bash
   cd infra/air-gapped
   cp .env.airgap .env.airgap.local

   # Edit .env.airgap.local — change at minimum:
   #   ENCRYPTION_KEY (generate a random 64-char hex string)
   #   POSTGRES_PASSWORD
   #   LOCAL_ADMIN_PASSWORD
   ```

5. **Start the platform**:

   ```bash
   docker compose -f docker-compose.airgap.yml --env-file .env.airgap.local up -d
   ```

6. **Wait for model downloads** (first run only). The `ollama-init` container will pull models into the Ollama volume. Monitor progress:

   ```bash
   docker logs -f airgap-ollama-init
   ```

7. **Verify health**:

   ```bash
   # Check all services are running
   docker compose -f docker-compose.airgap.yml ps

   # Test LiteLLM proxy
   curl http://localhost:4000/health

   # Test Ollama models
   curl http://localhost:11434/api/tags
   ```

## Pre-pulling Models (Recommended)

For true air-gapped environments, pre-pull Ollama models on an internet-connected machine and transfer the volume:

```bash
# On internet-connected machine
docker run -d --name ollama-prep -v ollama-prep:/root/.ollama ollama/ollama
docker exec ollama-prep ollama pull qwen3-coder-next
docker exec ollama-prep ollama pull qwen3.5:27b
docker exec ollama-prep ollama pull deepseek-r1:32b
docker exec ollama-prep ollama pull nomic-embed-text
docker stop ollama-prep

# Export the volume
docker run --rm -v ollama-prep:/source -v $(pwd):/backup alpine \
  tar czf /backup/ollama-models.tar.gz -C /source .

# On air-gapped host, import into the volume
docker volume create airgap-ollama-data
docker run --rm -v airgap-ollama-data:/target -v $(pwd):/backup alpine \
  tar xzf /backup/ollama-models.tar.gz -C /target
```

## GPU Support

To enable GPU acceleration for Ollama, add the following to the `ollama` service in `docker-compose.airgap.yml`:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [gpu]
```

## Network Isolation

All services communicate over the `prometheus-airgap` network, which is configured with `internal: true` to prevent any outbound internet access. No ports are exposed to the host by default.

To access the web UI from the host, add port mappings to the `web` service:

```yaml
web:
  ports:
    - "3000:3000"
```

## Stopping the Platform

```bash
docker compose -f docker-compose.airgap.yml --env-file .env.airgap.local down
```

To remove all data volumes:

```bash
docker compose -f docker-compose.airgap.yml --env-file .env.airgap.local down -v
```
