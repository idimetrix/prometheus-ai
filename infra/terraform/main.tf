# =============================================================================
# Prometheus Platform — Terraform Infrastructure
# =============================================================================
# Minimal but functional Terraform configuration for provisioning the
# Prometheus AI platform on cloud infrastructure.
#
# Supports multiple providers via the `provider` variable:
#   - hetzner  (default, cost-effective for self-hosted)
#   - aws      (Amazon Web Services)
#   - gcp      (Google Cloud Platform)
#
# Usage:
#   cd infra/terraform
#   terraform init
#   terraform plan -var="provider=hetzner" -var="hcloud_token=xxx"
#   terraform apply
#
# This config provisions:
#   - Kubernetes cluster (managed or self-hosted)
#   - PostgreSQL database (managed instance with pgvector)
#   - Redis instance (managed)
#   - DNS records
#   - TLS certificates via cert-manager
#   - Container registry access
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    # Hetzner Cloud — default provider for cost-effective hosting
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
    # AWS provider — for AWS deployments
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    # GCP provider — for Google Cloud deployments
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    # Kubernetes provider — for post-provisioning configuration
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    # Helm provider — for installing charts (cert-manager, ingress, etc.)
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    # TLS provider — for generating certificates
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    # Random provider — for generating passwords
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend configuration — uncomment and configure for remote state
  # backend "s3" {
  #   bucket         = "prometheus-terraform-state"
  #   key            = "infrastructure/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "prometheus-terraform-locks"
  # }
}

# =============================================================================
# Local values computed from variables
# =============================================================================

locals {
  # Common tags applied to all resources
  common_tags = {
    Project     = "prometheus"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # Cluster name derived from project and environment
  cluster_name = "${var.project_name}-${var.environment}"

  # Database connection string (constructed after provisioning)
  db_connection = {
    host     = local.db_host
    port     = var.postgres_port
    database = var.postgres_database
    username = var.postgres_username
    password = random_password.db_password.result
  }

  # Compute the database host based on provider
  db_host = (
    var.cloud_provider == "hetzner" ? "db.${var.domain}" :
    var.cloud_provider == "aws" ? "placeholder-rds-endpoint" :
    var.cloud_provider == "gcp" ? "placeholder-cloudsql-ip" :
    "localhost"
  )
}

# =============================================================================
# Random password generation
# =============================================================================

# Database password — auto-generated, stored in Terraform state
resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "!@#$%^&*()-_=+"
}

# Redis password
resource "random_password" "redis_password" {
  length  = 32
  special = false
}

# JWT secret for authentication
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

# =============================================================================
# Hetzner Cloud Resources
# =============================================================================
# Hetzner provides excellent price/performance for self-hosted K8s clusters.
# Uses k3s for lightweight Kubernetes.

# Hetzner provider configuration
provider "hcloud" {
  token = var.hcloud_token
}

# SSH key for cluster node access
resource "hcloud_ssh_key" "deploy" {
  count      = var.cloud_provider == "hetzner" ? 1 : 0
  name       = "${local.cluster_name}-deploy"
  public_key = var.ssh_public_key
  labels     = local.common_tags
}

# Kubernetes control plane node
resource "hcloud_server" "control_plane" {
  count       = var.cloud_provider == "hetzner" ? var.control_plane_count : 0
  name        = "${local.cluster_name}-cp-${count.index}"
  server_type = var.hetzner_control_plane_type
  image       = "ubuntu-24.04"
  location    = var.hetzner_location
  ssh_keys    = [hcloud_ssh_key.deploy[0].id]
  labels      = merge(local.common_tags, { Role = "control-plane" })

  # Cloud-init to install k3s
  user_data = <<-EOF
    #cloud-config
    package_update: true
    packages:
      - curl
      - jq
    runcmd:
      - curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable traefik --write-kubeconfig-mode 644" sh -
  EOF
}

# Kubernetes worker nodes
resource "hcloud_server" "worker" {
  count       = var.cloud_provider == "hetzner" ? var.worker_count : 0
  name        = "${local.cluster_name}-worker-${count.index}"
  server_type = var.hetzner_worker_type
  image       = "ubuntu-24.04"
  location    = var.hetzner_location
  ssh_keys    = [hcloud_ssh_key.deploy[0].id]
  labels      = merge(local.common_tags, { Role = "worker" })
}

