import type { SkillPack } from "./ecommerce";

/**
 * SaaS Skill Pack
 *
 * Patterns for multi-tenancy, subscription billing, onboarding flows,
 * usage metering, and team management.
 */

export const SAAS_SKILL_PACK: SkillPack = {
  id: "skill-pack-saas",
  name: "SaaS Platform",
  description:
    "Multi-tenancy, subscription billing, onboarding, usage metering, and team management patterns",
  category: "skill-pack",
  tags: [
    "saas",
    "multi-tenant",
    "billing",
    "subscriptions",
    "onboarding",
    "teams",
  ],

  patterns: [
    {
      name: "Multi-Tenancy",
      description: "Organization-scoped data isolation with Row Level Security",
      context:
        "Every tenant's data must be isolated while sharing the same database",
      implementation: `
- Every tenant-scoped table has orgId column (NOT NULL, indexed)
- All queries MUST filter by orgId (enforce via ORM middleware or RLS policies)
- Organization table: id, name, slug, plan, settings, createdAt
- OrganizationMember table: id, orgId, userId, role (owner|admin|member|viewer)
- Use middleware to extract orgId from auth context and inject into all queries
- Slug-based subdomains or path-based routing for tenant identification
- Shared resources (e.g., system templates) have orgId = NULL
`,
    },
    {
      name: "Subscription Billing",
      description:
        "Stripe Subscriptions with plan tiers, upgrades, and usage-based pricing",
      context: "Monetize with recurring subscriptions and optional usage fees",
      implementation: `
- Plans table: id, name, stripePriceId, tier, creditsIncluded, maxSeats, features (jsonb)
- Subscription table: id, orgId, planId, stripeSubscriptionId, status, currentPeriodEnd
- Handle Stripe webhooks: customer.subscription.created/updated/deleted, invoice.paid/payment_failed
- Plan tiers: free, starter, pro, team, enterprise
- Upgrade: prorate remaining period, switch immediately
- Downgrade: schedule for end of billing period
- Usage-based: meter usage events, report to Stripe Billing Meter
- Grace period on payment failure before restricting access
`,
    },
    {
      name: "Onboarding Flow",
      description: "Guided setup wizard for new organizations",
      context: "Help new users set up their workspace efficiently",
      implementation: `
- OnboardingState table: id, orgId, currentStep, completedSteps (jsonb), metadata
- Steps: Create Org -> Invite Team -> Connect Integrations -> Choose Plan -> First Project
- Each step has a validation function and completion criteria
- Allow skipping optional steps (mark as skipped, not completed)
- Show progress indicator and estimated time remaining
- Re-entrant: user can leave and resume from where they stopped
- Trigger welcome email sequence based on onboarding progress
- Track completion rate and drop-off points for analytics
`,
    },
    {
      name: "Usage Metering",
      description: "Track and enforce resource usage limits per plan",
      context:
        "Different plans have different resource limits that must be enforced",
      implementation: `
- UsageRecord table: id, orgId, metric, value, period, createdAt
- Metrics: api_calls, storage_bytes, compute_minutes, seats, projects
- Check limits before allowing resource creation (middleware)
- Soft limits: warn at 80%, block at 100%
- Usage reset: monthly or per-billing-period
- Real-time usage display in dashboard
- Usage-based billing: aggregate metrics and report to Stripe
- Rate limiting: per-org and per-user request limits
`,
    },
    {
      name: "Team Management",
      description: "Invite members, assign roles, manage permissions",
      context: "Organizations need to manage team access and permissions",
      implementation: `
- Roles: owner (1 per org), admin, member, viewer
- Invitation table: id, orgId, email, role, token, expiresAt, acceptedAt
- Invite flow: send email with magic link -> accept -> create membership
- RBAC: define permissions per role, check in middleware
- Transfer ownership: current owner can transfer to another admin
- Remove member: revoke access, clean up personal resources
- Activity log: track who did what for audit purposes
- SSO integration: SAML/OIDC for enterprise customers
`,
    },
  ],

  agentHints: {
    architect:
      "Design with org-scoped RLS from day one. Stripe Subscriptions for billing. RBAC with role-based middleware. Usage metering as a core concern.",
    frontend_coder:
      "Build onboarding wizard with step persistence. Plan comparison UI. Team invite flow with email input. Usage dashboard with progress bars.",
    backend_coder:
      "Enforce orgId on every query. Stripe webhook handlers for subscription lifecycle. Usage checking middleware. Invitation token generation and validation.",
    test_engineer:
      "Test tenant isolation (org A cannot see org B data). Test billing edge cases (upgrade/downgrade/cancel). Test usage limit enforcement.",
    security_auditor:
      "Verify tenant data isolation. Check RBAC enforcement on all endpoints. Validate invitation token security. Review Stripe webhook signature verification.",
  },
};
