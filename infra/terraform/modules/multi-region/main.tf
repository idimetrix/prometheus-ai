# =============================================================================
# Prometheus Platform — Multi-Region Deployment Module
# =============================================================================
# Deploys the Prometheus platform across multiple cloud regions for
# high availability, disaster recovery, and low-latency global access.
#
# Usage:
#   module "multi_region" {
#     source          = "./modules/multi-region"
#     project_name    = "prometheus"
#     environment     = "production"
#     primary_region  = "us-east-1"
#     replica_regions = ["eu-west-1", "ap-southeast-1"]
#   }
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
  }
}

# =============================================================================
# Variables
# =============================================================================

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "prometheus"
}

variable "environment" {
  description = "Deployment environment (production, staging)"
  type        = string
  default     = "production"
}

variable "primary_region" {
  description = "Primary AWS region for the active cluster"
  type        = string
  default     = "us-east-1"
}

variable "replica_regions" {
  description = "List of AWS regions for read replicas and failover"
  type        = list(string)
  default     = ["eu-west-1", "ap-southeast-1"]
}

variable "eks_node_instance_type" {
  description = "EC2 instance type for EKS worker nodes"
  type        = string
  default     = "m6i.xlarge"
}

variable "eks_min_nodes" {
  description = "Minimum number of worker nodes per region"
  type        = number
  default     = 2
}

variable "eks_max_nodes" {
  description = "Maximum number of worker nodes per region"
  type        = number
  default     = 10
}

variable "eks_desired_nodes" {
  description = "Desired number of worker nodes per region"
  type        = number
  default     = 3
}

variable "db_instance_class" {
  description = "RDS instance class for the primary database"
  type        = string
  default     = "db.r6g.xlarge"
}

variable "db_storage_gb" {
  description = "Allocated storage in GB for the primary database"
  type        = number
  default     = 100
}

variable "redis_node_type" {
  description = "ElastiCache node type for Redis"
  type        = string
  default     = "cache.r6g.large"
}

variable "domain" {
  description = "Root domain for the platform"
  type        = string
  default     = "prometheus.dev"
}

variable "vpc_cidr_primary" {
  description = "CIDR block for the primary region VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "vpc_cidr_replicas" {
  description = "CIDR blocks for replica region VPCs (must not overlap)"
  type        = map(string)
  default = {
    "eu-west-1"      = "10.1.0.0/16"
    "ap-southeast-1" = "10.2.0.0/16"
  }
}

# =============================================================================
# Locals
# =============================================================================

locals {
  cluster_name = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Module      = "multi-region"
  }
}

# =============================================================================
# Primary Region Provider
# =============================================================================

provider "aws" {
  region = var.primary_region
  alias  = "primary"

  default_tags {
    tags = local.common_tags
  }
}

# =============================================================================
# Primary Region — VPC
# =============================================================================

resource "aws_vpc" "primary" {
  provider             = aws.primary
  cidr_block           = var.vpc_cidr_primary
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, {
    Name   = "${local.cluster_name}-primary-vpc"
    Region = var.primary_region
  })
}

resource "aws_subnet" "primary_private" {
  provider          = aws.primary
  count             = 3
  vpc_id            = aws_vpc.primary.id
  cidr_block        = cidrsubnet(var.vpc_cidr_primary, 8, count.index)
  availability_zone = data.aws_availability_zones.primary.names[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-primary-private-${count.index}"
    Tier = "private"
  })
}

resource "aws_subnet" "primary_public" {
  provider                = aws.primary
  count                   = 3
  vpc_id                  = aws_vpc.primary.id
  cidr_block              = cidrsubnet(var.vpc_cidr_primary, 8, count.index + 100)
  availability_zone       = data.aws_availability_zones.primary.names[count.index]
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${local.cluster_name}-primary-public-${count.index}"
    Tier = "public"
  })
}

data "aws_availability_zones" "primary" {
  provider = aws.primary
  state    = "available"
}

# =============================================================================
# Primary Region — EKS Cluster
# =============================================================================

