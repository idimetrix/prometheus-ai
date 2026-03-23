# Prometheus — API Keys & External Services Guide

This document lists every external API key required (or optional) for Prometheus, how to obtain each one, estimated costs, and how Prometheus uses it.

---

## Quick Status

| # | Service | Type | Required | Cost | Status |
|---|---------|------|----------|------|--------|
| 1 | **Clerk** | Auth | **YES** | Free (dev) / $25+/mo (prod) | Configured |
| 2 | **Stripe** | Billing | **YES** | 2.9% + 30¢ per transaction | Not configured |
| 3 | **Ollama** | LLM (local) | **YES** | Free (self-hosted) | Installed |
| 4 | **Groq** | LLM API | Recommended | Free tier | Not configured |
| 5 | **Cerebras** | LLM API | Recommended | Free tier | Not configured |
| 6 | **Gemini** | LLM API | Recommended | Free tier | Not configured |
| 7 | **Anthropic** | LLM API | Recommended | Pay-per-use | Configured |
| 8 | **OpenAI** | LLM API | Optional | Pay-per-use | Configured |
| 9 | **OpenRouter** | LLM API | Optional | Pay-per-use | Not configured |
| 10 | **Mistral** | LLM API | Optional | Pay-per-use | Not configured |
| 11 | **DeepSeek** | LLM API | Optional | Pay-per-use | Not configured |
| 12 | **Resend** | Email | Optional | Free (100/day) | Not configured |
| 13 | **Sentry** | Monitoring | Optional | Free (5K events/mo) | Not configured |

---

## 1. Clerk — Authentication & User Management

**Required: YES**

### What Prometheus uses it for
- User sign-up/sign-in (email + OAuth)
- Organization management (teams)
- Session tokens & JWT verification on every API request
- Webhook events: user created/updated/deleted, org created, membership changes
- When a new org is created via webhook, Prometheus auto-provisions a Hobby plan with 50 credits

### Env vars needed
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
```

### How to get keys
1. Go to https://clerk.com → Sign up / Log in
2. Create a new Application → name it "Prometheus"
3. Enable **Organizations** in the sidebar
4. Go to **API Keys** → copy Publishable Key and Secret Key
5. Go to **Webhooks** → Add Endpoint:
   - URL: `https://api-prometheus.dev.apidly.com/webhooks/clerk`
   - Events: `user.created`, `user.updated`, `user.deleted`, `organization.created`, `organizationMembership.created`, `organizationMembership.deleted`
   - Copy the **Signing Secret** (`whsec_...`)

### Cost
| Plan | Price | Limits |
|------|-------|--------|
| Free (Development) | $0 | 10,000 MAU, 5 orgs |
| Pro | $25/mo | 10,000 MAU included, $0.02/additional |
| Enterprise | Custom | Unlimited |

### Key files
- `packages/auth/src/server.ts` — Auth utilities
- `apps/api/src/routes/webhooks/clerk.ts` — Webhook handler
- `apps/web/src/middleware.ts` — Route protection

---

## 2. Stripe — Billing & Payments

**Required: YES** (for billing features)

### What Prometheus uses it for
- Subscription management (Hobby → Starter → Pro → Team → Studio → Enterprise)
- Credit pack purchases (100 / 500 / 1,000 / 5,000 credits)
- Monthly credit grants when invoice is paid
- Billing portal for customers to manage subscriptions
- Checkout sessions for plan upgrades and credit purchases

### Subscription plans to create

| Plan | Monthly Price | Credits/mo | Agents | Tasks/day |
|------|-------------|------------|--------|-----------|
| Hobby | Free | 50 | 1 | 5 |
| Starter | $29 | 500 | 2 | 50 |
| Pro | $79 | 2,000 | 5 | 200 |
| Team | $199 | 8,000 | 10 | 500 |
| Studio | $499 | 25,000 | 25 | 2,000 |

### Credit costs (what users spend credits on)
- Simple fix: 5 credits
- Medium task: 25 credits
- Complex task: 75 credits
- Ask mode: 2 credits
- Plan mode: 10 credits

### Env vars needed
```
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_TEAM=price_...
STRIPE_PRICE_STUDIO=price_...
STRIPE_PRICE_CREDITS_100=price_...
STRIPE_PRICE_CREDITS_500=price_...
STRIPE_PRICE_CREDITS_1000=price_...
STRIPE_PRICE_CREDITS_5000=price_...
```

