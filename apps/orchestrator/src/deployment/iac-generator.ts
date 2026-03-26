/**
 * Infrastructure-as-Code Generator.
 *
 * Generates GitHub Actions workflows, Dockerfiles, Kubernetes manifests,
 * and docker-compose configurations from project metadata. Used by the
 * deploy engineer agent to bootstrap CI/CD and deployment infrastructure.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:iac-generator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  /** Build command (e.g., "pnpm build") */
  buildCommand: string;
  /** Database type if any */
  database?: "postgres" | "mysql" | "sqlite" | "none";
  /** Install command (e.g., "pnpm install") */
  installCommand: string;
  /** Lint command (e.g., "pnpm lint") */
  lintCommand?: string;
  /** Name of the project/service */
  name: string;
  /** Exposed port */
  port: number;
  /** Runtime (e.g., "node", "python", "go") */
  runtime: "node" | "python" | "go" | "rust";
  /** Start command for production (e.g., "node dist/index.js") */
  startCommand: string;
  /** Test command (e.g., "pnpm test") */
  testCommand?: string;
  /** Typecheck command (e.g., "pnpm typecheck") */
  typecheckCommand?: string;
  /** Whether the project uses Redis */
  usesRedis?: boolean;
}

export interface GeneratedManifest {
  content: string;
  filename: string;
  type:
    | "github-actions"
    | "dockerfile"
    | "k8s-deployment"
    | "k8s-service"
    | "docker-compose";
}

// ---------------------------------------------------------------------------
// IaCGenerator
// ---------------------------------------------------------------------------

export class IaCGenerator {
  /**
   * Generate a GitHub Actions CI/CD workflow for the project.
   */
  generateGitHubActions(config: ProjectConfig): GeneratedManifest {
    const runtimeVersion = getRuntimeVersion(config.runtime);
    const lines: string[] = [
      `name: CI/CD - ${config.name}`,
      "",
      "on:",
      "  push:",
      "    branches: [main, master]",
      "  pull_request:",
      "    branches: [main, master]",
      "",
      "concurrency:",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Intentional GitHub Actions expression syntax in generated YAML
      "  group: ${{ github.workflow }}-${{ github.ref }}",
      "  cancel-in-progress: true",
      "",
      "jobs:",
      "  lint-and-test:",
      "    name: Lint, Type Check & Test",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "",
    ];

    if (config.runtime === "node") {
      lines.push(
        "      - uses: pnpm/action-setup@v4",
        "        with:",
        "          version: 9",
        "",
        "      - uses: actions/setup-node@v4",
        "        with:",
        `          node-version: "${runtimeVersion}"`,
        "          cache: pnpm",
        "",
        `      - run: ${config.installCommand}`,
        ""
      );

      if (config.lintCommand) {
        lines.push(
          "      - name: Lint",
          `        run: ${config.lintCommand}`,
          ""
        );
      }
      if (config.typecheckCommand) {
        lines.push(
          "      - name: Type Check",
          `        run: ${config.typecheckCommand}`,
          ""
        );
      }
      if (config.testCommand) {
        lines.push(
          "      - name: Test",
          `        run: ${config.testCommand}`,
          ""
        );
      }
      lines.push(
        "      - name: Build",
        `        run: ${config.buildCommand}`,
        ""
      );
    }

    // Docker build job
    lines.push(
      "",
      "  docker-build:",
      "    name: Build Docker Image",
      "    needs: lint-and-test",
      "    runs-on: ubuntu-latest",
      "    if: github.event_name == 'push'",
      "    permissions:",
      "      contents: read",
      "      packages: write",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "",
      "      - uses: docker/setup-buildx-action@v3",
      "",
      "      - uses: docker/login-action@v3",
      "        with:",
      "          registry: ghcr.io",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Intentional GitHub Actions expression syntax in generated YAML
      "          username: ${{ github.actor }}",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Intentional GitHub Actions expression syntax in generated YAML
      "          password: ${{ secrets.GITHUB_TOKEN }}",
      "",
      "      - uses: docker/build-push-action@v5",
      "        with:",
      "          push: true",
      `          tags: ghcr.io/\${{ github.repository }}/${config.name}:\${{ github.sha }}`,
      "          file: Dockerfile",
      "          cache-from: type=gha",
      "          cache-to: type=gha,mode=max",
      ""
    );

    // Deploy job
    lines.push(
      "  deploy-staging:",
      "    name: Deploy to Staging",
      "    needs: docker-build",
      "    runs-on: ubuntu-latest",
      "    if: github.ref == 'refs/heads/main'",
      "    environment: staging",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "",
      "      - name: Deploy to staging",
      `        run: echo "Deploy \${{ github.sha }} to staging"`,
      "        env:",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Intentional GitHub Actions expression syntax in generated YAML
      "          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}",
      ""
    );

    const content = lines.join("\n");

    logger.info(
      { name: config.name, runtime: config.runtime },
      "Generated GitHub Actions workflow"
    );

    return {
      filename: `.github/workflows/${config.name}-ci.yml`,
      type: "github-actions",
      content,
    };
  }

