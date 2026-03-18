.PHONY: help dev build test lint typecheck clean setup deploy deploy-staging rollback health docker-up docker-down db-push db-migrate db-seed db-studio

# Default target
help: ## Show this help
	@echo "Prometheus - AI Engineering Platform"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Development ──────────────────────────────────────────────

setup: ## Initial development environment setup
	bash infra/scripts/setup-dev.sh

dev: ## Start all services in development mode
	pnpm dev

dev-web: ## Start only the web frontend
	pnpm dev --filter=@prometheus/web

dev-api: ## Start only the API server
	pnpm dev --filter=@prometheus/api

# ─── Build & Quality ─────────────────────────────────────────

build: ## Build all packages and apps
	pnpm turbo build

typecheck: ## Run TypeScript type checking
	pnpm turbo typecheck

lint: ## Run linting across all packages
	pnpm turbo lint

lint-fix: ## Run linting with auto-fix
	pnpm turbo lint -- --fix

test: ## Run all tests
	pnpm turbo test

test-watch: ## Run tests in watch mode
	pnpm turbo test -- --watch

test-api: ## Run API tests only
	pnpm test --filter=@prometheus/api

test-web: ## Run web tests only
	pnpm test --filter=@prometheus/web

ci: lint typecheck test build ## Run full CI pipeline locally

# ─── Database ─────────────────────────────────────────────────

db-push: ## Push database schema changes (dev)
	pnpm db:push

db-migrate: ## Run database migrations (production)
	pnpm db:migrate

db-seed: ## Seed the database with sample data
	pnpm db:seed

db-studio: ## Open Drizzle Studio
	pnpm db:studio

# ─── Infrastructure ──────────────────────────────────────────

docker-up: ## Start infrastructure services (PostgreSQL, Redis, MinIO)
	docker compose up -d postgres redis minio

docker-down: ## Stop infrastructure services
	docker compose down

docker-clean: ## Stop and remove all containers, volumes
	docker compose down -v

# ─── Deployment ──────────────────────────────────────────────

deploy: ## Deploy to production (usage: make deploy TAG=abc123)
	bash infra/scripts/deploy.sh production $(TAG)

deploy-staging: ## Deploy to staging (usage: make deploy-staging TAG=abc123)
	bash infra/scripts/deploy.sh staging $(TAG)

rollback: ## Rollback a service (usage: make rollback SERVICE=api)
	bash infra/scripts/rollback.sh $(SERVICE)

rollback-all: ## Rollback all services
	bash infra/scripts/rollback.sh all

health: ## Run health check for local services
	bash infra/scripts/healthcheck.sh

health-k8s: ## Run health check for k8s cluster (usage: make health-k8s ENV=production)
	bash infra/scripts/healthcheck.sh --k8s $(ENV)

# ─── Docker Build ────────────────────────────────────────────

REGISTRY ?= ghcr.io/prometheus
TAG ?= latest

docker-build: ## Build all Docker images locally
	@for service in web api queue-worker socket-server orchestrator project-brain model-router mcp-gateway sandbox-manager; do \
		echo "Building $$service..."; \
		docker build -f infra/docker/Dockerfile.$$service \
			--build-arg SERVICE=$$service \
			-t $(REGISTRY)/$$service:$(TAG) . ; \
	done

docker-push: ## Push all Docker images to registry
	@for service in web api queue-worker socket-server orchestrator project-brain model-router mcp-gateway sandbox-manager; do \
		echo "Pushing $$service..."; \
		docker push $(REGISTRY)/$$service:$(TAG); \
	done

# ─── Utilities ───────────────────────────────────────────────

clean: ## Clean build artifacts and node_modules caches
	pnpm turbo clean
	rm -rf .turbo
	find . -name "dist" -type d -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true

install: ## Install dependencies
	pnpm install

update: ## Update all dependencies
	pnpm update --recursive

k8s-validate: ## Validate Kubernetes manifests
	@command -v kubeconform >/dev/null 2>&1 || { echo "Install kubeconform: https://github.com/yannh/kubeconform"; exit 1; }
	kubeconform -strict -ignore-missing-schemas infra/k8s/base/**/*.yaml
