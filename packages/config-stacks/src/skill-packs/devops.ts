export const devopsSkillPack = {
  id: "devops",
  name: "DevOps & Infrastructure",
  description: "IaC, CI/CD, container orchestration, monitoring",
  domains: ["infrastructure", "deployment", "monitoring", "sre"],
  knowledge: [
    "Infrastructure as Code: all infrastructure changes via Terraform/Pulumi, never manual",
    "GitOps workflow: infrastructure state stored in Git, reconciled by ArgoCD/Flux",
    "Container images must be scanned for vulnerabilities before deployment",
    "Use multi-stage Docker builds to minimize image size",
    "Implement health checks (liveness + readiness) on all services",
    "Use Kubernetes resource limits and requests on all pods",
    "Implement circuit breakers between services (retry with backoff)",
    "Centralized logging with structured JSON format (ELK/Loki)",
    "Distributed tracing with OpenTelemetry for all service-to-service calls",
    "Alert on SLO violations, not individual metrics (error budget approach)",
    "Blue-green or canary deployments for zero-downtime releases",
    "Database migrations must be backward-compatible (expand-contract pattern)",
  ],
  conventions: {
    naming: {
      resources: "Use consistent prefix: {project}-{env}-{resource}",
    },
    validation: "Validate all k8s manifests with kubeval before applying",
    errorHandling: "Implement graceful shutdown handlers in all services",
  },
};
