# Incident Response Plan

## 1. Purpose

This document defines how the Prometheus team detects, responds to, and recovers from security incidents. All team members should be familiar with this plan.

---

## 2. Severity Levels

| Level | Description | Examples | Response Time |
|-------|------------|----------|---------------|
| **P0 -- Critical** | Service-wide outage, data breach, or active exploitation | Data exfiltration, production database compromised, all services down | Immediate (within 15 minutes) |
| **P1 -- High** | Significant impact to a subset of users or a critical subsystem | Authentication bypass, single-service outage, PII exposure risk | Within 1 hour |
| **P2 -- Medium** | Limited impact, no data loss, workaround available | Elevated error rates, performance degradation, non-critical vulnerability discovered | Within 4 hours |
| **P3 -- Low** | Minimal impact, informational | Suspicious but non-exploitable activity, minor misconfiguration, low-severity CVE | Within 24 hours |

---

## 3. Detection Mechanisms

### Automated Detection

- **Application Monitoring:** Sentry error tracking across all services (web, API, orchestrator, model-router, etc.)
- **Infrastructure Monitoring:** Container health checks, Kubernetes readiness/liveness probes
- **Prometheus Metrics:** Request latency, error rates, resource utilization alerts
- **Audit Log Monitoring:** Anomalous patterns in the `audit_logs` table (e.g., unusual API key usage, bulk data access)
- **Dependency Scanning:** Automated CVE alerts from GitHub Dependabot / Snyk

### Manual Detection

- **User Reports:** Bug reports via GitHub issues or support channels
- **Team Observations:** Engineers notice unusual behavior during development or on-call duties
- **External Reports:** Responsible disclosure from security researchers

---

## 4. Response Procedures

### P0 -- Critical

1. **Acknowledge** -- First responder acknowledges the incident within 15 minutes
2. **Assemble** -- Page the on-call engineer + Security Lead + Engineering Lead
3. **Contain** -- Immediately isolate affected systems:
   - Revoke compromised credentials
   - Block malicious IP addresses
   - Take affected services offline if necessary
4. **Investigate** -- Determine root cause using logs, metrics, and audit trails
5. **Remediate** -- Deploy fixes or patches
6. **Communicate** -- Notify affected users, legal team, and (if required) regulators within 72 hours
7. **Document** -- Write incident report within 48 hours of resolution

### P1 -- High

1. **Acknowledge** -- Acknowledge within 1 hour
2. **Assemble** -- Notify on-call engineer + relevant service owner
3. **Contain** -- Limit blast radius (e.g., disable affected feature, rate-limit suspicious activity)
4. **Investigate** -- Root cause analysis
5. **Remediate** -- Deploy fix, verify resolution
6. **Communicate** -- Internal notification; external notification if users are affected
7. **Document** -- Incident report within 1 week

### P2 -- Medium

1. **Acknowledge** -- Acknowledge within 4 hours
2. **Investigate** -- Assigned engineer investigates
3. **Remediate** -- Fix deployed in next release cycle
4. **Document** -- Brief summary in the incident log

### P3 -- Low

1. **Acknowledge** -- Acknowledge within 24 hours
2. **Track** -- Create GitHub issue for remediation
3. **Remediate** -- Address in regular sprint work

---

## 5. Communication Plan

### Internal Communication

| Audience | Channel | When |
|----------|---------|------|
| On-call engineer | PagerDuty / phone | Immediately for P0/P1 |
| Engineering team | Slack #incidents channel | All severities |
| Leadership | Slack DM + email | P0 and P1 |
| Legal / Compliance | Email | P0 (data breach) |

### External Communication

| Audience | Channel | When |
|----------|---------|------|
| Affected users | Email + in-app banner | P0: within 72 hours; P1: within 1 week |
| All users (status page) | Status page update | P0/P1: during incident |
| Regulators | Formal notification | P0 with PII impact: within 72 hours (GDPR) |

### Communication Templates

**Initial Notification (Internal):**
> INCIDENT [P0/P1/P2/P3]: [Brief description]
> Impact: [Who/what is affected]
> Status: [Investigating / Contained / Resolved]
> Lead: [Name]
> Channel: #incidents

**User Notification (External):**
> We are aware of an issue affecting [description]. Our team is actively working on a resolution. We will provide updates as they become available. If you have questions, please contact support@prometheus.dev.

---

## 6. Post-Incident Review

After every P0 and P1 incident (and optionally P2):

1. **Schedule Review** -- Within 5 business days of resolution
2. **Attendees** -- Incident responders, service owners, Security Lead
3. **Agenda:**
   - Timeline of events
   - Root cause analysis (use the "5 Whys" technique)
   - What went well
   - What could be improved
   - Action items with owners and due dates
4. **Output** -- Post-incident review document stored in `docs/security/incidents/`
5. **Follow-up** -- Track action items to completion

---

## 7. Roles and Responsibilities

| Role | Responsibility |
|------|---------------|
| **Incident Commander** | Coordinates response, makes decisions, communicates status |
| **On-Call Engineer** | First responder, performs initial triage and containment |
| **Security Lead** | Advises on security implications, handles external reporting |
| **Engineering Lead** | Provides technical guidance, approves emergency changes |
| **Communications Lead** | Drafts user-facing messages, updates status page |

---

## 8. Testing and Maintenance

- **Quarterly:** Review and update this plan
- **Biannually:** Conduct tabletop exercises (simulate P0 scenario)
- **Annually:** Full incident response drill
- **After Each Incident:** Update plan based on lessons learned