  /**
   * Generate a multi-stage Dockerfile for the project.
   */
  generateDockerfile(config: ProjectConfig): GeneratedManifest {
    let content: string;

    if (config.runtime === "node") {
      content = [
        "# ── Build Stage ──",
        `FROM node:${getRuntimeVersion("node")}-alpine AS builder`,
        "WORKDIR /app",
        "",
        "# Enable corepack for pnpm",
        "RUN corepack enable",
        "",
        "# Install dependencies first (better layer caching)",
        "COPY package.json pnpm-lock.yaml ./",
        `RUN ${config.installCommand} --frozen-lockfile`,
        "",
        "# Copy source and build",
        "COPY . .",
        `RUN ${config.buildCommand}`,
        "",
        "# ── Production Stage ──",
        `FROM node:${getRuntimeVersion("node")}-alpine AS runner`,
        "WORKDIR /app",
        "",
        "# Create non-root user",
        "RUN addgroup -g 1001 -S appuser && adduser -S appuser -u 1001",
        "",
        "# Copy built artifacts",
        "COPY --from=builder --chown=appuser:appuser /app/dist ./dist",
        "COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules",
        "COPY --from=builder --chown=appuser:appuser /app/package.json ./package.json",
        "",
        "USER appuser",
        "",
        `EXPOSE ${config.port}`,
        "",
        `HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${config.port}/health || exit 1`,
        "",
        `CMD ${JSON.stringify(config.startCommand.split(" "))}`,
        "",
      ].join("\n");
    } else if (config.runtime === "go") {
      content = [
        "# ── Build Stage ──",
        `FROM golang:${getRuntimeVersion("go")}-alpine AS builder`,
        "WORKDIR /app",
        "COPY go.mod go.sum ./",
        "RUN go mod download",
        "COPY . .",
        "RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .",
        "",
        "# ── Production Stage ──",
        "FROM alpine:3.19 AS runner",
        "RUN adduser -D -u 1001 appuser",
        "COPY --from=builder /app/server /usr/local/bin/server",
        "USER appuser",
        `EXPOSE ${config.port}`,
        `HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${config.port}/health || exit 1`,
        'CMD ["server"]',
        "",
      ].join("\n");
    } else {
      content = [
        `# Dockerfile for ${config.name} (${config.runtime})`,
        `# TODO: Customize for your ${config.runtime} project`,
        `EXPOSE ${config.port}`,
        "",
      ].join("\n");
    }

    logger.info(
      { name: config.name, runtime: config.runtime },
      "Generated Dockerfile"
    );

    return {
      filename: "Dockerfile",
      type: "dockerfile",
      content,
    };
  }

