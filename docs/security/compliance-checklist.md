# SOC2 Type II / ISO 27001 Compliance Preparation Checklist

## Overview

This document tracks Prometheus's readiness for SOC2 Type II certification and ISO 27001 compliance. SOC2 Type II requires a **6-month observation period** during which controls must be consistently operating.

---

## 1. Security Policies Required

| Policy | Status | Owner |
|--------|--------|-------|
| Access Control Policy | Draft needed | Security Lead |
| Change Management Policy | Draft needed | Engineering Lead |
| Incident Response Plan | Draft (see `incident-response.md`) | Security Lead |
| Data Classification Policy | Draft needed | Security Lead |
| Acceptable Use Policy | Draft needed | HR / Legal |
| Password / Authentication Policy | Draft needed | Security Lead |
| Encryption Policy | Draft needed | Security Lead |
| Vendor Risk Management Policy | Draft needed | Security Lead |
| Business Continuity / DR Plan | Draft needed | Engineering Lead |
| Data Retention and Disposal Policy | Draft needed | Legal / Security Lead |

---

## 2. Technical Controls Already in Place

Prometheus has the following security controls implemented:

- **Row-Level Security (RLS):** All tenant-scoped database queries are filtered by `org_id`, enforced at the Drizzle ORM query layer.
- **Encryption at Rest:** PostgreSQL data encrypted at the filesystem level. MinIO object storage supports server-side encryption.
- **Encryption in Transit:** All services communicate over TLS. WebSocket connections use WSS.
- **Audit Logging:** The `audit-logs` table records security-relevant events (user actions, API key usage, configuration changes).
- **Role-Based Access Control (RBAC):** Organization-level roles (owner, admin, member) enforced in tRPC middleware.
- **API Key Management:** Scoped API keys with per-key audit trails, rotation support, and revocation.
- **Input Validation:** Zod schemas validate all tRPC inputs. No raw SQL queries (Drizzle ORM only).
- **Rate Limiting:** Model router and API endpoints have rate limiting to prevent abuse.
- **Structured Logging:** All services use `@prometheus/logger` for structured, queryable log output.
- **Container Isolation:** Services run in isolated Docker containers with defined resource limits.

---

## 3. Controls Still Needed

### High Priority (Must Have for SOC2)

- [ ] **Formal Security Training Program** -- Annual security awareness training for all employees
- [ ] **Vendor Risk Assessments** -- Document security posture of all third-party services (model providers, cloud infrastructure, SaaS tools)
- [ ] **Business Continuity Plan (BCP)** -- Documented plan for maintaining operations during outages
- [ ] **Disaster Recovery Plan (DR)** -- RTO/RPO targets, backup verification, failover procedures
- [ ] **Vulnerability Management Program** -- Regular dependency scanning, penetration testing schedule
- [ ] **Background Checks** -- For employees with access to production systems
- [ ] **Formal Change Management Process** -- Documented approval workflow for production changes

### Medium Priority (Recommended)

- [ ] **SSO / SAML Integration** -- Enterprise single sign-on for the platform
- [ ] **MFA Enforcement** -- Require multi-factor authentication for all users
- [ ] **Secrets Management** -- Centralized secrets vault (e.g., HashiCorp Vault) instead of environment variables
- [ ] **Network Segmentation** -- Ensure internal services are not publicly accessible
- [ ] **WAF / DDoS Protection** -- Web application firewall for the public-facing API and web app
- [ ] **Log Retention Policy** -- Define how long audit logs and application logs are retained (minimum 1 year for SOC2)

### Low Priority (Nice to Have)

- [ ] **Bug Bounty Program** -- Public or private vulnerability disclosure program
- [ ] **SIEM Integration** -- Centralized security event monitoring
- [ ] **Data Loss Prevention (DLP)** -- Prevent accidental exposure of sensitive data

---

## 4. Timeline

| Phase | Duration | Activities |
|-------|----------|------------|
| **Preparation** | Months 1-2 | Draft all required policies, implement missing controls, select audit firm |
| **Remediation** | Months 3-4 | Close control gaps, conduct internal audit, train employees |
| **Observation Period** | Months 5-10 | SOC2 Type II requires 6 months of evidence that controls are operating effectively |
| **Audit** | Month 11 | External auditor reviews evidence and issues report |
| **Certification** | Month 12 | Receive SOC2 Type II report |

**Total estimated time: 10-12 months from kickoff.**

---

## 5. Recommended Audit Firms

| Firm | Specialization | Estimated Cost |
|------|---------------|----------------|
| Vanta + Auditor Partner | Automated compliance platform + audit | $30,000-$60,000/year |
| Drata + Auditor Partner | Automated compliance platform + audit | $25,000-$50,000/year |
| Schellman | Direct SOC2 audit firm | $40,000-$80,000 |
| A-LIGN | SOC2 and ISO 27001 combined | $50,000-$100,000 |
| Secureframe + Auditor Partner | Automated compliance + audit | $30,000-$55,000/year |

---

## 6. Estimated Costs

| Item | One-Time | Annual |
|------|----------|--------|
| Compliance automation platform (Vanta/Drata) | -- | $15,000-$25,000 |
| SOC2 Type II audit | -- | $30,000-$60,000 |
| ISO 27001 certification (if combined) | $20,000 | $15,000 |
| Penetration testing | -- | $10,000-$25,000 |
| Security training platform | -- | $3,000-$5,000 |
| **Total estimate** | **$20,000** | **$73,000-$140,000** |

---

## 7. Next Steps

1. Assign a Security Lead / DRI for compliance
2. Select a compliance automation platform
3. Begin drafting required policies
4. Schedule vendor risk assessments
5. Set target date for audit readiness
