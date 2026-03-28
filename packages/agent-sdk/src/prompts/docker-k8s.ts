/**
 * Docker & Kubernetes Manifest Generation — GAP-059
 *
 * Templates for generating production-ready Dockerfiles and
 * Kubernetes manifests for projects.
 */

export interface DockerConfig {
  /** Additional apt packages to install */
  aptPackages?: string[];
  /** Base image override */
  baseImage?: string;
  /** Build command */
  buildCommand?: string;
  /** Primary language */
  language: string;
  /** Port the app listens on */
  port: number;
  /** Start command */
  startCommand: string;
}

/**
 * Generate a multi-stage Dockerfile optimized for production.
 */
export function generateDockerfile(config: DockerConfig): string {
  const { language, port, startCommand, buildCommand } = config;

  if (language === "typescript" || language === "javascript") {
    return generateNodeDockerfile(port, startCommand, buildCommand);
  }
  if (language === "python") {
    return generatePythonDockerfile(port, startCommand);
  }
  if (language === "go") {
    return generateGoDockerfile(port, startCommand);
  }
  if (language === "rust") {
    return generateRustDockerfile(port, startCommand);
  }

  return generateGenericDockerfile(config);
}

function generateNodeDockerfile(
  port: number,
  startCmd: string,
  buildCmd?: string
): string {
  return `# ─── Build Stage ───
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
${buildCmd ? `RUN ${buildCmd}` : "RUN npm run build"}

# ─── Production Stage ───
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 app && \\
    adduser --system --uid 1001 app

COPY --from=builder /app/package*.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY --from=builder /app/dist ./dist

USER app
EXPOSE ${port}
CMD ${JSON.stringify(startCmd.split(" "))}`;
}

function generatePythonDockerfile(port: number, startCmd: string): string {
  return `FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
ENV PATH=/root/.local/bin:$PATH

COPY --from=builder /root/.local /root/.local
COPY . .

RUN adduser --disabled-password --gecos '' app
USER app
EXPOSE ${port}
CMD ${JSON.stringify(startCmd.split(" "))}`;
}

function generateGoDockerfile(port: number, startCmd: string): string {
  return `FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /server .
RUN adduser -D app
USER app
EXPOSE ${port}
CMD ${JSON.stringify(startCmd.split(" "))}`;
}

function generateRustDockerfile(port: number, startCmd: string): string {
  return `FROM rust:1.77-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/app .
RUN useradd -r app
USER app
EXPOSE ${port}
CMD ${JSON.stringify(startCmd.split(" "))}`;
}

function generateGenericDockerfile(config: DockerConfig): string {
  return `FROM ${config.baseImage ?? "ubuntu:22.04"}
WORKDIR /app
COPY . .
${config.aptPackages ? `RUN apt-get update && apt-get install -y ${config.aptPackages.join(" ")}` : ""}
EXPOSE ${config.port}
CMD ${JSON.stringify(config.startCommand.split(" "))}`;
}

/**
 * Generate Kubernetes deployment, service, and ingress manifests.
 */
export function generateK8sManifests(opts: {
  appName: string;
  image: string;
  namespace?: string;
  port: number;
  replicas?: number;
  host?: string;
}): string {
  const {
    appName,
    image,
    port,
    namespace = "default",
    replicas = 2,
    host,
  } = opts;

  const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${appName}
  namespace: ${namespace}
  labels:
    app: ${appName}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${appName}
  template:
    metadata:
      labels:
        app: ${appName}
    spec:
      containers:
        - name: ${appName}
          image: ${image}
          ports:
            - containerPort: ${port}
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health
              port: ${port}
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: ${port}
            initialDelaySeconds: 5
            periodSeconds: 10`;

  const service = `---
apiVersion: v1
kind: Service
metadata:
  name: ${appName}
  namespace: ${namespace}
spec:
  selector:
    app: ${appName}
  ports:
    - port: 80
      targetPort: ${port}
  type: ClusterIP`;

  const ingress = host
    ? `---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${appName}
  namespace: ${namespace}
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts:
        - ${host}
      secretName: ${appName}-tls
  rules:
    - host: ${host}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${appName}
                port:
                  number: 80`
    : "";

  return [deployment, service, ingress].filter(Boolean).join("\n");
}
