import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:iac-generator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  buildCommand: string;
  entrypoint: string;
  language: "node" | "python" | "go" | "rust";
  nodeVersion?: string;
  port: number;
  projectName: string;
}

export interface ServiceDefinition {
  cpu: string;
  envVars: Record<string, string>;
  image?: string;
  memory: string;
  name: string;
  port: number;
  replicas: number;
}

export interface InfrastructureSpec {
  database: { engine: "postgres" | "mysql"; instanceSize: string };
  domain: string;
  provider: "aws" | "gcp" | "azure";
  redis: boolean;
  region: string;
  storage: boolean;
}

// ---------------------------------------------------------------------------
// IaCGenerator
// ---------------------------------------------------------------------------

/**
 * Generates infrastructure-as-code files (Dockerfile, Kubernetes, Terraform,
 * Docker Compose) following best practices for each platform.
 */
export class IaCGenerator {
  /**
   * Generate a multi-stage Dockerfile for the project.
   */
  generateDockerfile(projectInfo: ProjectInfo): string {
    logger.info({ language: projectInfo.language }, "Generating Dockerfile");

    switch (projectInfo.language) {
      case "node":
        return this.generateNodeDockerfile(projectInfo);
      case "python":
        return this.generatePythonDockerfile(projectInfo);
      case "go":
        return this.generateGoDockerfile(projectInfo);
      case "rust":
        return this.generateRustDockerfile(projectInfo);
      default:
        return `# Unsupported language: ${projectInfo.language}\nFROM alpine:latest\n`;
    }
  }

  /**
   * Generate Kubernetes manifests for a set of services.
   */
  generateKubernetesManifests(services: ServiceDefinition[]): string {
    logger.info(
      { serviceCount: services.length },
      "Generating Kubernetes manifests"
    );

    const manifests = services.flatMap((service) => [
      this.generateK8sDeployment(service),
      this.generateK8sService(service),
    ]);

    return manifests.join("\n---\n");
  }

