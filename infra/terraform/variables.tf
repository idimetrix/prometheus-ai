# =============================================================================
# Prometheus Platform — Terraform Variables
# =============================================================================
# All configurable variables for the Prometheus infrastructure.
# Override defaults by setting TF_VAR_<name> env vars, passing -var flags,
# or creating a terraform.tfvars file.
# =============================================================================

# ── General ──────────────────────────────────────────────────────────────────

variable "project_name" {
  description = "Project name used as prefix for all resources"
  type        = string
  default     = "prometheus"
}

variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
  default     = "staging"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be 'staging' or 'production'."
  }
}

variable "domain" {
  description = "Primary domain for the platform (e.g., prometheus.dev)"
  type        = string
  default     = "prometheus.dev"
}

variable "acme_email" {
  description = "Email for Let's Encrypt certificate registration"
  type        = string
  default     = "admin@prometheus.dev"
}

# ── Cloud Provider Selection ─────────────────────────────────────────────────

variable "cloud_provider" {
  description = "Cloud provider to deploy to (hetzner, aws, gcp)"
  type        = string
  default     = "hetzner"
  validation {
    condition     = contains(["hetzner", "aws", "gcp"], var.cloud_provider)
    error_message = "Provider must be 'hetzner', 'aws', or 'gcp'."
  }
}

# ── Cluster Configuration ────────────────────────────────────────────────────

variable "control_plane_count" {
  description = "Number of control plane nodes (use 3 for HA in production)"
  type        = number
  default     = 1
}

variable "worker_count" {
  description = "Number of worker nodes"
  type        = number
  default     = 2
}

variable "ssh_public_key" {
  description = "SSH public key for node access (Hetzner)"
  type        = string
  default     = ""
  sensitive   = true
}

# ── Hetzner-Specific ─────────────────────────────────────────────────────────

variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  default     = ""
  sensitive   = true
}

variable "hetzner_location" {
  description = "Hetzner datacenter location (nbg1, fsn1, hel1)"
  type        = string
  default     = "nbg1"
}

variable "hetzner_control_plane_type" {
  description = "Hetzner server type for control plane nodes"
  type        = string
  default     = "cpx31"  # 4 vCPU, 8GB RAM
}

variable "hetzner_worker_type" {
  description = "Hetzner server type for worker nodes"
  type        = string
  default     = "cpx41"  # 8 vCPU, 16GB RAM
}

variable "hetzner_db_type" {
  description = "Hetzner server type for dedicated database server"
  type        = string
  default     = "cpx31"  # 4 vCPU, 8GB RAM
}

# ── AWS-Specific ─────────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "aws_instance_type" {
  description = "EC2 instance type for EKS worker nodes"
  type        = string
  default     = "m6i.xlarge"  # 4 vCPU, 16GB RAM
}

variable "aws_eks_role_arn" {
  description = "IAM role ARN for the EKS cluster"
  type        = string
  default     = ""
}

variable "aws_node_role_arn" {
  description = "IAM role ARN for EKS node group"
  type        = string
  default     = ""
}

variable "aws_subnet_ids" {
  description = "VPC subnet IDs for the EKS cluster"
  type        = list(string)
  default     = []
}

variable "aws_db_instance_class" {
  description = "RDS instance class for PostgreSQL"
  type        = string
  default     = "db.t4g.medium"  # 2 vCPU, 4GB RAM
}

variable "aws_redis_node_type" {
  description = "ElastiCache node type for Redis"
  type        = string
  default     = "cache.t4g.medium"
}

# ── GCP-Specific ─────────────────────────────────────────────────────────────

variable "gcp_project_id" {
  description = "GCP project ID"
  type        = string
  default     = ""
}

variable "gcp_region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "gcp_machine_type" {
  description = "GCE machine type for GKE worker nodes"
  type        = string
  default     = "e2-standard-4"  # 4 vCPU, 16GB RAM
}

variable "gcp_db_tier" {
  description = "Cloud SQL tier for PostgreSQL"
  type        = string
  default     = "db-custom-2-4096"  # 2 vCPU, 4GB RAM
}

# ── PostgreSQL Configuration ─────────────────────────────────────────────────

variable "postgres_database" {
  description = "PostgreSQL database name"
  type        = string
  default     = "prometheus"
}

variable "postgres_username" {
  description = "PostgreSQL admin username"
  type        = string
  default     = "prometheus"
}

variable "postgres_port" {
  description = "PostgreSQL port"
  type        = number
  default     = 5432
}

variable "postgres_storage_gb" {
  description = "PostgreSQL storage size in GB"
  type        = number
  default     = 50
}

variable "use_managed_db" {
  description = "Use cloud-managed database (RDS, CloudSQL) vs self-hosted"
  type        = bool
  default     = true
}

# ── Redis Configuration ──────────────────────────────────────────────────────

variable "redis_port" {
  description = "Redis port"
  type        = number
  default     = 6379
}

variable "redis_memory_gb" {
  description = "Redis memory allocation in GB"
  type        = number
  default     = 1
}

# ── Kubernetes ───────────────────────────────────────────────────────────────

variable "k8s_namespace" {
  description = "Kubernetes namespace for the Prometheus platform"
  type        = string
  default     = "prometheus"
}

variable "create_k8s_resources" {
  description = "Whether to create K8s resources (namespace, secrets, etc.)"
  type        = bool
  default     = false
}

variable "install_cert_manager" {
  description = "Install cert-manager for automatic TLS certificates"
  type        = bool
  default     = true
}
