# =============================================================================
# Prometheus Platform — Terraform Outputs
# =============================================================================
# Exposes key infrastructure values after provisioning. These outputs are
# used by deployment scripts, CI/CD pipelines, and operational tooling.
# =============================================================================

# ── Cluster Endpoint ─────────────────────────────────────────────────────────

output "cluster_endpoint" {
  description = "Kubernetes cluster API endpoint"
  value = (
    var.cloud_provider == "hetzner" && length(hcloud_server.control_plane) > 0
    ? "https://${hcloud_server.control_plane[0].ipv4_address}:6443"
    : var.cloud_provider == "aws" && length(aws_eks_cluster.prometheus) > 0
    ? aws_eks_cluster.prometheus[0].endpoint
    : var.cloud_provider == "gcp" && length(google_container_cluster.prometheus) > 0
    ? "https://${google_container_cluster.prometheus[0].endpoint}"
    : "unknown"
  )
}

output "cluster_name" {
  description = "Kubernetes cluster name"
  value       = local.cluster_name
}

# ── Database ─────────────────────────────────────────────────────────────────

output "database_url" {
  description = "PostgreSQL connection string (sensitive)"
  value       = "postgresql://${var.postgres_username}:${random_password.db_password.result}@${local.db_host}:${var.postgres_port}/${var.postgres_database}"
  sensitive   = true
}

output "database_host" {
  description = "PostgreSQL host address"
  value       = local.db_host
}

output "database_port" {
  description = "PostgreSQL port"
  value       = var.postgres_port
}

output "database_name" {
  description = "PostgreSQL database name"
  value       = var.postgres_database
}

# ── Redis ────────────────────────────────────────────────────────────────────

output "redis_url" {
  description = "Redis connection string (sensitive)"
  value       = "redis://:${random_password.redis_password.result}@redis:${var.redis_port}"
  sensitive   = true
}

output "redis_host" {
  description = "Redis host address"
  value = (
    var.cloud_provider == "aws" && length(aws_elasticache_cluster.redis) > 0
    ? aws_elasticache_cluster.redis[0].cache_nodes[0].address
    : var.cloud_provider == "gcp" && length(google_redis_instance.prometheus) > 0
    ? google_redis_instance.prometheus[0].host
    : "redis.${var.domain}"
  )
}

output "redis_port" {
  description = "Redis port"
  value       = var.redis_port
}

# ── Service URLs ─────────────────────────────────────────────────────────────

output "web_url" {
  description = "Web application URL"
  value       = "https://${var.domain}"
}

output "api_url" {
  description = "API endpoint URL"
  value       = "https://api.${var.domain}"
}

output "socket_url" {
  description = "WebSocket server URL"
  value       = "wss://ws.${var.domain}"
}

output "grafana_url" {
  description = "Grafana monitoring dashboard URL"
  value       = "https://grafana.${var.domain}"
}

# ── Hetzner-Specific Outputs ─────────────────────────────────────────────────

output "hetzner_control_plane_ips" {
  description = "Public IPv4 addresses of Hetzner control plane nodes"
  value = (
    var.cloud_provider == "hetzner"
    ? [for s in hcloud_server.control_plane : s.ipv4_address]
    : []
  )
}

output "hetzner_worker_ips" {
  description = "Public IPv4 addresses of Hetzner worker nodes"
  value = (
    var.cloud_provider == "hetzner"
    ? [for s in hcloud_server.worker : s.ipv4_address]
    : []
  )
}

output "hetzner_load_balancer_ip" {
  description = "Hetzner load balancer public IP"
  value = (
    var.cloud_provider == "hetzner" && length(hcloud_load_balancer.ingress) > 0
    ? hcloud_load_balancer.ingress[0].ipv4
    : ""
  )
}

# ── AWS-Specific Outputs ─────────────────────────────────────────────────────

output "aws_eks_cluster_arn" {
  description = "ARN of the EKS cluster"
  value = (
    var.cloud_provider == "aws" && length(aws_eks_cluster.prometheus) > 0
    ? aws_eks_cluster.prometheus[0].arn
    : ""
  )
}

output "aws_rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value = (
    var.cloud_provider == "aws" && length(aws_db_instance.postgres) > 0
    ? aws_db_instance.postgres[0].endpoint
    : ""
  )
}

# ── GCP-Specific Outputs ─────────────────────────────────────────────────────

output "gcp_gke_cluster_id" {
  description = "GKE cluster self-link"
  value = (
    var.cloud_provider == "gcp" && length(google_container_cluster.prometheus) > 0
    ? google_container_cluster.prometheus[0].id
    : ""
  )
}

output "gcp_cloudsql_connection_name" {
  description = "Cloud SQL instance connection name"
  value = (
    var.cloud_provider == "gcp" && length(google_sql_database_instance.postgres) > 0
    ? google_sql_database_instance.postgres[0].connection_name
    : ""
  )
}

# ── Secrets (for CI/CD pipeline injection) ────────────────────────────────────

output "jwt_secret" {
  description = "JWT secret for authentication (sensitive)"
  value       = random_password.jwt_secret.result
  sensitive   = true
}

# ── Summary ──────────────────────────────────────────────────────────────────

output "summary" {
  description = "Human-readable deployment summary"
  value = <<-EOT
    Prometheus Platform Infrastructure
    ===================================
    Provider:    ${var.cloud_provider}
    Environment: ${var.environment}
    Cluster:     ${local.cluster_name}
    Domain:      ${var.domain}
    Workers:     ${var.worker_count}
    Database:    PostgreSQL 16 (${var.use_managed_db ? "managed" : "self-hosted"})
    Redis:       ${var.redis_memory_gb}GB
  EOT
}