  /**
   * Generate Terraform HCL for cloud infrastructure.
   */
  generateTerraform(infrastructure: InfrastructureSpec): string {
    logger.info(
      { provider: infrastructure.provider },
      "Generating Terraform config"
    );

    let sourceName = "azurerm";
    if (infrastructure.provider === "aws") {
      sourceName = "aws";
    } else if (infrastructure.provider === "gcp") {
      sourceName = "google";
    }

    let providerName = "aws";
    if (infrastructure.provider === "gcp") {
      providerName = "google";
    } else if (infrastructure.provider === "azure") {
      providerName = "azurerm";
    }

    const lines: string[] = [
      "terraform {",
      `  required_version = ">= 1.5.0"`,
      "  required_providers {",
      `    ${infrastructure.provider} = {`,
      `      source  = "hashicorp/${sourceName}"`,
      `      version = "~> 5.0"`,
      "    }",
      "  }",
      "}",
      "",
      `provider "${providerName}" {`,
      `  region = "${infrastructure.region}"`,
      "}",
      "",
    ];

    // Database resource
    lines.push("# Database");
    lines.push(
      `resource "${this.dbResourceType(infrastructure.provider)}" "main" {`
    );
    lines.push(
      `  engine         = "${infrastructure.database.engine === "postgres" ? "postgres" : "mysql"}"`
    );
    lines.push(`  instance_class = "${infrastructure.database.instanceSize}"`);
    lines.push("  allocated_storage = 20");
    lines.push("  tags = {");
    lines.push(`    Name = "${infrastructure.domain}-db"`);
    lines.push("  }");
    lines.push("}");
    lines.push("");

    // Redis
    if (infrastructure.redis) {
      lines.push("# Redis");
      lines.push(
        `resource "${this.redisResourceType(infrastructure.provider)}" "cache" {`
      );
      lines.push(`  node_type = "cache.t3.micro"`);
      lines.push("  num_cache_nodes = 1");
      lines.push("}");
      lines.push("");
    }

    // Storage
    if (infrastructure.storage) {
      lines.push("# Object Storage");
      lines.push(
        `resource "${this.storageResourceType(infrastructure.provider)}" "assets" {`
      );
      lines.push(`  bucket = "${infrastructure.domain}-assets"`);
      lines.push("}");
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Generate a docker-compose.yml for local development.
   */
  generateDockerCompose(services: ServiceDefinition[]): string {
    logger.info(
      { serviceCount: services.length },
      "Generating Docker Compose config"
    );

    const lines: string[] = ["services:"];

    for (const service of services) {
      lines.push(`  ${service.name}:`);
      if (service.image) {
        lines.push(`    image: ${service.image}`);
      } else {
        lines.push(`    build: ./${service.name}`);
      }
      lines.push("    ports:");
      lines.push(`      - "${service.port}:${service.port}"`);

      const envEntries = Object.entries(service.envVars);
      if (envEntries.length > 0) {
        lines.push("    environment:");
        for (const [key, value] of envEntries) {
          lines.push(`      ${key}: "${value}"`);
        }
      }

      lines.push("    deploy:");
      lines.push("      resources:");
      lines.push("        limits:");
      lines.push(`          cpus: "${service.cpu}"`);
      lines.push(`          memory: ${service.memory}`);
      lines.push("    restart: unless-stopped");
      lines.push("");
    }

    return lines.join("\n");
  }

  // ---- Private helpers ----

  private generateNodeDockerfile(info: ProjectInfo): string {
    const nodeVersion = info.nodeVersion ?? "22";
    return `# Stage 1: Install dependencies
FROM node:${nodeVersion}-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:${nodeVersion}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ${info.buildCommand}

# Stage 3: Production
FROM node:${nodeVersion}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 app && adduser --system --uid 1001 app
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./
USER app
EXPOSE ${info.port}
CMD ["node", "${info.entrypoint}"]
`;
  }

  private generatePythonDockerfile(info: ProjectInfo): string {
    return `# Stage 1: Build
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Production
FROM python:3.12-slim AS runner
WORKDIR /app
COPY --from=builder /install /usr/local
COPY . .
RUN useradd --system app
USER app
EXPOSE ${info.port}
CMD ["python", "${info.entrypoint}"]
`;
  }

  private generateGoDockerfile(info: ProjectInfo): string {
    return `# Stage 1: Build
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ${info.entrypoint}

# Stage 2: Production
FROM alpine:3.19 AS runner
RUN apk --no-cache add ca-certificates && adduser -D app
COPY --from=builder /app/server /usr/local/bin/server
USER app
EXPOSE ${info.port}
CMD ["server"]
`;
  }

  private generateRustDockerfile(info: ProjectInfo): string {
    return `# Stage 1: Build
FROM rust:1.77-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY . .
RUN cargo build --release

# Stage 2: Production
FROM debian:bookworm-slim AS runner
RUN useradd --system app
COPY --from=builder /app/target/release/${info.projectName} /usr/local/bin/app
USER app
EXPOSE ${info.port}
CMD ["app"]
`;
  }

  private generateK8sDeployment(service: ServiceDefinition): string {
    const envLines = Object.entries(service.envVars)
      .map(([k, v]) => `        - name: ${k}\n          value: "${v}"`)
      .join("\n");

    return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${service.name}
  labels:
    app: ${service.name}
spec:
  replicas: ${service.replicas}
  selector:
    matchLabels:
      app: ${service.name}
  template:
    metadata:
      labels:
        app: ${service.name}
    spec:
      containers:
      - name: ${service.name}
        image: ${service.image ?? `${service.name}:latest`}
        ports:
        - containerPort: ${service.port}
        env:
${envLines || "        []"}
        resources:
          requests:
            cpu: ${service.cpu}
            memory: ${service.memory}
          limits:
            cpu: ${service.cpu}
            memory: ${service.memory}
        livenessProbe:
          httpGet:
            path: /health
            port: ${service.port}
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: ${service.port}
          initialDelaySeconds: 5
          periodSeconds: 10`;
  }

  private generateK8sService(service: ServiceDefinition): string {
    return `apiVersion: v1
kind: Service
metadata:
  name: ${service.name}
spec:
  selector:
    app: ${service.name}
  ports:
  - port: ${service.port}
    targetPort: ${service.port}
  type: ClusterIP`;
  }

  private dbResourceType(provider: string): string {
    switch (provider) {
      case "aws":
        return "aws_db_instance";
      case "gcp":
        return "google_sql_database_instance";
      case "azure":
        return "azurerm_postgresql_server";
      default:
        return "aws_db_instance";
    }
  }

  private redisResourceType(provider: string): string {
    switch (provider) {
      case "aws":
        return "aws_elasticache_cluster";
      case "gcp":
        return "google_redis_instance";
      case "azure":
        return "azurerm_redis_cache";
      default:
        return "aws_elasticache_cluster";
    }
  }

  private storageResourceType(provider: string): string {
    switch (provider) {
      case "aws":
        return "aws_s3_bucket";
      case "gcp":
        return "google_storage_bucket";
      case "azure":
        return "azurerm_storage_account";
      default:
        return "aws_s3_bucket";
    }
  }
}
