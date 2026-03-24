# SOC 2 Compliance Controls — Prometheus Platform

This document maps the implemented security controls to the SOC 2 Trust Service Criteria (TSC).

---

## 1. Encryption

### Data at Rest
- **Database**: PostgreSQL with storage-level encryption (AES-256) via AWS RDS / Hetzner disk encryption.
- **Object Storage**: MinIO/S3 with server-side encryption enabled.
- **Kubernetes Secrets**: EKS secrets encrypted with KMS (see `infra/terraform/modules/multi-region/main.tf`).
- **Backups**: All database backups are encrypted with the same KMS key as the primary instance.

### Data in Transit
- **TLS Everywhere**: All external traffic terminates at Traefik ingress with TLS 1.2+ (cert-manager + Let's Encrypt).
- **Internal mTLS**: Service-to-service traffic within the Kubernetes cluster uses mTLS via network policies.
- **Redis**: Transit encryption enabled for ElastiCache replication groups.
- **Database Connections**: All database connections use SSL (`sslmode=require`).

### Key Management
- AWS KMS with automatic annual key rotation for all encryption keys.
- Separate KMS keys per resource type (EKS secrets, RDS, S3).

**TSC Reference**: CC6.1, CC6.7

---

## 2. Audit Logging

### Application-Level Audit Trail
- **Middleware**: `apps/api/src/middleware/audit.ts` intercepts all mutation requests (POST, PUT, PATCH, DELETE).
- **Database Table**: `audit_logs` table stores action, resource, resource_id, user_id, org_id, IP address, and details.
- **Fire-and-Forget**: Audit writes are non-blocking to avoid impacting request latency.

### Infrastructure Logging
- **Kubernetes**: All pod logs collected via Loki (`infra/monitoring/loki-config.yaml`).
- **OpenTelemetry**: Distributed tracing via OTEL collector (`infra/monitoring/otel-collector.yaml`).
- **Alerting**: Prometheus alert rules and Alertmanager for anomaly detection (`infra/monitoring/alert_rules.yml`).

### Log Retention
- Application audit logs: retained indefinitely in the database.
- Infrastructure logs (Loki): 90-day retention.
- CloudTrail / cloud provider audit logs: 365-day retention.

**TSC Reference**: CC4.1, CC7.2, CC7.3

---

## 3. Access Controls

### Authentication
- **Clerk Integration**: All user authentication via Clerk (OAuth 2.0 / OIDC).
- **Enterprise SSO**: SAML 2.0 and OIDC provider support (`packages/auth/src/sso/`).
- **SCIM Provisioning**: Automated user provisioning/deprovisioning via SCIM 2.0 (`packages/auth/src/sso/scim-provider.ts`).
- **API Key Authentication**: Service-to-service auth via API keys (`apps/api/src/middleware/api-key-auth.ts`).

### Authorization
- **RBAC**: Role-based access control with owner, admin, member roles (`apps/api/src/middleware/rbac.ts`).
- **Row-Level Security**: All tenant-scoped queries filtered by `org_id` for data isolation.
- **Fine-Grained Authorization**: OpenFGA integration for resource-level permissions (`packages/auth/src/fga-client.ts`).

### Session Management
- JWT-based sessions with automatic expiry.
- Session invalidation on password change or deprovisioning.

**TSC Reference**: CC6.1, CC6.2, CC6.3

---

## 4. Monitoring

### Application Monitoring
- **Prometheus Metrics**: Service-level metrics exported from all microservices.
- **Grafana Dashboards**: API overview, queue worker, and system health dashboards (`infra/monitoring/dashboards/`).
- **SLO Definitions**: Availability and latency SLOs defined in `infra/monitoring/slo-definitions.yaml`.
- **Uptime Monitoring**: Uptime Kuma for external endpoint monitoring (`infra/monitoring/uptime-kuma/`).

### Alert Rules
- High error rate alerts (>5% 5xx responses).
- Latency threshold alerts (p95 > 2s).
- Queue depth alerts (backlog > 1000 items).
- Database connection pool exhaustion alerts.
- Pod crash loop and OOM kill alerts.
- Defined in `infra/monitoring/alert_rules.yml` and `infra/monitoring/alerts.yaml`.

### Alertmanager Routing
- Critical alerts: PagerDuty integration.
- Warning alerts: Slack channel notifications.
- Info alerts: Email digest.
- Configuration: `infra/monitoring/alertmanager.yml`.

**TSC Reference**: CC7.1, CC7.2, CC7.3

---

## 5. Incident Response

### Detection
- Automated alert rules trigger on anomalous behavior.
- Uptime monitoring detects external availability issues.
- Log-based anomaly detection via Loki alert rules.

### Response Procedures
1. **Triage** (0-15 min): On-call engineer acknowledges alert, assesses severity.
2. **Containment** (15-60 min): Isolate affected service, enable circuit breakers.
3. **Mitigation** (1-4 hr): Apply fix or rollback via ArgoCD (`infra/k8s/base/argocd/`).
4. **Resolution**: Deploy permanent fix through standard CI/CD pipeline.
5. **Post-Mortem**: Blameless post-mortem within 48 hours of resolution.

### Communication
- Status page updates for customer-facing incidents.
- Internal Slack channel for incident coordination.
- Stakeholder notification for SEV-1 and SEV-2 incidents.

### Rollback Strategy
- ArgoCD GitOps-based rollback to last known good state.
- Database migrations support backward compatibility for zero-downtime rollbacks.
- Feature flags for gradual rollout and quick disable.

**TSC Reference**: CC7.4, CC7.5

---

## 6. Backup and Recovery

### Database Backups
- **Automated Daily Backups**: RDS automated backups with 30-day retention (production).
- **Point-in-Time Recovery**: RDS PITR enabled with 5-minute granularity.
- **Cross-Region Replication**: Read replicas in secondary regions serve as warm standby.

### Object Storage
- MinIO/S3 versioning enabled for all buckets.
- Cross-region replication for critical data buckets.

### Recovery Objectives
- **RPO** (Recovery Point Objective): 5 minutes (PITR).
- **RTO** (Recovery Time Objective): < 30 minutes (automated failover).

### Disaster Recovery
- Multi-region deployment with automatic DNS failover via Global Accelerator.
- Read replicas promotable to primary in < 5 minutes.
- Regular DR drills (quarterly).

**TSC Reference**: A1.2, A1.3

---

## 7. Data Privacy (GDPR Compliance)

### Data Subject Rights
- **Right to Erasure**: `apps/api/src/routers/gdpr.ts` — `deleteUser` endpoint cascade-deletes all user data.
- **Right to Portability**: `apps/api/src/routers/gdpr.ts` — `exportData` endpoint exports all user data as structured JSON.
- **Audit Trail**: All GDPR operations are logged in the audit trail.
- **Data Anonymization**: Audit logs are anonymized (PII scrubbed) during user deletion while preserving the audit structure.

### Data Minimization
- Only essential PII is collected (email, name, avatar URL).
- Session data is scoped to organization for multi-tenancy isolation.

**TSC Reference**: P1.1, P3.1, P4.1, P6.1, P7.1

---

## 8. Network Security

### Network Policies
- Kubernetes NetworkPolicies restrict inter-service communication (`infra/k8s/base/network-policies/`).
- Database access restricted to application VPC CIDR only.
- Redis accessible only from within the cluster.

### Ingress Security
- Traefik ingress with rate limiting (`apps/api/src/middleware/rate-limit.ts`).
- Security headers (CSP, HSTS, X-Frame-Options) on all responses (`apps/web/next.config.ts`).
- CORS restricted to known origins.

### DDoS Protection
- AWS Global Accelerator with built-in DDoS protection.
- Application-level rate limiting with configurable thresholds.
- Plan-based rate limit enforcement (`apps/api/src/middleware/plan-enforcement.ts`).

**TSC Reference**: CC6.6, CC6.7

---

## Review Schedule

This document is reviewed and updated quarterly, or whenever significant infrastructure changes are made.

| Review Date | Reviewer | Changes |
|-------------|----------|---------|
| 2026-03-24  | Platform Team | Initial SOC 2 control documentation |