resource "aws_eks_cluster" "primary" {
  provider = aws.primary
  name     = "${local.cluster_name}-primary"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = "1.29"

  vpc_config {
    subnet_ids              = aws_subnet.primary_private[*].id
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  encryption_config {
    provider {
      key_arn = aws_kms_key.eks.arn
    }
    resources = ["secrets"]
  }

  tags = merge(local.common_tags, {
    Region = var.primary_region
    Role   = "primary"
  })
}

resource "aws_eks_node_group" "primary_workers" {
  provider        = aws.primary
  cluster_name    = aws_eks_cluster.primary.name
  node_group_name = "${local.cluster_name}-primary-workers"
  node_role_arn   = aws_iam_role.eks_node.arn
  subnet_ids      = aws_subnet.primary_private[*].id

  scaling_config {
    desired_size = var.eks_desired_nodes
    max_size     = var.eks_max_nodes
    min_size     = var.eks_min_nodes
  }

  instance_types = [var.eks_node_instance_type]

  tags = merge(local.common_tags, {
    Region = var.primary_region
  })
}

# =============================================================================
# Primary Region — RDS PostgreSQL (Multi-AZ)
# =============================================================================

resource "aws_db_instance" "primary" {
  provider                = aws.primary
  identifier              = "${local.cluster_name}-primary-db"
  engine                  = "postgres"
  engine_version          = "16.2"
  instance_class          = var.db_instance_class
  allocated_storage       = var.db_storage_gb
  max_allocated_storage   = var.db_storage_gb * 4
  storage_encrypted       = true
  kms_key_id              = aws_kms_key.rds.arn
  db_name                 = "prometheus"
  username                = "prometheus"
  password                = random_password.db_password.result
  multi_az                = true
  backup_retention_period = 30
  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${local.cluster_name}-final-snapshot"

  vpc_security_group_ids = [aws_security_group.db.id]
  db_subnet_group_name   = aws_db_subnet_group.primary.name

  tags = merge(local.common_tags, {
    Region = var.primary_region
    Role   = "primary-writer"
  })
}

resource "aws_db_subnet_group" "primary" {
  provider   = aws.primary
  name       = "${local.cluster_name}-primary-db"
  subnet_ids = aws_subnet.primary_private[*].id

  tags = local.common_tags
}

# =============================================================================
# Cross-Region Read Replicas
# =============================================================================

resource "aws_db_instance" "read_replica" {
  for_each = toset(var.replica_regions)

  identifier          = "${local.cluster_name}-replica-${each.key}"
  replicate_source_db = aws_db_instance.primary.arn
  instance_class      = var.db_instance_class
  storage_encrypted   = true

  tags = merge(local.common_tags, {
    Region = each.key
    Role   = "read-replica"
  })
}

# =============================================================================
# Primary Region — ElastiCache Redis (Multi-AZ Replication Group)
# =============================================================================

resource "aws_elasticache_replication_group" "primary" {
  provider                   = aws.primary
  replication_group_id       = "${local.cluster_name}-redis"
  description                = "Prometheus Redis cluster - ${var.environment}"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 3
  port                       = 6379
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = merge(local.common_tags, {
    Region = var.primary_region
  })
}

# =============================================================================
# Global Accelerator — Traffic routing across regions
# =============================================================================

resource "aws_globalaccelerator_accelerator" "main" {
  provider        = aws.primary
  name            = "${local.cluster_name}-global"
  ip_address_type = "IPV4"
  enabled         = true

  tags = local.common_tags
}

resource "aws_globalaccelerator_listener" "https" {
  accelerator_arn = aws_globalaccelerator_accelerator.main.id
  protocol        = "TCP"

  port_range {
    from_port = 443
    to_port   = 443
  }
}

# =============================================================================
# Route53 — DNS with latency-based routing
# =============================================================================

resource "aws_route53_zone" "main" {
  provider = aws.primary
  name     = var.domain

  tags = local.common_tags
}

resource "aws_route53_record" "api_primary" {
  provider = aws.primary
  zone_id  = aws_route53_zone.main.zone_id
  name     = "api.${var.domain}"
  type     = "A"

  alias {
    name                   = aws_globalaccelerator_accelerator.main.dns_name
    zone_id                = aws_globalaccelerator_accelerator.main.hosted_zone_id
    evaluate_target_health = true
  }
}

# =============================================================================
# KMS Keys — Encryption at rest
# =============================================================================

resource "aws_kms_key" "eks" {
  provider            = aws.primary
  description         = "KMS key for EKS secrets encryption"
  enable_key_rotation = true

  tags = local.common_tags
}

resource "aws_kms_key" "rds" {
  provider            = aws.primary
  description         = "KMS key for RDS encryption at rest"
  enable_key_rotation = true

  tags = local.common_tags
}

# =============================================================================
# IAM Roles
# =============================================================================

resource "aws_iam_role" "eks_cluster" {
  provider = aws.primary
  name     = "${local.cluster_name}-eks-cluster"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  provider   = aws.primary
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_iam_role" "eks_node" {
  provider = aws.primary
  name     = "${local.cluster_name}-eks-node"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "eks_node_policy" {
  provider   = aws.primary
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  provider   = aws.primary
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "ecr_read_only" {
  provider   = aws.primary
  role       = aws_iam_role.eks_node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# =============================================================================
# Security Groups
# =============================================================================

resource "aws_security_group" "db" {
  provider    = aws.primary
  name_prefix = "${local.cluster_name}-db-"
  vpc_id      = aws_vpc.primary.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_primary]
    description = "PostgreSQL from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# =============================================================================
# Random password for database
# =============================================================================

resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "!@#$%^&*()-_=+"
}

# =============================================================================
# Outputs
# =============================================================================

output "primary_cluster_endpoint" {
  description = "Primary EKS cluster endpoint"
  value       = aws_eks_cluster.primary.endpoint
}

output "primary_db_endpoint" {
  description = "Primary RDS endpoint"
  value       = aws_db_instance.primary.endpoint
}

output "read_replica_endpoints" {
  description = "Read replica endpoints by region"
  value       = { for k, v in aws_db_instance.read_replica : k => v.endpoint }
}

output "redis_endpoint" {
  description = "Redis primary endpoint"
  value       = aws_elasticache_replication_group.primary.primary_endpoint_address
}

output "global_accelerator_dns" {
  description = "Global Accelerator DNS name"
  value       = aws_globalaccelerator_accelerator.main.dns_name
}

output "global_accelerator_ips" {
  description = "Global Accelerator static IPs"
  value       = aws_globalaccelerator_accelerator.main.ip_sets
}