  /**
   * Generate a Kubernetes Deployment manifest.
   */
  generateK8sDeployment(
    config: ProjectConfig,
    options?: { namespace?: string; replicas?: number; imageTag?: string }
  ): GeneratedManifest {
    const namespace = options?.namespace ?? "default";
    const replicas = options?.replicas ?? 2;
    const imageTag = options?.imageTag ?? "latest";
    const name = config.name;

    const content = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      `  name: ${name}`,
      `  namespace: ${namespace}`,
      "  labels:",
      `    app: ${name}`,
      "spec:",
      `  replicas: ${replicas}`,
      "  selector:",
      "    matchLabels:",
      `      app: ${name}`,
      "  strategy:",
      "    type: RollingUpdate",
      "    rollingUpdate:",
      "      maxUnavailable: 0",
      "      maxSurge: 1",
      "  template:",
      "    metadata:",
      "      labels:",
      `        app: ${name}`,
      "    spec:",
      "      terminationGracePeriodSeconds: 30",
      "      containers:",
      `        - name: ${name}`,
      `          image: ghcr.io/${name}:${imageTag}`,
      "          ports:",
      `            - containerPort: ${config.port}`,
      "              protocol: TCP",
      "          env:",
      "            - name: NODE_ENV",
      '              value: "production"',
      "            - name: PORT",
      `              value: "${config.port}"`,
      "          resources:",
      "            requests:",
      "              cpu: 250m",
      "              memory: 256Mi",
      "            limits:",
      "              cpu: '1'",
      "              memory: 512Mi",
      "          readinessProbe:",
      "            httpGet:",
      "              path: /health",
      `              port: ${config.port}`,
      "            initialDelaySeconds: 10",
      "            periodSeconds: 15",
      "            timeoutSeconds: 3",
      "            failureThreshold: 3",
      "          livenessProbe:",
      "            httpGet:",
      "              path: /live",
      `              port: ${config.port}`,
      "            initialDelaySeconds: 30",
      "            periodSeconds: 30",
      "            timeoutSeconds: 5",
      "            failureThreshold: 5",
      "          startupProbe:",
      "            httpGet:",
      "              path: /health",
      `              port: ${config.port}`,
      "            failureThreshold: 30",
      "            periodSeconds: 10",
      "",
    ].join("\n");

    logger.info(
      { name, namespace, replicas },
      "Generated K8s Deployment manifest"
    );

    return {
      filename: `k8s/${name}-deployment.yaml`,
      type: "k8s-deployment",
      content,
    };
  }

  /**
   * Generate a Kubernetes Service manifest.
   */
  generateK8sService(
    config: ProjectConfig,
    options?: {
      namespace?: string;
      type?: "ClusterIP" | "LoadBalancer" | "NodePort";
    }
  ): GeneratedManifest {
    const namespace = options?.namespace ?? "default";
    const serviceType = options?.type ?? "ClusterIP";
    const name = config.name;

    const content = [
      "apiVersion: v1",
      "kind: Service",
      "metadata:",
      `  name: ${name}`,
      `  namespace: ${namespace}`,
      "  labels:",
      `    app: ${name}`,
      "spec:",
      `  type: ${serviceType}`,
      "  selector:",
      `    app: ${name}`,
      "  ports:",
      `    - port: ${config.port}`,
      `      targetPort: ${config.port}`,
      "      protocol: TCP",
      "      name: http",
      "",
    ].join("\n");

    logger.info(
      { name, namespace, type: serviceType },
      "Generated K8s Service manifest"
    );

    return {
      filename: `k8s/${name}-service.yaml`,
      type: "k8s-service",
      content,
    };
  }

  /**
   * Generate all manifests for a project in one call.
   */
  generateAll(
    config: ProjectConfig,
    options?: { namespace?: string; replicas?: number }
  ): GeneratedManifest[] {
    return [
      this.generateGitHubActions(config),
      this.generateDockerfile(config),
      this.generateK8sDeployment(config, options),
      this.generateK8sService(config, options),
    ];
  }
}

// ── Helpers ──

function getRuntimeVersion(runtime: string): string {
  switch (runtime) {
    case "node":
      return "22";
    case "go":
      return "1.22";
    case "python":
      return "3.12";
    case "rust":
      return "1.77";
    default:
      return "latest";
  }
}