# Hetzner managed PostgreSQL (if available) or dedicated server
resource "hcloud_server" "database" {
  count       = var.cloud_provider == "hetzner" && var.use_managed_db == false ? 1 : 0
  name        = "${local.cluster_name}-db"
  server_type = var.hetzner_db_type
  image       = "ubuntu-24.04"
  location    = var.hetzner_location
  ssh_keys    = [hcloud_ssh_key.deploy[0].id]
  labels      = merge(local.common_tags, { Role = "database" })

  user_data = <<-EOF
    #cloud-config
    package_update: true
    packages:
      - postgresql-16
      - postgresql-16-pgvector
    runcmd:
      - systemctl enable postgresql
      - systemctl start postgresql
  EOF
}

# Private network for internal communication
resource "hcloud_network" "cluster" {
  count    = var.cloud_provider == "hetzner" ? 1 : 0
  name     = "${local.cluster_name}-network"
  ip_range = "10.0.0.0/16"
  labels   = local.common_tags
}

resource "hcloud_network_subnet" "cluster" {
  count        = var.cloud_provider == "hetzner" ? 1 : 0
  network_id   = hcloud_network.cluster[0].id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.1.0/24"
}

# Load balancer for ingress traffic
resource "hcloud_load_balancer" "ingress" {
  count              = var.cloud_provider == "hetzner" ? 1 : 0
  name               = "${local.cluster_name}-lb"
  load_balancer_type = "lb11"
  location           = var.hetzner_location
  labels             = local.common_tags
}

# =============================================================================
# AWS Resources (when provider == "aws")
# =============================================================================

provider "aws" {
  region = var.aws_region
}

# EKS Kubernetes cluster
resource "aws_eks_cluster" "prometheus" {
  count    = var.cloud_provider == "aws" ? 1 : 0
  name     = local.cluster_name
  role_arn = var.aws_eks_role_arn

  vpc_config {
    subnet_ids = var.aws_subnet_ids
  }

  tags = local.common_tags
}

# EKS node group for worker nodes
resource "aws_eks_node_group" "workers" {
  count           = var.cloud_provider == "aws" ? 1 : 0
  cluster_name    = aws_eks_cluster.prometheus[0].name
  node_group_name = "${local.cluster_name}-workers"
  node_role_arn   = var.aws_node_role_arn
  subnet_ids      = var.aws_subnet_ids

  scaling_config {
    desired_size = var.worker_count
    max_size     = var.worker_count + 2
    min_size     = 1
  }

  instance_types = [var.aws_instance_type]

  tags = local.common_tags
}

# RDS PostgreSQL instance
resource "aws_db_instance" "postgres" {
  count                = var.cloud_provider == "aws" ? 1 : 0
  identifier           = "${local.cluster_name}-db"
  engine               = "postgres"
  engine_version       = "16"
  instance_class       = var.aws_db_instance_class
  allocated_storage    = var.postgres_storage_gb
  storage_encrypted    = true
  db_name              = var.postgres_database
  username             = var.postgres_username
  password             = random_password.db_password.result
  skip_final_snapshot  = var.environment != "production"
  deletion_protection  = var.environment == "production"
  multi_az             = var.environment == "production"
  backup_retention_period = var.environment == "production" ? 30 : 7

  tags = local.common_tags
}

# ElastiCache Redis cluster
resource "aws_elasticache_cluster" "redis" {
  count                = var.cloud_provider == "aws" ? 1 : 0
  cluster_id           = "${local.cluster_name}-redis"
  engine               = "redis"
  engine_version       = "7.0"
  node_type            = var.aws_redis_node_type
  num_cache_nodes      = 1
  port                 = var.redis_port
  parameter_group_name = "default.redis7"

  tags = local.common_tags
}

# =============================================================================
# GCP Resources (when provider == "gcp")
# =============================================================================

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# GKE Kubernetes cluster
resource "google_container_cluster" "prometheus" {
  count    = var.cloud_provider == "gcp" ? 1 : 0
  name     = local.cluster_name
  location = var.gcp_region

  # Remove default node pool, we manage our own
  remove_default_node_pool = true
  initial_node_count       = 1

  resource_labels = local.common_tags
}