### How to get keys
1. Go to https://stripe.com → Create account
2. Toggle **Test Mode** (top-right)
3. Go to **Developers → API Keys** → copy Secret key (`sk_test_...`) and Publishable key (`pk_test_...`)
4. Go to **Product Catalog → Add Product**:
   - Create 4 subscription products (Starter $29, Pro $79, Team $199, Studio $499) — monthly recurring
   - Create 4 one-time products (100 Credits, 500 Credits, 1000 Credits, 5000 Credits)
   - Copy each `price_xxx` ID
5. Go to **Developers → Webhooks → Add Endpoint**:
   - URL: `https://api-prometheus.dev.apidly.com/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
   - Copy the Signing Secret

### Cost
Stripe charges **2.9% + $0.30** per successful card charge. No monthly fee. You earn revenue from subscriptions minus Stripe's cut.

### Key files
- `packages/billing/src/stripe.ts` — Stripe service class
- `packages/billing/src/products.ts` — Plan tiers & credit costs
- `apps/api/src/routes/webhooks/stripe.ts` — Webhook handler
- `apps/api/src/routers/billing.ts` — Billing tRPC endpoints

---

## 3. Ollama — Local LLM Inference

**Required: YES**

### What Prometheus uses it for
Ollama runs LLMs locally on the server at zero cost. It's the **primary provider** for most routing slots:

| Model | Routing Slot | Purpose |
|-------|-------------|---------|
| `qwen3-coder-next` | **default** (primary) | General coding tasks |
| `deepseek-r1:32b` | **think** (primary) | Deep reasoning & planning |
| `qwen3.5:27b` | **think** (fallback) | Reasoning fallback |
| `qwen2.5-coder:14b` | **background** (primary) | Lightweight indexing |
| `nomic-embed-text` | **embedding** | Vector embeddings for semantic search |

### Env var
```
OLLAMA_BASE_URL=http://localhost:11434
```

### How to set up
Already installed on the server. To pull models:
```bash
ssh root@185.241.151.197
ollama pull qwen2.5-coder:14b    # ~9GB, background tasks
ollama pull deepseek-r1:32b       # ~20GB, reasoning (needs ~24GB RAM)
```

### Cost
**Free** — runs on your own server hardware. Requires GPU RAM for large models.

### Key files
- `packages/ai/src/models.ts` — Model registry (Tier 0)
- `packages/ai/src/client.ts` — Ollama client setup

---

## 4. Groq — Fast LLM Inference

**Recommended: YES** (free, used as fallback for default & fastLoop)

### What Prometheus uses it for
| Model | Routing Slot | Purpose |
|-------|-------------|---------|
| `llama-3.3-70b-versatile` | **fastLoop** (fallback) | Fast CI iterations |
| `llama-3.3-70b-versatile` | **default** (fallback) | General coding fallback |

### Env var
```
GROQ_API_KEY=gsk_...
```

### How to get key
1. Go to https://console.groq.com
2. Sign up with Google/GitHub
3. Go to **API Keys** → **Create API Key**
4. Copy the key (starts with `gsk_`)

### Cost
| Tier | Price | Rate Limits |
|------|-------|-------------|
| **Free** | $0 | 30 req/min, 131K tokens/min |
| Pay-as-you-go | ~$0.05/M input, ~$0.08/M output | Higher limits |

**Prometheus uses it at Tier 1 (free).**

### Key files
- `packages/ai/src/models.ts` — Rate limit: 30 RPM, 131K TPM

---

## 5. Cerebras — Fast Large Model Inference

**Recommended: YES** (free, primary for fastLoop)

### What Prometheus uses it for
| Model | Routing Slot | Purpose |
|-------|-------------|---------|
| `qwen3-235b` | **fastLoop** (primary) | Fast CI loop iterations |
| `qwen3-235b` | **default** (fallback) | General coding fallback |

### Env var
```
CEREBRAS_API_KEY=...
```

### How to get key
1. Go to https://cloud.cerebras.ai
2. Sign up → verify email
3. Go to **API Keys** → **Create new key**
4. Copy the key

### Cost
| Tier | Price |
|------|-------|
| **Free** | $0 — 30 req/min, 1M tokens/min |

**Prometheus uses it at Tier 1 (free). Fastest inference for large models.**

---

## 6. Google Gemini — Long Context Processing

**Recommended: YES** (free, primary for longContext)

### What Prometheus uses it for
| Model | Routing Slot | Purpose |
|-------|-------------|---------|
| `gemini-2.5-flash` | **longContext** (primary) | Codebase analysis (1M token context!) |
| `gemini-2.5-flash` | **vision** (fallback) | Image understanding fallback |

Gemini's **1,048,576 token context window** is the largest in the system — used when analyzing entire codebases or very large files.

### Env var
```
GEMINI_API_KEY=...
```

### How to get key
1. Go to https://aistudio.google.com/apikey
2. Sign in with Google
3. Click **Create API Key** → select a Google Cloud project (or create one)
4. Copy the key

### Cost
| Tier | Price |
|------|-------|
| **Free** | 15 req/min, 1M tokens/min |
| Pay-as-you-go | $0.075/M input, $0.30/M output (Flash) |

**Prometheus uses it at Tier 1 (free). Best value for long-context tasks.**

---

## 7. Anthropic — Premium AI (Claude)

**Recommended: YES** (needed for vision, review, and premium tasks)

### What Prometheus uses it for
| Model | Routing Slot | Purpose |
|-------|-------------|---------|
| `claude-sonnet-4-6` | **vision** (primary) | Image & screenshot understanding |
| `claude-sonnet-4-6` | **review** (primary) | Code review & quality analysis |
| `claude-sonnet-4-6` | **think** (fallback) | Deep reasoning fallback |
| `claude-opus-4-6` | **premium** (primary) | Most complex tasks, highest quality |

### Env var
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### How to get key
1. Go to https://console.anthropic.com
2. Sign up → add payment method
3. Go to **API Keys** → **Create Key**
4. Copy the key

### Cost
| Model | Input | Output | ~Cost per task |
|-------|-------|--------|----------------|
| Claude Sonnet 4.6 | $3.00/M tokens | $15.00/M tokens | ~$0.01-0.05 |
| Claude Opus 4.6 | $15.00/M tokens | $75.00/M tokens | ~$0.05-0.25 |

**Budget estimate:** At moderate usage (100 tasks/day), expect $5-30/month for Anthropic.

### Key files
- `packages/ai/src/models.ts` — Sonnet (Tier 3), Opus (Tier 4)
- `apps/model-router/src/router.ts` — Routing logic

---

## 8. OpenAI — GPT Models

**Optional** (no models currently in routing slots)

### What Prometheus uses it for
The OpenAI client is configured but **no models are actively routed**. Available for future use or custom model configs.

### Env var
```
OPENAI_API_KEY=sk-proj-...
```

### How to get key
1. Go to https://platform.openai.com
2. Sign up → add payment method
3. Go to **API Keys** → **Create new secret key**

### Cost
| Model | Input | Output |
|-------|-------|--------|
| GPT-4o | $2.50/M tokens | $10.00/M tokens |
| GPT-4o-mini | $0.15/M tokens | $0.60/M tokens |

---

## 9. OpenRouter — Multi-Model Gateway

**Optional** (integrated but no models currently routed)

### What Prometheus uses it for
OpenRouter provides access to 100+ models through a single API. Currently integrated as a provider but no models are assigned to routing slots. Useful as a universal fallback.

### Env var
```
OPENROUTER_API_KEY=sk-or-v1-...
```

### How to get key
1. Go to https://openrouter.ai
2. Sign up → go to **Keys** → **Create Key**

### Cost
Pay-per-use, varies by model. Generally competitive pricing. Free tier available with rate limits.

---

## 10. Mistral — Open Models

**Optional** (integrated but no models currently routed)

### Env var
```
MISTRAL_API_KEY=...
```

### How to get key
1. Go to https://console.mistral.ai
2. Sign up → **API Keys** → **Create new key**

### Cost
| Model | Input | Output |
|-------|-------|--------|
| Mistral Large | $2.00/M tokens | $6.00/M tokens |
| Mistral Small | $0.10/M tokens | $0.30/M tokens |

---

## 11. DeepSeek — Coding Models

**Optional** (configured but not in active routing slots)

### What Prometheus uses it for
`deepseek-coder` is registered in the model registry (Tier 2) but not assigned to any routing slot currently. Very cheap option for coding tasks.

### Env var
```
DEEPSEEK_API_KEY=...
```

### How to get key
1. Go to https://platform.deepseek.com
2. Sign up → **API Keys** → **Create new key**

### Cost
| Model | Input | Output |
|-------|-------|--------|
| DeepSeek Coder | $0.14/M tokens | $0.28/M tokens |

**Extremely cheap** — one of the most cost-effective coding models available.

---

## 12. Resend — Transactional Email

**Optional** (gracefully skipped if not configured)

### What Prometheus uses it for
- Task completion notifications
- Task failure alerts
- Low credits warnings
- Weekly usage summary emails
- Sends from: `PROMETHEUS <noreply@prometheus.dev>`

### Env var
```
RESEND_API_KEY=re_...
```

### How to get key
1. Go to https://resend.com
2. Sign up → **API Keys** → **Create API Key**
3. Add & verify your sending domain

### Cost
| Plan | Price | Emails/day |
|------|-------|-----------|
| Free | $0 | 100/day, 3,000/month |
| Pro | $20/mo | 50,000/month |

### Key files
- `apps/queue-worker/src/notifications.ts`

---

## 13. Sentry — Error Monitoring

**Optional** (not actively integrated in codebase)

### Env var
```
SENTRY_DSN=https://...@sentry.io/...
```

### How to get key
1. Go to https://sentry.io
2. Create project → select Node.js
3. Copy the DSN from the setup page

### Cost
| Plan | Price | Events/month |
|------|-------|-------------|
| Developer | $0 | 5,000 |
| Team | $26/mo | 50,000 |

---

## 14. ENCRYPTION_KEY — Self-Generated

**Required: YES**

### What Prometheus uses it for
Encrypts sensitive data stored in the database (integration credentials, API keys stored per-org).

### Env var
```
ENCRYPTION_KEY=<64-char hex string>
```

### How to generate
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Cost
Free — generated locally.

---

## Model Routing Architecture

Prometheus uses a **slot-based routing system** where each task type maps to a slot, and each slot has a primary model + fallbacks:

```
Task Type              → Slot         → Primary Model              → Fallbacks
─────────────────────────────────────────────────────────────────────────────────
General coding         → default      → Ollama qwen3-coder-next    → Cerebras → Groq
Deep reasoning         → think        → Ollama deepseek-r1:32b     → Ollama qwen3.5 → Claude Sonnet
Codebase analysis      → longContext  → Gemini 2.5 Flash (1M ctx)  → Claude Sonnet → Ollama
Background indexing    → background   → Ollama qwen2.5-coder:14b   → Ollama qwen3-coder
Screenshot/image       → vision       → Claude Sonnet              → Gemini Flash
Code review            → review       → Claude Sonnet              → Ollama deepseek-r1 → qwen3.5
Fast CI iterations     → fastLoop     → Cerebras qwen3-235b        → Groq llama-3.3 → Ollama
Complex/premium tasks  → premium      → Claude Opus                → Claude Sonnet → Ollama
```

**Cost strategy:** Free local models (Ollama) handle most work. Free cloud APIs (Groq, Cerebras, Gemini) serve as fast fallbacks. Paid APIs (Anthropic) are reserved for premium features (vision, review, complex tasks).

---

## Monthly Cost Estimate

| Component | Low Usage | Medium Usage | High Usage |
|-----------|-----------|-------------|------------|
| Ollama (local) | $0 | $0 | $0 |
| Groq | $0 (free tier) | $0 (free tier) | ~$5 |
| Cerebras | $0 (free tier) | $0 (free tier) | ~$5 |
| Gemini | $0 (free tier) | $0 (free tier) | ~$10 |
| Anthropic | ~$5 | ~$20 | ~$100+ |
| Clerk | $0 (dev) | $25 | $25+ |
| Stripe | 2.9%+30¢/tx | 2.9%+30¢/tx | 2.9%+30¢/tx |
| Resend | $0 | $0 | $20 |
| Server (94GB/18CPU) | Existing | Existing | Existing |
| **Total** | **~$5/mo** | **~$45/mo** | **~$165+/mo** |

*Costs scale with Anthropic usage. Most tasks route through free providers first.*
