# Skills Catalog

Skills referenced from ordiko-shop and their relevance to Prometheus.

## Installed / Relevant

| Skill | Description | Status |
|-------|-------------|--------|
| `ultracite` | Biome + Ultracite formatting/linting conventions | Already in use |
| `database-schema-design` | PostgreSQL schema design patterns (enums, relations, indexes) | Relevant |
| `clerk-nextjs-skills` | Clerk auth patterns (middleware, webhooks, user sync) | Relevant |
| `frontend-design` | Production-grade UI design with Tailwind + shadcn | Relevant |
| `neon-drizzle` | Drizzle ORM patterns (schema, queries, migrations) | Relevant (non-Neon PG) |
| `webapp-testing` | Playwright E2E + Vitest unit testing patterns | Relevant |
| `web-performance-optimization` | Core Web Vitals, lazy loading, caching strategies | Relevant |
| `zod` | Zod validation patterns (schemas, transforms, refinements) | Relevant |
| `access-control-rbac` | Role-based access control patterns | Relevant |
| `tailwind-v4-shadcn` | Tailwind CSS v4 + shadcn/ui component patterns | Relevant |

## Not Relevant to Prometheus

| Skill | Description | Reason |
|-------|-------------|--------|
| `neon-serverless` | Neon serverless driver patterns | Prometheus uses standard PostgreSQL |
| `payment-gateway-integration` | Payment gateway abstraction | Prometheus uses Stripe directly |
| `resend-integration-skills` | Resend email integration | MCP-specific, not needed |
| `seo-optimizer` | SEO optimization patterns | Platform app, not public-facing |
| `nextjs-seo` | Next.js SEO meta/sitemap | Platform app, not public-facing |
| `json-ld` | Structured data / JSON-LD | Not applicable |
| `motion` | Framer Motion animation patterns | Minimal animation in Prometheus |

## Installation

Skills are installed by symlinking from `.agents/skills/`:

```bash
# Example: install a skill from ordiko-shop
ln -s /path/to/skill-directory .claude/skills/skill-name
```

Or by creating skill files directly in `.claude/skills/` following the SKILL.md format with YAML frontmatter.