# GKE node pool
resource "google_container_node_pool" "workers" {
  count      = var.cloud_provider == "gcp" ? 1 : 0
  name       = "${local.cluster_name}-workers"
  cluster    = google_container_cluster.prometheus[0].name
  location   = var.gcp_region
  node_count = var.worker_count

  node_config {
    machine_type = var.gcp_machine_type
    disk_size_gb = 100

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]
  }
}

# Cloud SQL PostgreSQL instance
resource "google_sql_database_instance" "postgres" {
  count            = var.cloud_provider == "gcp" ? 1 : 0
  name             = "${local.cluster_name}-db"
  database_version = "POSTGRES_16"
  region           = var.gcp_region

  settings {
    tier              = var.gcp_db_tier
    availability_type = var.environment == "production" ? "REGIONAL" : "ZONAL"

    backup_configuration {
      enabled = true
    }

    database_flags {
      name  = "max_connections"
      value = "200"
    }
  }

  deletion_protection = var.environment == "production"
}

# Cloud SQL database
resource "google_sql_database" "prometheus" {
  count    = var.cloud_provider == "gcp" ? 1 : 0
  name     = var.postgres_database
  instance = google_sql_database_instance.postgres[0].name
}

# Cloud SQL user
resource "google_sql_user" "prometheus" {
  count    = var.cloud_provider == "gcp" ? 1 : 0
  name     = var.postgres_username
  instance = google_sql_database_instance.postgres[0].name
  password = random_password.db_password.result
}

# Memorystore Redis
resource "google_redis_instance" "prometheus" {
  count          = var.cloud_provider == "gcp" ? 1 : 0
  name           = "${local.cluster_name}-redis"
  memory_size_gb = var.redis_memory_gb
  redis_version  = "REDIS_7_0"
  region         = var.gcp_region
  tier           = var.environment == "production" ? "STANDARD_HA" : "BASIC"

  labels = local.common_tags
}

# =============================================================================
# Kubernetes Namespace & Core Resources
# =============================================================================
# Applied after cluster provisioning to set up the Prometheus namespace
# and install required Helm charts.

# Kubernetes namespace for the platform
resource "kubernetes_namespace" "prometheus" {
  count = var.create_k8s_resources ? 1 : 0

  metadata {
    name = var.k8s_namespace
    labels = merge(local.common_tags, {
      "app.kubernetes.io/managed-by" = "terraform"
    })
  }
}

# Kubernetes secret for database credentials
resource "kubernetes_secret" "db_credentials" {
  count = var.create_k8s_resources ? 1 : 0

  metadata {
    name      = "prometheus-db-credentials"
    namespace = var.k8s_namespace
  }

  data = {
    DATABASE_URL = "postgresql://${var.postgres_username}:${random_password.db_password.result}@${local.db_host}:${var.postgres_port}/${var.postgres_database}"
    REDIS_URL    = "redis://:${random_password.redis_password.result}@redis:${var.redis_port}"
    JWT_SECRET   = random_password.jwt_secret.result
  }

  depends_on = [kubernetes_namespace.prometheus]
}

# =============================================================================
# Helm Charts — cert-manager for TLS
# =============================================================================

resource "helm_release" "cert_manager" {
  count = var.create_k8s_resources && var.install_cert_manager ? 1 : 0

  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "1.14.0"
  namespace        = "cert-manager"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }
}

# ClusterIssuer for Let's Encrypt TLS certificates
resource "kubernetes_manifest" "letsencrypt_issuer" {
  count = var.create_k8s_resources && var.install_cert_manager ? 1 : 0

  manifest = {
    apiVersion = "cert-manager.io/v1"
    kind       = "ClusterIssuer"
    metadata = {
      name = "letsencrypt-prod"
    }
    spec = {
      acme = {
        email  = var.acme_email
        server = "https://acme-v02.api.letsencrypt.org/directory"
        privateKeySecretRef = {
          name = "letsencrypt-prod-account-key"
        }
        solvers = [{
          http01 = {
            ingress = {
              class = "traefik"
            }
          }
        }]
      }
    }
  }

  depends_on = [helm_release.cert_manager]
}
