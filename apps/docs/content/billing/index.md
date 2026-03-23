---
title: Billing
description: Plans, credits, and usage tracking
order: 8
---

## Plans

Prometheus offers tiered plans to match different usage levels:

| Feature | Free | Starter | Pro | Team | Enterprise |
|---------|------|---------|-----|------|------------|
| Credits/month | 100 | 1,000 | 5,000 | 20,000 | Custom |
| Sessions/hour | 5 | 20 | 50 | 100 | Custom |
| Team members | 1 | 3 | 10 | 50 | Unlimited |
| Projects | 2 | 10 | 50 | Unlimited | Unlimited |
| Priority models | - | - | Yes | Yes | Yes |
| SSO | - | - | - | Yes | Yes |
| Support | Community | Email | Priority | Dedicated | Dedicated |

## Credit System

Every operation in Prometheus consumes credits based on the resources used.

### Credit Costs

| Operation | Credits |
|-----------|---------|
| Simple task (single agent) | 5-15 |
| Standard task (2-3 agents) | 15-40 |
| Complex task (4+ agents, fleet mode) | 40-100 |
| Ask mode query | 2-5 |
| Plan generation | 5-10 |
| Watch mode (per fix) | 10-20 |
| Code indexing (per 1K files) | 1 |

Credit costs depend on:

- **Model used** — Opus tasks cost more than Sonnet or Haiku tasks.
- **Token count** — Longer prompts and responses consume more credits.
- **Tool usage** — Sandbox execution, browser actions, and external API calls add to the cost.
- **Duration** — Long-running sessions that require multiple agent iterations use more credits.

### Viewing Usage

Check your current usage from the dashboard under **Settings > Billing** or via the API:

```bash
prometheus config  # Shows remaining credits in CLI
```

```typescript
const usage = await trpc.billing.usage.query();
// { creditsUsed: 2450, creditsRemaining: 2550, periodStart: "...", periodEnd: "..." }
```

### Credit Alerts

Prometheus sends notifications when:

- You reach 80% of your monthly credit allocation
- You reach 100% and operations are paused
- Your billing period resets

## Usage Tracking

Usage is tracked per organization and broken down by:

- **Project** — Credits consumed per project
- **User** — Credits consumed per team member
- **Agent** — Credits consumed per agent type
- **Date** — Daily and monthly usage graphs

Access detailed usage analytics from **Settings > Billing > Usage**.

## Upgrading and Downgrading

### Upgrading

Upgrades take effect immediately. Your new credit allocation is prorated for the remainder of the billing period.

1. Go to **Settings > Billing > Plans**
2. Select the desired plan
3. Confirm payment

### Downgrading

Downgrades are scheduled for the end of the current billing period. You retain access to your current plan's features until the period ends.

1. Go to **Settings > Billing > Plans**
2. Select the lower plan
3. Confirm — the change takes effect at period end

### Cancellation

Cancelling your subscription downgrades you to the Free plan at the end of the current billing period. Your projects and data are retained.

## Payment Methods

Prometheus uses Stripe for payment processing. Accepted methods:

- Credit and debit cards (Visa, Mastercard, Amex)
- ACH bank transfers (Team and Enterprise plans)

Manage payment methods under **Settings > Billing > Payment Methods**.
