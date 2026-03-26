# PROMETHEUS — Gap Analysis & Roadmap to 100x

> **Goal:** Build a professional AI engineering service like Devin that works 24/7, creates full projects from scratch to production, and is 100x better than Claude Code, Codex 5+, GPT 5+, Cursor, and Devin — combined.
>
> **Last updated:** 2026-03-26
> **Total gaps:** 110 (25 P0 / 25 P1 / 30 P2 / 30 P3)
> **Validated:** 13 P0 gaps confirmed working (services boot, LLM calls, sandbox, agent loop, E2E pipeline)

---

## Executive Summary

Prometheus has **extensive code** across 10 services, 29 packages, and 94 database tables (56 enums). The architecture is ambitious and unique — 12 specialist agents, 8-layer memory, multi-provider model routing, CRDT collaboration, MCP gateway.

**However, the honest truth:** Most features are **code that has never been run in production**. The previous gap analysis claimed "all 50 gaps implemented" — but writing code and shipping a working product are fundamentally different. No user has ever typed a prompt into Prometheus and received a working deployed application.

### Where We Actually Are

| Metric | Status |
|--------|--------|
| Services running together | **VALIDATED** — All 8 backend services boot, health checks pass, DB+Redis connected |
| End-to-end task completion | **VALIDATED** — User prompt → API → Queue → Orchestrator → Agent Loop → LLM → Sandbox → Result |
| Production LLM calls | **VALIDATED** — Anthropic Claude Sonnet via model router (streaming + non-streaming) |
| Sandbox code execution | **VALIDATED** — Docker containers create, write files, execute code, return output |
| Agent loop working | **VALIDATED** — Think→Plan→Act→Observe cycle completes, tool calls parsed and executed |
| Database schema | **VALIDATED** — 77 tables created, migrations work, seed data present |
| TypeScript compilation | **VALIDATED** — 39/39 packages pass pnpm typecheck |
| Test suite | **VALIDATED** — 175 orchestrator tests pass, 338 total test files |
| SWE-bench scores | Not published |
| Paying customers | Zero |
| Public demo | Does not exist |

### What Competitors Have That We Don't

| Competitor | Key Advantage We Lack |
|------------|----------------------|
| **Devin** | Proven 24/7 autonomous operation, Slack integration, real task completion |
| **Claude Code** | Battle-tested CLI, instant developer adoption, plan mode, hooks system |
| **Codex (OpenAI)** | Cloud sandboxes, parallel tasks, GitHub deep integration |
| **Cursor** | IDE-native experience, inline editing, instant autocomplete |
| **GPT 5+** | Massive context window, multimodal, reasoning chains |

---

## Priority Classification

| Priority | Meaning | Timeline |
|----------|---------|----------|
| **P0** | SHIP BLOCKER — Cannot launch without this | 0-30 days |
| **P1** | DEVIN PARITY — Must have to compete with Devin | 30-60 days |
| **P2** | 10x ADVANTAGE — Unique capabilities that differentiate | 60-120 days |
| **P3** | 100x MOONSHOT — Features that make us unbeatable | 120-365 days |

## Effort Scale

| Label | Duration | Example |
|-------|----------|---------|
| **S** | 1-3 days | Config change, UI fix, small integration |
| **M** | 1-2 weeks | Feature module, service integration |
| **L** | 2-4 weeks | Major subsystem, extensive testing |
| **XL** | 1-3 months | Architecture-level change, new service |

---

## Dependency Graph

```
P0 Ship Blockers:
  GAP-081 (TS Compile) ──→ GAP-001 (Services Boot) ──→ GAP-002 (E2E Pipeline) ──→ GAP-003 (Demo Instance)
                                    │
  GAP-004 (DB Migrations) ────────→│
  GAP-005 (Auth Flow) ────────────→│
  GAP-006 (LLM Integration) ──────→│
  GAP-007 (Sandbox Running) ──────→│
  GAP-008 (Streaming) ────────────→│
  GAP-083 (Docker Full Boot) ─────→│
  GAP-084 (.env Complete) ────────→│
  GAP-085 (Health Checks) ────────→│
                                    │
  GAP-009 (Prompt Eng) ──→ GAP-010 (Agent Loop) ──→ GAP-002
  GAP-011 (Error Recovery) ──→ GAP-002
  GAP-012 (Git Integration) ──→ GAP-002

P1 Devin Parity:
  GAP-002 ──→ GAP-021 (SWE-bench)
  GAP-002 ──→ GAP-022 (Slack Bot)
  GAP-002 ──→ GAP-023 (GitHub App)
  GAP-002 ──→ GAP-024 (Preview Deploy)
  GAP-002 ──→ GAP-025 (Project Scaffold)
  GAP-013 ──→ GAP-086 (Error Boundaries)
  GAP-001 ──→ GAP-087 (Rate Limiting)
  GAP-023 ──→ GAP-088 (Webhooks)
  GAP-036 ──→ GAP-089 (Search Working)
  GAP-008 ──→ GAP-090 (Session Resume)

P2 10x Advantage:
  GAP-010 ──→ GAP-041 (Multi-Agent Proven)
  GAP-010 ──→ GAP-042 (Memory System Proven)
  GAP-006 ──→ GAP-043 (Cost Optimization)
  GAP-036 ──→ GAP-091 (Fusion Search)
  GAP-049 ──→ GAP-092 (Digital Twin)
  GAP-042 ──→ GAP-093 (Meta-Learning)
  GAP-043 ──→ GAP-095 (Prompt Caching)
  GAP-006 ──→ GAP-100 (Langfuse)

P3 100x Moonshot:
  GAP-025 + GAP-024 ──→ GAP-061 (Full Project Gen)
  GAP-041 ──→ GAP-062 (Self-Improving Agents)
  GAP-076 ──→ GAP-101 (Cloud MCP Adapters)
  GAP-045 ──→ GAP-105 (Fine-Tuning Pipeline)
  GAP-003 ──→ GAP-107 (Load Testing)
  GAP-003 ──→ GAP-109 (Multi-Region)
```

---

## P0 — SHIP BLOCKERS (20 Gaps)

These must be resolved before ANY user can use the platform.

---

### GAP-001: All 9 Services Boot and Communicate

- **Current State:** Each service has an `index.ts` entry point. Docker compose defines PostgreSQL, pgBouncer, Dragonfly, LiteLLM, Ollama, MinIO, Qdrant, Zoekt. Individual services may start, but they have never been validated running together.
- **Files:** `apps/*/src/index.ts`, `docker-compose.yml`
- **What's Missing:**
  - Verified startup sequence for all 9 services
  - Service discovery / health check validation
  - Environment variable completeness check
  - Inter-service HTTP connectivity test
  - Redis pub/sub connectivity across services
  - BullMQ producer/consumer wiring verification
- **Effort:** M (1-2 weeks)
- **Dependencies:** Docker compose running, .env configured
- **Acceptance Criteria:**
  1. `docker compose up -d && pnpm dev` starts all 9 services without errors
  2. Health check endpoint returns 200 on all services
  3. API can call orchestrator, model-router, project-brain, mcp-gateway
  4. Queue worker processes a test job from API
  5. Socket server accepts WebSocket connection from web app
- **Competitor Reference:** Every competitor has this — it's table stakes

---

### GAP-002: End-to-End Task Execution Pipeline

- **Current State:** Orchestrator has `agent-loop.ts` (21KB), `task-router.ts` (47KB), `session-manager.ts`. Queue worker has `processor.ts`. API has tRPC routers. All exist as separate pieces.
- **Files:** `apps/orchestrator/src/agent-loop.ts`, `apps/orchestrator/src/task-router.ts`, `apps/queue-worker/src/processor.ts`, `apps/api/src/routers/tasks.ts`, `apps/api/src/routers/sessions.ts`
- **What's Missing:**
  - Verified flow: User prompt → API → Queue → Orchestrator → Agent Loop → Tool Execution → Result → User
  - Real LLM call producing real code output
  - File write to sandbox that persists
  - Result streamed back to web UI in real-time
  - Session state correctly tracked through entire lifecycle
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-001, GAP-006, GAP-007, GAP-009, GAP-010
- **Acceptance Criteria:**
  1. User types "Create a hello world Express server" in web UI
  2. Task appears in session with planning phase visible
  3. Agent generates code, writes files to sandbox
  4. Code runs successfully in sandbox
  5. Result with file tree and output shown to user
  6. Total time under 2 minutes for simple tasks
  7. Works reliably 9/10 times
- **Competitor Reference:** Devin (proven), Codex (cloud sandbox), Bolt.new (instant)

---

### GAP-003: Live Demo Instance

- **Current State:** No production or staging deployment exists. K8s manifests in `infra/k8s/`, Terraform in `infra/terraform/`, deployment scripts in `infra/scripts/`.
- **Files:** `infra/k8s/`, `infra/terraform/`, `infra/scripts/`, `infra/docker/`
- **What's Missing:**
  - Deployed instance accessible via HTTPS
  - DNS configuration
  - TLS certificates
  - Monitoring and alerting
  - Cost-effective infrastructure (not burning $1000/day on idle GPUs)
  - Demo account with sample projects
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-001, GAP-002
- **Acceptance Criteria:**
  1. `https://app.prometheus.dev` serves the web UI
  2. User can sign up, create project, submit task
  3. Agent executes task and returns result
  4. 99.9% uptime over 7 days
  5. Infrastructure cost under $500/month for demo tier
- **Competitor Reference:** Devin (devin.ai), Bolt.new (bolt.new), v0 (v0.dev)

---

### GAP-004: Database Migration Path

- **Current State:** Schema defined across 75+ table files in `packages/db/src/schema/tables/`. `pnpm db:push` exists for development. Migration files may or may not exist.
- **Files:** `packages/db/src/schema/`, `packages/db/src/migrate.ts`, `packages/db/drizzle/`
- **What's Missing:**
  - Verified migration from empty database to full schema
  - Migration ordering (foreign keys, dependencies)
  - Seed data for demo/testing
  - Migration rollback strategy
  - pgvector extension installation automation
  - Schema integrity validation
- **Effort:** M (1-2 weeks)
- **Dependencies:** PostgreSQL + pgvector running
- **Acceptance Criteria:**
  1. `pnpm db:migrate` on empty DB creates all tables without errors
  2. `pnpm db:seed` populates demo data (org, user, project, sample sessions)
  3. `pnpm db:check` validates schema integrity
  4. Migration is idempotent (running twice doesn't break)
- **Competitor Reference:** Internal infrastructure — all competitors have this solved

---

### GAP-005: Authentication Flow End-to-End

- **Current State:** Clerk integration in `packages/auth/`. Webhook handlers in `apps/api/src/routes/webhooks/clerk.ts`. Middleware in API. Next.js auth provider in web app.
- **Files:** `packages/auth/src/`, `apps/api/src/routes/webhooks/clerk.ts`, `apps/api/src/middleware/`, `apps/web/src/providers/`
- **What's Missing:**
  - Verified sign-up → onboarding → create org → create project → start session flow
  - Clerk webhook processing for user creation
  - API key creation and usage
  - Role-based access control enforcement across all routers
  - Session token refresh and expiry handling
- **Effort:** M (1-2 weeks)
- **Dependencies:** Clerk account configured, API running
- **Acceptance Criteria:**
  1. New user signs up via Clerk, appears in DB
  2. User creates organization, invites team member
  3. RBAC prevents viewer from creating tasks
  4. API key auth works for CLI/SDK access
  5. Session persists across page refreshes
- **Competitor Reference:** All competitors — table stakes

---

### GAP-006: Production LLM Integration

- **Current State:** Model router at `apps/model-router/src/` with 10 provider files, cascade logic, cost optimizer. AI package at `packages/ai/src/` with model registry of 50+ models.
- **Files:** `apps/model-router/src/index.ts`, `apps/model-router/src/cascade.ts`, `packages/ai/src/models/registry.ts`, `packages/ai/src/providers/`
- **What's Missing:**
  - Verified LLM API calls that return actual completions
  - Token counting and cost tracking in production
  - Rate limit handling across providers
  - Fallback chain actually working (Ollama → Groq → Anthropic)
  - Streaming response forwarding to orchestrator
  - Error handling for provider outages
  - API key rotation and management
- **Effort:** L (2-4 weeks)
- **Dependencies:** At least one LLM API key configured
- **Acceptance Criteria:**
  1. Model router receives request, routes to appropriate provider
  2. Response streams back token by token
  3. Cost tracked in model_usage table per request
  4. Fallback triggers when primary provider returns error
  5. Works with Ollama (free local), Groq (fast), Anthropic (quality)
  6. p95 latency under 500ms for routing decision
- **Competitor Reference:** All competitors — table stakes (but our multi-provider routing is unique)

---

### GAP-007: Sandbox Actually Running Code

- **Current State:** Sandbox manager at `apps/sandbox-manager/src/` with Docker, Firecracker, gVisor, E2B providers. Pool management, snapshot logic, network isolation code.
- **Files:** `apps/sandbox-manager/src/providers/docker.ts`, `apps/sandbox-manager/src/pool-manager.ts`, `apps/sandbox-manager/src/index.ts`
- **What's Missing:**
  - Verified Docker container creation and code execution
  - File system mount working (agent writes code, sandbox runs it)
  - Process timeout enforcement
  - Container cleanup after task completion
  - Warm pool actually pre-warming containers
  - Network isolation verified (no sandbox-to-sandbox access)
- **Effort:** M (1-2 weeks)
- **Dependencies:** Docker engine running
- **Acceptance Criteria:**
  1. `POST /sandbox/create` creates Docker container in under 2 seconds
  2. Agent writes `index.js` to sandbox, runs `node index.js`, gets output
  3. Container killed after 5-minute timeout
  4. Warm pool maintains 2 pre-warmed containers
  5. Sandbox cannot access host filesystem or other sandboxes
- **Competitor Reference:** Devin (proven), Codex (microVMs), Bolt.new (WebContainers)

---

### GAP-008: Real-Time Streaming to UI

- **Current State:** Socket server at `apps/socket-server/src/` with Socket.io, Redis adapter. SSE endpoint in API. Web app has socket provider and hooks.
- **Files:** `apps/socket-server/src/index.ts`, `apps/web/src/providers/`, `apps/web/src/hooks/`
- **What's Missing:**
  - Verified WebSocket connection from browser to socket server
  - Agent output tokens streaming to UI in real-time
  - Session events (started, thinking, coding, testing, done) reflected in UI
  - File change events showing diffs in real-time
  - Terminal output streaming from sandbox to browser
  - Reconnection handling on network interruption
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001, socket server running
- **Acceptance Criteria:**
  1. Browser connects to socket server, joins session room
  2. Agent output appears token-by-token in chat UI
  3. File tree updates as agent creates/modifies files
  4. Terminal output streams in real-time
  5. Connection survives 30-second network interruption
- **Competitor Reference:** Devin (real-time), Claude Code (streaming), Cursor (instant)

---

### GAP-009: Production-Tuned System Prompts

- **Current State:** Agent SDK at `packages/agent-sdk/src/` defines 13 roles. Role definitions likely have basic system prompts. No evidence of prompt optimization or evaluation.
- **Files:** `packages/agent-sdk/src/roles/`, `packages/agent-sdk/src/prompts/`
- **What's Missing:**
  - Optimized system prompts for each of 12 agent roles
  - Role-specific tool selection guidance
  - Output format specifications (structured vs freeform)
  - Few-shot examples for complex tasks
  - Prompt versioning system
  - A/B testing of prompt variants
  - Evaluation metrics per prompt version
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-006 (working LLM calls)
- **Acceptance Criteria:**
  1. Each agent role has a tuned system prompt (>500 words each)
  2. Prompts include tool usage examples
  3. Output follows consistent format (structured JSON for tool calls)
  4. Prompt versions tracked in DB or config
  5. Eval suite with 50+ test cases per role
  6. Backend agent produces working Express/Hono server from prompt
  7. Frontend agent produces working React components from prompt
- **Competitor Reference:** Devin (heavily optimized), Claude Code (battle-tested)

---

### GAP-010: Agent Loop Actually Working

- **Current State:** `apps/orchestrator/src/agent-loop.ts` (21KB) implements the core loop. Tool execution, decision making, context management code exists.
- **Files:** `apps/orchestrator/src/agent-loop.ts`, `apps/orchestrator/src/engine/`, `apps/orchestrator/src/context/`
- **What's Missing:**
  - Verified think → plan → act → observe cycle
  - Tool call parsing from LLM output
  - Tool execution with real sandbox/git/terminal
  - Observation feeding back into next iteration
  - Loop termination conditions (task complete, max iterations, error)
  - Token budget management within loop
  - Context window management (what to keep, what to summarize)
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-006, GAP-007, GAP-009
- **Acceptance Criteria:**
  1. Agent receives task "Create a REST API with /users endpoint"
  2. Agent plans approach (visible in session)
  3. Agent calls terminal tool to `npm init`, `npm install express`
  4. Agent calls file-write tool to create `server.js`
  5. Agent calls terminal tool to run and test the server
  6. Agent reports task complete with summary
  7. Loop completes in under 5 minutes for simple tasks
  8. Works across frontend, backend, and integration agent roles
- **Competitor Reference:** Devin (proven loop), Claude Code (CLI loop), Codex (sandbox loop)

---

### GAP-011: Error Recovery Under Real Conditions

- **Current State:** `apps/orchestrator/src/engine/recovery-strategy.ts`, `health-watchdog.ts`, checkpoint persistence. BullMQ retry config.
- **Files:** `apps/orchestrator/src/engine/recovery-strategy.ts`, `apps/orchestrator/src/engine/health-watchdog.ts`, `apps/orchestrator/src/checkpoint.ts`
- **What's Missing:**
  - Tested recovery from LLM API timeout/500/429
  - Tested recovery from sandbox crash mid-task
  - Tested recovery from Redis disconnect
  - Tested recovery from WebSocket drop
  - Checkpoint save/restore actually working
  - Graceful degradation (partial results instead of total failure)
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-002 (working pipeline to break)
- **Acceptance Criteria:**
  1. LLM returns 429 → agent retries with backoff, switches provider
  2. Sandbox crashes → checkpoint saved, new sandbox created, resume
  3. Redis drops → reconnect within 5s, no data loss
  4. Agent retries failing test up to 3 times with different approaches
  5. Recovery happens without user intervention
- **Competitor Reference:** Devin (self-healing), Codex (retry logic)

---

### GAP-012: Git Integration Working End-to-End

- **Current State:** Git tool in agent-sdk. GitHub adapter in MCP gateway. Webhook handlers for GitHub events.
- **Files:** `packages/agent-sdk/src/tools/git.ts`, `apps/mcp-gateway/src/adapters/github/`, `apps/api/src/routes/webhooks/github-app.ts`
- **What's Missing:**
  - Agent can clone a repo into sandbox
  - Agent creates branch, makes changes, commits
  - Agent pushes to remote and creates PR
  - PR has meaningful title, description, and linked issue
  - Diff is clean (no accidental files, proper .gitignore)
  - Conflict detection and resolution
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-007 (sandbox), GAP-010 (agent loop)
- **Acceptance Criteria:**
  1. Agent clones repo, creates feature branch
  2. Agent makes code changes, commits with conventional message
  3. Agent pushes and creates PR with summary
  4. PR passes CI checks
  5. Works with GitHub and GitLab
- **Competitor Reference:** Devin (PR creation), Claude Code (git workflow), Codex (PR automation)

---

### GAP-013: Web UI Actually Functional

- **Current State:** Next.js app at `apps/web/src/` with 22+ pages, 30+ component groups. Zustand stores, tRPC client, socket hooks.
- **Files:** `apps/web/src/app/`, `apps/web/src/components/`, `apps/web/src/stores/`, `apps/web/src/hooks/`
- **What's Missing:**
  - All pages rendering without errors
  - tRPC queries connecting to real API
  - Session page showing real-time agent activity
  - Project dashboard with real data
  - Settings pages saving to database
  - Navigation flow smooth and complete
  - Loading states and error boundaries
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-001, GAP-005
- **Acceptance Criteria:**
  1. All routes render without console errors
  2. Dashboard shows real projects and sessions
  3. Session page shows live agent activity
  4. Create project flow works end-to-end
  5. Settings save and persist
  6. Mobile responsive (tablet minimum)
- **Competitor Reference:** Devin (clean UI), Bolt.new (instant), v0 (polished)

---

### GAP-014: Billing Flow Working

- **Current State:** `packages/billing/src/` with Stripe integration, credit system, 6 tier definitions. tRPC billing router in API.
- **Files:** `packages/billing/src/stripe.ts`, `packages/billing/src/credits.ts`, `packages/billing/src/products.ts`, `apps/api/src/routers/billing.ts`
- **What's Missing:**
  - Stripe checkout session creation and completion
  - Credit deduction on task execution
  - Credit balance display in UI
  - Subscription upgrade/downgrade
  - Usage-based billing calculation
  - Invoice generation
  - Free tier rate limiting
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-005 (auth), Stripe account
- **Acceptance Criteria:**
  1. User subscribes to Pro plan via Stripe checkout
  2. Credits added to balance after payment
  3. Task execution deducts credits
  4. Balance displayed in dashboard
  5. Free tier limited to X tasks/day
- **Competitor Reference:** All competitors — table stakes

---

### GAP-015: Queue Worker Processing Real Jobs

- **Current State:** `apps/queue-worker/src/` with processor, scheduler, job definitions for 11 queue types.
- **Files:** `apps/queue-worker/src/index.ts`, `apps/queue-worker/src/processor.ts`, `apps/queue-worker/src/jobs/`
- **What's Missing:**
  - Queue worker actually consuming and processing agent tasks
  - Job retry and DLQ working
  - Scheduled job execution
  - Job progress tracking and reporting
  - Concurrency limits enforced per tier
  - Priority queue ordering
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001, Redis running
- **Acceptance Criteria:**
  1. API enqueues task, worker picks it up within 5 seconds
  2. Worker forwards task to orchestrator
  3. Failed job retried 3 times with backoff
  4. Dead letter queue captures permanently failed jobs
  5. Concurrent tasks limited per tier (free: 1, pro: 3, enterprise: 10)
- **Competitor Reference:** Internal infrastructure

---

### GAP-016: Monitoring and Observability

- **Current State:** `packages/telemetry/src/` with OpenTelemetry, Sentry, Prometheus client. Grafana dashboards in `infra/monitoring/`.
- **Files:** `packages/telemetry/src/`, `infra/monitoring/`, `infra/k8s/monitoring/`
- **What's Missing:**
  - Actual metrics being collected from running services
  - Grafana dashboards showing real data
  - Alert rules triggering on real conditions
  - Error tracking in Sentry with real stack traces
  - Request tracing across service boundaries
  - Log aggregation searchable
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001, GAP-003
- **Acceptance Criteria:**
  1. Prometheus scrapes metrics from all 9 services
  2. Grafana shows request rate, latency, error rate
  3. Alerts fire on >5% error rate
  4. Sentry captures unhandled exceptions
  5. Request trace spans across API → Queue → Orchestrator → Model Router
- **Competitor Reference:** Internal infrastructure — all mature products have this

---

### GAP-017: Integration Tests for Critical Paths

- **Current State:** ~338 test files, mostly unit tests. Test-utils package with helpers and mocks.
- **Files:** `packages/test-utils/src/`, `apps/*/src/**/*.test.ts`
- **What's Missing:**
  - Integration tests that start real services and test cross-service communication
  - API → Orchestrator task dispatch test
  - Queue → Worker → Orchestrator flow test
  - Socket server connection and event broadcast test
  - Full task lifecycle test (create → execute → complete)
  - Docker compose test environment
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-001
- **Acceptance Criteria:**
  1. `pnpm test:integration` starts required services, runs tests, stops services
  2. Tests cover all service-to-service communication paths
  3. Tests complete in under 5 minutes
  4. Run in CI on every PR
  5. Zero flaky tests
- **Competitor Reference:** Internal engineering — all shipping products have this

---

### GAP-018: Documentation for Self-Hosting

- **Current State:** ARCHITECTURE.md, TECHNOLOGIES.md exist. Docker compose for local dev. K8s manifests.
- **Files:** `docker-compose.yml`, `infra/`, `.env.example`
- **What's Missing:**
  - Step-by-step self-hosting guide (from bare server to running Prometheus)
  - Hardware requirements (CPU, RAM, disk per service)
  - Network topology diagram
  - SSL/TLS setup guide
  - Backup and restore procedures
  - Upgrade procedures
  - Troubleshooting guide
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-003 (validated deployment to document)
- **Acceptance Criteria:**
  1. New engineer can deploy Prometheus from docs alone
  2. Guide covers: single-server Docker, multi-server Docker, Kubernetes
  3. Estimated infrastructure costs per deployment size
  4. Backup/restore tested and documented
- **Competitor Reference:** Prometheus is unique here — no competitor offers self-hosting

---

### GAP-019: CLI Tool Working

- **Current State:** `packages/cli/src/` with Commander.js commands: task, chat, plan, fleet, review, search, init.
- **Files:** `packages/cli/src/commands/`, `packages/cli/src/index.ts`
- **What's Missing:**
  - CLI connecting to running API instance
  - `prometheus init` creating project config
  - `prometheus task "fix this bug"` submitting and streaming result
  - `prometheus chat` opening interactive session
  - Authentication (API key from env or config file)
  - Output formatting (colored, structured)
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001, GAP-002
- **Acceptance Criteria:**
  1. `npm install -g @prometheus/cli` installs globally
  2. `prometheus auth` authenticates with API key
  3. `prometheus task "Create a login page"` submits task and streams output
  4. `prometheus status` shows active sessions
  5. Output is colorized and readable in terminal
- **Competitor Reference:** Claude Code (excellent CLI), Codex (CLI-first)

---

### GAP-020: VS Code Extension Working

- **Current State:** `packages/vscode-extension/src/` with extension.ts, chat panel, git integration, status bar.
- **Files:** `packages/vscode-extension/src/extension.ts`, `packages/vscode-extension/src/chat/`, `packages/vscode-extension/src/views/`
- **What's Missing:**
  - Extension builds and installs in VS Code
  - Chat panel connects to API
  - Task submission from editor context
  - Code actions (fix, explain, refactor) working
  - Status bar showing session state
  - File decoration for agent-modified files
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001, GAP-002
- **Acceptance Criteria:**
  1. Extension installs from VSIX or marketplace
  2. Chat panel opens and connects to Prometheus API
  3. Right-click → "Ask Prometheus" sends selected code
  4. Agent response appears in chat with code blocks
  5. "Apply" button applies suggested changes to file
- **Competitor Reference:** Copilot (gold standard), Cursor (IDE-native), Windsurf (IDE-native)

---

### GAP-081: TypeScript Compilation Across All Packages

- **Current State:** Root uses TypeScript ^6.0.2, web app uses ^5.9.3. Mixed versions may cause type incompatibilities across packages.
- **Files:** `package.json` (root), `apps/web/package.json`, all `packages/*/tsconfig.json`
- **What's Missing:** Verified `pnpm typecheck` passes across all 10 apps and 29 packages simultaneously, with consistent type resolution between TS 5.9 and 6.0
- **Effort:** S (1-3 days)
- **Dependencies:** None
- **Acceptance Criteria:** `pnpm typecheck` exits 0 across entire monorepo

---

### GAP-082: Docs App Builds and Serves

- **Current State:** `apps/docs/` exists with Next.js config and content directory. Never verified to build or serve.
- **Files:** `apps/docs/package.json`, `apps/docs/next.config.ts`, `apps/docs/content/`
- **What's Missing:** Docs app builds successfully, serves documentation content, has navigation and search
- **Effort:** M (1-2 weeks)
- **Dependencies:** None
- **Acceptance Criteria:** `pnpm --filter docs build` succeeds; docs accessible at configured port

---

### GAP-083: Docker Compose Full Stack Boot

- **Current State:** Docker compose defines 8 services (postgres, pgbouncer, dragonfly, litellm, ollama, minio, mem0/qdrant, zoekt) with 3 profiles (core, ai, full). Never validated all 8 + all 10 app services running together.
- **Files:** `docker-compose.yml`, `.env.example`
- **What's Missing:** All 8 infra services + all 10 app services boot together without port conflicts, memory issues, or missing env vars
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001
- **Acceptance Criteria:** `docker compose --profile full up -d && pnpm dev` starts entire platform

---

### GAP-084: .env.example Completeness

- **Current State:** `.env.example` exists but may not cover all required vars for all 10 services (API keys, database URLs, ports, feature flags).
- **Files:** `.env.example`, all `apps/*/src/index.ts` (env var usage)
- **What's Missing:** Every env var referenced in code has a corresponding entry in .env.example with documentation
- **Effort:** S (1-3 days)
- **Dependencies:** None
- **Acceptance Criteria:** Copy `.env.example` to `.env`, fill in API keys, all services start without "missing env var" errors

---

### GAP-085: Health Check Endpoints on All Services

- **Current State:** Some services have `/health` endpoints. Not verified across all 9 HTTP services.
- **Files:** `apps/*/src/index.ts`
- **What's Missing:** All 9 HTTP services expose `/health` returning 200 with service metadata (version, uptime, dependencies)
- **Effort:** S (1-3 days)
- **Dependencies:** GAP-001
- **Acceptance Criteria:** `curl localhost:{port}/health` returns 200 for all 9 services

---

## P1 — DEVIN PARITY (25 Gaps)

These are required to match Devin's core feature set and compete in the market.

---

### GAP-021: SWE-bench Benchmark Results

- **Current State:** SWE-bench runner code exists in codebase. Competitive benchmark configuration files present. Agent SDK with tool execution framework. No results ever recorded.
- **Files:** `apps/orchestrator/src/evaluation/`, `packages/agent-sdk/src/tools/`
- **What's Missing:**
  - Run SWE-bench Lite (300 instances) end-to-end with our agent
  - Record results in structured format (JSON/CSV)
  - Set up weekly CI job to track scores over time
  - Create regression detection (alert if score drops >5%)
  - Run HumanEval benchmark as secondary metric
  - Publish results on website/README
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-002 (working pipeline), GAP-007 (sandbox), GAP-009 (tuned prompts)
- **Acceptance Criteria:**
  1. SWE-bench Lite run completed with recorded results
  2. Results competitive (target: within 10% of Devin's published score)
  3. HumanEval run completed
  4. Weekly CI runs with historical tracking
  5. Regression alert triggers on >5% drop
- **Competitor Reference:** Devin ~14%, Claude Code ~49%, Codex ~69% (SWE-bench Verified)

---

### GAP-022: Slack Bot Integration

- **Current State:** Slack adapter in `apps/mcp-gateway/src/adapters/slack/`. Webhook handler in `apps/api/src/routes/webhooks/slack.ts`. Bot command stubs exist.
- **Files:** `apps/mcp-gateway/src/adapters/slack/`, `apps/api/src/routes/webhooks/slack.ts`
- **What's Missing:**
  - Deployed Slack app (manifest, OAuth, bot token)
  - `/prometheus <task>` slash command that creates a task
  - Progress updates posted to thread as agent works
  - File attachments (diffs, screenshots) in thread
  - "Approve" / "Reject" buttons for destructive actions
  - PR link posted when agent completes
  - Error messages with retry button
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-002, Slack app credentials, GAP-039 (notifications)
- **Acceptance Criteria:**
  1. `/prometheus build a landing page` in Slack creates task
  2. Thread updates every 30s with agent progress
  3. Screenshot of generated page posted to thread
  4. PR link posted when complete
  5. Error posted with "Retry" button if task fails
- **Competitor Reference:** Devin (production Slack bot with rich interactions, thread updates, approve/reject)

---

### GAP-023: GitHub App Integration

- **Current State:** GitHub webhook handlers in `apps/api/src/routes/webhooks/github-app.ts`. GitHub MCP adapter in `apps/mcp-gateway/src/adapters/github/`. Git tool in `packages/agent-sdk/src/tools/git.ts`.
- **Files:** `apps/api/src/routes/webhooks/github-app.ts`, `apps/mcp-gateway/src/adapters/github/`
- **What's Missing:**
  - Published GitHub App (manifest.yml, permissions, events)
  - Issue-to-task automation: label issue with "prometheus" → agent picks it up
  - PR creation with meaningful description, linked issue
  - PR review bot: comment inline on PRs with suggestions
  - Status checks: report agent progress as GitHub check
  - Auto-assign agent to issues matching criteria
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-002, GAP-012 (git integration)
- **Acceptance Criteria:**
  1. GitHub App installable from marketplace
  2. Issue labeled "prometheus" → agent starts working → PR created
  3. PR has description linking back to issue
  4. Agent posts inline review comments on other PRs
  5. GitHub check shows "Prometheus: Task Complete"
- **Competitor Reference:** Devin (GitHub deep integration), Copilot (native GitHub, status checks)

---

### GAP-024: Preview Deployments

- **Current State:** Vercel adapter in `apps/mcp-gateway/src/adapters/vercel/`. Netlify adapter exists. Deploy engineer agent role. Preview deployment queue in `packages/queue/`.
- **Files:** `apps/mcp-gateway/src/adapters/vercel/`, `apps/mcp-gateway/src/adapters/netlify/`, `apps/orchestrator/src/deployment/`
- **What's Missing:**
  - Agent pushes code to repo, triggers Vercel/Netlify deployment
  - Deployment URL captured and shared with user
  - Smoke test against deployed URL (health check, screenshot)
  - Deployment status tracked in database
  - Rollback if smoke test fails
  - Support for at least Vercel, Netlify, and Docker
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-002, GAP-012, Vercel/Netlify account with API tokens
- **Acceptance Criteria:**
  1. Agent generates Next.js app → pushes to GitHub → Vercel deploys
  2. Deployment URL (e.g., `my-app-abc.vercel.app`) returned to user
  3. Agent visits URL, takes screenshot, verifies it loads
  4. Deployment record created in database
  5. If 500 error on deployed URL → agent auto-investigates
- **Competitor Reference:** Bolt.new (instant), v0 (Vercel native), Lovable (instant), Replit (instant)

---

### GAP-025: Project Scaffolding from Scratch

- **Current State:** Blueprint system in orchestrator. Config-stacks package (`packages/config-stacks/`) with templates for ecommerce, mobile, saas, data-pipeline. Template gallery UI component.
- **Files:** `packages/config-stacks/src/templates/`, `apps/orchestrator/src/planning/`, `apps/web/src/components/templates/`
- **What's Missing:**
  - Agent creates complete project from natural language description
  - Correct dependency installation (npm/pnpm/yarn)
  - Build tool configuration (tsconfig, eslint/biome, tailwind)
  - Directory structure following conventions
  - README generation with setup instructions
  - .env.example with required variables
  - Docker Compose for local development
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-010 (agent loop), GAP-007 (sandbox), GAP-009 (prompts)
- **Acceptance Criteria:**
  1. "Build a SaaS dashboard with auth and Stripe" → complete Next.js project
  2. `npm install && npm run dev` works first try
  3. Project has proper structure (src/, components/, lib/, etc.)
  4. Dependencies are correct versions (no conflicts)
  5. At least 5 different project types scaffold correctly
- **Competitor Reference:** Bolt.new (instant scaffold), Lovable (instant), Replit (instant)

---

### GAP-026: Autonomous Debugging

- **Current State:** Agent loop has error observation capability. Test engineer agent role exists. CI/loop engineer role does write-test-fail-analyze-fix cycles.
- **Files:** `packages/agent-sdk/src/roles/index.ts` (ci_loop role), `apps/orchestrator/src/agent-loop.ts`
- **What's Missing:**
  - Agent reads error message, identifies root cause, generates fix
  - Multi-attempt debugging: try fix → test → if fail → try different fix
  - Stack trace analysis (extract file, line, error type)
  - Dependency error diagnosis (wrong version, missing package)
  - Build error diagnosis (TypeScript, webpack, etc.)
  - Runtime error diagnosis (null reference, type error, etc.)
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-010 (agent loop working), GAP-009 (prompts tuned)
- **Acceptance Criteria:**
  1. Agent fixes TypeScript type error (given failing `tsc` output)
  2. Agent fixes runtime null reference (given stack trace)
  3. Agent fixes missing dependency (given `MODULE_NOT_FOUND`)
  4. Agent iterates up to 5 times if first fix doesn't work
  5. Success rate >70% on common error categories
- **Competitor Reference:** Devin (autonomous debugging proven), Claude Code (error loop), Cursor (inline fix)

---

### GAP-027: Multi-File Coordinated Coding

- **Current State:** Agent tools support file read/write/search. No proven multi-file coordination.
- **Files:** `packages/agent-sdk/src/tools/file.ts`, `packages/agent-sdk/src/tools/terminal.ts`
- **What's Missing:**
  - Agent creates/modifies multiple related files in one task
  - Cross-file consistency (imports match exports, types align)
  - Architecture-aware: knows where to put new files
  - Handles 5+ file changes in a single coherent task
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-010, GAP-009
- **Acceptance Criteria:**
  1. "Add a user profile feature" → creates: model, API route, UI component, test, migration (5 files)
  2. All imports resolve correctly
  3. Types are consistent across files
  4. Tests reference correct module paths
  5. Works for features spanning frontend + backend + database
- **Competitor Reference:** Devin (proven), Claude Code (proven), Cursor (proven), Windsurf (proven)

---

### GAP-028: Test Generation and Execution

- **Current State:** Test engineer agent role defined. Test generator and E2E generator tools in `packages/agent-sdk/src/tools/`.
- **Files:** `packages/agent-sdk/src/tools/test-generator.ts`, `packages/agent-sdk/src/tools/e2e-test-generator.ts`
- **What's Missing:**
  - Agent generates meaningful unit tests (not trivial/redundant)
  - Tests actually run in sandbox and pass
  - Agent iterates if tests fail (fix test or fix code)
  - Coverage measurement (target >80%)
  - E2E tests with Playwright for UI features
  - Test framework auto-detection (Jest, Vitest, pytest)
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-010, GAP-007
- **Acceptance Criteria:**
  1. Agent generates 10+ tests for a given module
  2. Tests run in sandbox (`npm test`) and pass
  3. Coverage exceeds 80% for the module
  4. Tests cover edge cases (null, empty, error)
  5. E2E test opens browser and verifies UI
- **Competitor Reference:** Codex (test generation), Claude Code (test writing)

---

### GAP-029: Dependency Management

- **Current State:** Terminal tool can run npm/pnpm commands in sandbox. No specialized dependency logic.
- **What's Missing:** Agent installs correct packages, resolves version conflicts, updates lock files, handles peer dependencies
- **Effort:** S (1-3 days)
- **Dependencies:** GAP-010, GAP-007
- **Acceptance Criteria:** Agent adds React Query to existing project without breaking build, lock file updated correctly
- **Competitor Reference:** All coding agents handle this — table stakes

---

### GAP-030: Task Progress and Status Tracking

- **Current State:** Session events table in DB. Socket server with session namespace. Event publishing in orchestrator.
- **Files:** `packages/db/src/schema/tables/sessions.ts`, `apps/socket-server/src/`, `apps/orchestrator/src/session-manager.ts`
- **What's Missing:**
  - Clear phase indicators in UI (planning → coding → testing → deploying → done)
  - Progress percentage estimation
  - Step-by-step execution log visible in session
  - Estimated time remaining
  - File tree showing created/modified files in real-time
  - Terminal output from sandbox commands
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-008 (streaming), GAP-013 (UI)
- **Acceptance Criteria:**
  1. UI shows: "Planning (2/5 steps)" → "Coding (creating 4 files)" → "Testing (3/3 pass)" → "Complete"
  2. File tree updates in real-time as files are created
  3. Terminal output scrolls as commands execute
  4. Time elapsed and estimated remaining shown
- **Competitor Reference:** Devin (step-by-step execution view), Bolt.new (live preview)

---

### GAP-031: Session Pause, Resume, and Cancel

- **Current State:** Session manager has pause/resume/cancel methods. Checkpoint persistence exists.
- **What's Missing:** User can pause mid-task, resume later, cancel with cleanup
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-002
- **Acceptance Criteria:** Pause → agent saves state → resume → agent continues from checkpoint → same result as uninterrupted
- **Competitor Reference:** Devin (session persistence), Codex (task management)

---

### GAP-032: Human-in-the-Loop Approval

- **Current State:** Approval engine in orchestrator. Destructive action detection.
- **What's Missing:** Agent pauses for user approval before destructive actions (delete, force push, deploy to prod), user approves/denies in UI
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-008 (streaming), GAP-013 (UI)
- **Acceptance Criteria:** Agent wants to `rm -rf` → pauses → user sees approval prompt → approves → agent continues
- **Competitor Reference:** Devin (approval flow), Claude Code (permission system)

---

### GAP-033: Multi-Language Support (Python, Go, Rust)

- **Current State:** System focused on TypeScript/JavaScript. Sandbox images can support any language.
- **What's Missing:** Prompts tuned for Python/Go/Rust, correct tooling per language, test framework knowledge per language
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-009, GAP-010
- **Acceptance Criteria:** Agent successfully completes tasks in Python, Go, and Rust (not just TypeScript)
- **Competitor Reference:** Devin (multi-language), Claude Code (any language), Cursor (any language)

---

### GAP-034: Browser Automation for Verification

- **Current State:** Browser tool with Playwright integration. Screenshot tool.
- **What's Missing:** Agent opens generated web app in browser, takes screenshot, verifies visual correctness, interacts with UI
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-007 (sandbox with browser), GAP-010
- **Acceptance Criteria:** Agent builds UI → opens in Playwright → takes screenshot → verifies layout is correct → fixes issues
- **Competitor Reference:** Devin (browser automation), Bolt.new (live preview)

---

### GAP-035: Code Review Quality

- **Current State:** Code reviewer agent role. Code review table in DB.
- **What's Missing:** Agent reviews PR with meaningful inline comments, severity levels, suggested fixes, respects codebase conventions
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-012 (git), GAP-009 (prompts)
- **Acceptance Criteria:** Agent reviews PR → leaves 5+ meaningful comments → catches real issues → suggestions are correct
- **Competitor Reference:** Copilot (PR reviews), Codex (code review)

---

### GAP-036: Project Brain Context Quality

- **Current State:** Project brain with 8 memory layers, embeddings, knowledge graph, semantic search.
- **What's Missing:** Verified context retrieval improving agent quality, knowledge graph actually populated, semantic search returning relevant results
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-006 (embeddings), GAP-004 (DB)
- **Acceptance Criteria:** Agent working on file X receives relevant context from files Y, Z automatically, improving code quality
- **Competitor Reference:** Cursor (codebase-aware), Windsurf (flows)

---

### GAP-037: Onboarding Experience

- **Current State:** Onboarding page exists in web app. Create project flow exists.
- **What's Missing:** Guided first-run experience, connect GitHub, first task wizard, success celebration
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-005, GAP-013
- **Acceptance Criteria:** New user signs up → guided through GitHub connection → first task → sees result → "wow" moment in under 5 minutes
- **Competitor Reference:** Devin (smooth onboarding), Bolt.new (instant start)

---

### GAP-038: Pricing Page and Checkout

- **Current State:** Pricing page component exists. Stripe integration. Product tiers defined.
- **What's Missing:** Live pricing page with plan comparison, checkout flow, plan upgrade/downgrade, invoice history
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-014 (billing)
- **Acceptance Criteria:** User visits /pricing → selects plan → pays → credits available immediately
- **Competitor Reference:** All competitors — table stakes

---

### GAP-039: Notification System

- **Current State:** `packages/notifications/` with email (Resend), Slack, push notification code.
- **What's Missing:** Working email notifications for task completion, Slack DM on completion, in-app notification bell, notification preferences
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-002
- **Acceptance Criteria:** Task completes → user gets email + Slack DM + in-app notification
- **Competitor Reference:** Devin (Slack notifications), Codex (email notifications)

---

### GAP-040: Analytics Dashboard

- **Current State:** Analytics tRPC routers (analytics, analytics-enhanced, cost-analytics, cost-prediction).
- **What's Missing:** Dashboard showing real data: tasks completed, time saved, cost per task, agent performance
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-013, GAP-002 (real data)
- **Acceptance Criteria:** Dashboard shows last 30 days: tasks completed, avg time, cost, success rate, comparison to manual coding
- **Competitor Reference:** Devin (usage analytics)

---

### GAP-086: Error Boundary UX in Web App

- **Current State:** Next.js web app may lack proper `error.tsx` and `not-found.tsx` at key route segments.
- **Files:** `apps/web/src/app/error.tsx`, `apps/web/src/app/not-found.tsx`, route segment error boundaries
- **What's Missing:** Graceful error recovery in all major routes, user-friendly error messages, retry buttons, fallback UI
- **Effort:** S (1-3 days)
- **Dependencies:** GAP-013
- **Acceptance Criteria:** Unhandled errors show friendly error page with retry option, not white screen

---

### GAP-087: API Rate Limiting Per Org Enforced

- **Current State:** Rate limit middleware exists (`apps/api/src/middleware/rate-limit.ts`, `rate-limit-enhanced.ts`). Not verified with real traffic.
- **Files:** `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/middleware/rate-limit-enhanced.ts`
- **What's Missing:** Per-org rate limits enforced and tested (free: 5 tasks/day, pro: 200/day), 429 responses with retry-after headers
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001, Dragonfly running
- **Acceptance Criteria:** Free tier user hits rate limit after 5 tasks, receives 429 with retry-after header

---

### GAP-088: Webhook Inbound Processing Verified

- **Current State:** Webhook handlers exist for GitHub (`apps/api/src/routes/webhooks/github-app.ts`), Slack, Clerk.
- **Files:** `apps/api/src/routes/webhooks/`
- **What's Missing:** Verified webhook signature validation, event processing, and task creation from GitHub/Slack events
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001, GAP-023
- **Acceptance Criteria:** GitHub push event → webhook received → task created; Slack mention → task created

---

### GAP-089: Search Infrastructure Working

- **Current State:** Zoekt in docker-compose (port 6070). Code search tool in agent-sdk. Semantic search in project-brain.
- **Files:** `docker-compose.yml` (zoekt service), `apps/project-brain/src/layers/semantic.ts`
- **What's Missing:** Zoekt indexing a real repo and returning search results, semantic search returning relevant code snippets
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-001, GAP-036
- **Acceptance Criteria:** Agent searches "authentication middleware" → returns relevant files from indexed codebase

---

### GAP-090: Session Resume Across Browser Refreshes

- **Current State:** Session persistence module exists in project-brain. Checkpoint system in orchestrator.
- **Files:** `apps/project-brain/src/resume/session-resume.ts`, `apps/orchestrator/src/checkpoint.ts`
- **What's Missing:** User refreshes browser during active session → reconnects to same session → sees full history and live updates
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-008, GAP-013
- **Acceptance Criteria:** Refresh browser during active task → session state preserved → real-time updates resume

---

## P2 — 10x ADVANTAGE (30 Gaps)

These are unique capabilities that differentiate Prometheus from every competitor.

---

### GAP-041: Multi-Agent Orchestration Proven

- **Current State:** 12 agent roles defined, task router (47KB), fleet coordination, swarm patterns, MoA voting.
- **What's Missing:** Proven that multiple agents working together produce better results than single agent
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-010 (single agent working first)
- **Acceptance Criteria:** Complex task → architect + frontend + backend + test agents collaborate → result is better than single agent (measured by benchmark)
- **Competitor Reference:** No competitor has this — unique to Prometheus

---

### GAP-042: 8-Layer Memory System Proven

- **Current State:** Project brain with semantic, knowledge graph, episodic, procedural, working, conversational, session, domain layers.
- **What's Missing:** Proven that memory improves agent quality over time, cross-session learning actually works
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-036 (brain context), real usage data
- **Acceptance Criteria:** Agent on 10th task in a project performs measurably better than 1st task (uses learned conventions, knows codebase)
- **Competitor Reference:** Devin (session memory), Cursor (memory)

---

### GAP-043: Intelligent Cost Optimization Proven

- **Current State:** Model cascade, cost optimizer, A/B testing, request coalescing, speculative execution.
- **What's Missing:** Proven that routing saves money vs always using the best model, quality/cost tradeoff measured
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-006 (LLM working)
- **Acceptance Criteria:** Same task quality at 60% lower cost vs always using Claude Opus, with data to prove it
- **Competitor Reference:** No competitor offers transparent cost optimization — unique to Prometheus

---

### GAP-044: Convention Learning and Enforcement

- **Current State:** Convention learner, convention enforcer in project brain. Conventions table in DB.
- **What's Missing:** Agent automatically detects project conventions (naming, architecture, patterns) and follows them
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-036, GAP-042
- **Acceptance Criteria:** Agent indexes codebase → detects "we use camelCase, Zustand for state, Hono for API" → follows these conventions in generated code
- **Competitor Reference:** Cursor (codebase context), but Prometheus's approach is deeper

---

### GAP-045: Self-Play Training Loop

- **Current State:** `self-play-trainer.ts`, `pattern-miner.ts`, `learning-extractor.ts` in orchestrator.
- **What's Missing:** Agents training themselves by generating and solving tasks, extracting patterns, improving prompts
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-010, GAP-021 (benchmarks for measurement)
- **Acceptance Criteria:** Run self-play for 1 week → SWE-bench score improves by 5%+
- **Competitor Reference:** No competitor has this — unique to Prometheus

---

### GAP-046: MoA Voting System Working

- **Current State:** `moa/parallel-generator.ts` in orchestrator.
- **What's Missing:** Multiple agents propose solutions, vote on best, produce higher-quality output
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-041
- **Acceptance Criteria:** 3 agents propose solutions → voting selects best → result is measurably better than any single proposal
- **Competitor Reference:** No competitor has this

---

### GAP-047: MCTS Planning Working

- **Current State:** MCTS planner in orchestrator engine.
- **What's Missing:** Monte Carlo Tree Search exploring solution strategies and selecting optimal path
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-010
- **Acceptance Criteria:** Complex task → MCTS explores 10+ approaches → selects best → result is better than greedy approach
- **Competitor Reference:** No competitor uses MCTS for coding tasks

---

### GAP-048: CRDT Collaborative Editing Working

- **Current State:** `packages/collaboration/` with Yjs provider, cursor presence.
- **What's Missing:** Human and AI editing same file simultaneously with conflict-free merging
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-008, GAP-013
- **Acceptance Criteria:** Human edits line 10 while AI edits line 50 → both changes merge correctly → no conflicts
- **Competitor Reference:** No competitor has this

---

### GAP-049: Knowledge Graph Population and Query

- **Current State:** Knowledge graph module in project brain. Graph table in DB.
- **What's Missing:** Automatic extraction of entities (classes, functions, APIs) and relationships, graph queries informing agent decisions
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-036
- **Acceptance Criteria:** Codebase indexed → "What uses the User model?" → returns all controllers, services, tests that reference it
- **Competitor Reference:** Sourcegraph (code graph), but Prometheus integrates it into agent decisions

---

### GAP-050: Plugin Marketplace Working

- **Current State:** `packages/plugins/` with plugin-sdk, marketplace-client, registry. Plugin UI in web app.
- **What's Missing:** Actual plugins published and installable, community submission process, review/approval
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-013, GAP-002
- **Acceptance Criteria:** User browses marketplace → installs "Terraform" plugin → agent gets Terraform tools
- **Competitor Reference:** Copilot (marketplace), Claude Code (MCP tools)

---

### GAP-051: Skill Packs for Domains

- **Current State:** Config-stacks with ecommerce, mobile, data-pipeline, SaaS templates.
- **What's Missing:** Domain-specific agent training (e-commerce agents know Stripe, mobile agents know React Native patterns)
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-009, GAP-050
- **Acceptance Criteria:** "Build e-commerce checkout" → agent uses Stripe best practices, cart patterns, inventory management
- **Competitor Reference:** No competitor has domain-specific agent training

---

### GAP-052: Air-Gapped Deployment with Local Models

- **Current State:** Ollama integration in model router. Docker compose with Ollama. K8s manifests.
- **What's Missing:** Verified deployment with zero internet, using only Ollama models, full functionality preserved
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-003
- **Acceptance Criteria:** Deploy on isolated network → all features work → code quality acceptable with local models
- **Competitor Reference:** No competitor offers this — unique selling point for defense/healthcare/finance

---

### GAP-053: Sprint Planning and Project Management

- **Current State:** Sprint tables in DB, PM tRPC router, planner agent role.
- **What's Missing:** Agent breaks large project into sprints, estimates effort, creates Jira/Linear issues, tracks progress
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-010, integrations
- **Acceptance Criteria:** "Build a CRM" → agent creates sprint plan with 20 tasks, estimates each, creates Linear issues
- **Competitor Reference:** Devin (task decomposition), but Prometheus's PM features are deeper

---

### GAP-054: Architecture Analysis and Visualization

- **Current State:** `packages/architecture-graph/`, architecture tRPC router.
- **What's Missing:** Visual architecture diagram generation from codebase, dependency analysis, impact analysis for changes
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-036
- **Acceptance Criteria:** Agent analyzes codebase → generates architecture diagram → identifies high-coupling areas
- **Competitor Reference:** No competitor auto-generates architecture diagrams

---

### GAP-055: BYO API Keys for LLM Providers

- **Current State:** `byo-model.ts`, `byo-model-store.ts`, `byo-model-validator.ts` in model router.
- **What's Missing:** Users bring their own API keys for Anthropic/OpenAI/etc., keys stored securely, used for their tasks
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-006
- **Acceptance Criteria:** User enters Anthropic API key → their tasks use Claude directly → no Prometheus markup
- **Competitor Reference:** Cursor (BYO keys), Windsurf (BYO keys)

---

### GAP-056: Prompt Versioning and Evaluation

- **Current State:** Prompt versioning mentioned in MISSING.md as implemented. Eval test cases mentioned.
- **What's Missing:** UI for managing prompt versions, A/B testing between versions, automatic rollback on quality drop
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-009, GAP-021
- **Acceptance Criteria:** Create prompt variant → A/B test → variant with higher SWE-bench score auto-promoted
- **Competitor Reference:** Internal tooling — sophisticated teams have this

---

### GAP-057: CI/CD Pipeline Generation

- **Current State:** CI integration package, CI/loop engineer agent role.
- **What's Missing:** Agent generates GitHub Actions workflow for generated project, includes test, lint, deploy steps
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-012, GAP-025
- **Acceptance Criteria:** Agent generates project → includes `.github/workflows/ci.yml` → CI passes on first push
- **Competitor Reference:** Devin (CI setup), Copilot (Actions generation)

---

### GAP-058: Visual Regression Testing

- **Current State:** Screenshot diffing in orchestrator. Visual verifier.
- **What's Missing:** Automated visual comparison of UI before/after changes, pixel-diff highlighting
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-034
- **Acceptance Criteria:** Agent changes CSS → takes before/after screenshots → identifies unintended visual changes
- **Competitor Reference:** Percy, Chromatic (dedicated tools)

---

### GAP-059: Docker/K8s Manifest Generation

- **Current State:** IaC generator tool in agent-sdk.
- **What's Missing:** Agent generates production-ready Dockerfile and K8s manifests for generated projects
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-025
- **Acceptance Criteria:** Generated project includes optimized Dockerfile, K8s deployment + service + ingress YAML
- **Competitor Reference:** No coding agent does this well — differentiator

---

### GAP-060: Canary Deployment and Rollback

- **Current State:** Canary/rollback scripts in infra. Deploy engineer agent.
- **What's Missing:** Agent deploys with canary strategy, monitors error rates, auto-rollback if errors spike
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-024, GAP-016
- **Acceptance Criteria:** Deploy canary → monitor → errors > threshold → auto-rollback → alert user
- **Competitor Reference:** No competitor offers this — enterprise differentiator

---

### GAP-091: Fusion Search Pipeline (BM25 + Semantic + RRF)

- **Current State:** `apps/project-brain/src/search/fusion-search.ts`, `search/semantic-reranker.ts` exist.
- **What's Missing:** Verified that fusion search (BM25 + semantic + RRF reranking) returns better results than either alone
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-036, GAP-089
- **Acceptance Criteria:** Fusion search measurably improves agent context quality vs single-method search

---

### GAP-092: Digital Twin Populated and Accurate

- **Current State:** `apps/project-brain/src/digital-twin.ts` exists.
- **What's Missing:** Digital twin accurately reflects codebase state — files, dependencies, architecture, conventions — and stays in sync
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-036, GAP-049
- **Acceptance Criteria:** Digital twin represents >90% of codebase structure accurately, updates within 60s of file changes

---

### GAP-093: Meta-Learning Extracting Patterns

- **Current State:** `apps/project-brain/src/meta-learning/` directory exists.
- **What's Missing:** Meta-learning system extracts useful patterns from completed sessions, improving agent behavior
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-042, real session data
- **Acceptance Criteria:** After 100 sessions, meta-learning identifies 10+ reusable patterns that improve task completion

---

### GAP-094: Trust Scoring for Agent Reliability

- **Current State:** `apps/orchestrator/src/governance/trust-scorer.ts` exists.
- **What's Missing:** Trust scores computed per agent based on history, used to gate autonomous actions
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-010, real session data
- **Acceptance Criteria:** Low-trust agent requires human approval for destructive actions; high-trust agent proceeds autonomously

---

### GAP-095: Prompt Caching Reducing Costs

- **Current State:** `apps/model-router/src/prompt-cache.ts` exists.
- **What's Missing:** Prompt cache hit rate measured and demonstrably reducing LLM API costs
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-006, GAP-043
- **Acceptance Criteria:** >20% cache hit rate on repeated queries, measurable cost reduction

---

### GAP-096: Request Coalescing Saving API Calls

- **Current State:** `apps/model-router/src/request-coalescer.ts` exists.
- **What's Missing:** Near-identical requests deduplicated, reducing total LLM API calls
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-006
- **Acceptance Criteria:** Coalescing reduces total API calls by >10% during multi-agent sessions

---

### GAP-097: Speculative Execution Producing Faster Results

- **Current State:** `apps/model-router/src/speculative.ts` exists.
- **What's Missing:** Fast draft model + full verification producing results faster than single-model approach
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-006, GAP-043
- **Acceptance Criteria:** Speculative execution reduces p50 latency by >30% for code generation tasks

---

### GAP-098: Model Scorer Comparing Output Quality

- **Current State:** `apps/model-router/src/model-scorer.ts` exists.
- **What's Missing:** Quality scores per model per task type, informing routing decisions with data
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-006, historical data
- **Acceptance Criteria:** Model scorer ranks models by quality for each task type, routing uses scores

---

### GAP-099: Complexity Estimator Validated

- **Current State:** `apps/model-router/src/complexity-estimator.ts` exists.
- **What's Missing:** Complexity estimation accurately predicts task difficulty and selects appropriate model tier
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-006
- **Acceptance Criteria:** Complexity estimator correctly routes simple tasks to cheap models, complex tasks to premium models >80% of the time

---

### GAP-100: Langfuse Integration Sending Trace Data

- **Current State:** Langfuse listed as planned technology. Not integrated.
- **What's Missing:** All LLM calls traced via Langfuse — prompt, response, latency, cost, token usage per session
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-006, GAP-016
- **Acceptance Criteria:** Every LLM call visible in Langfuse dashboard with full trace data

---

## P3 — 100x MOONSHOT (30 Gaps)

These features would make Prometheus unbeatable — the ultimate AI engineering platform.

---

### GAP-061: Full Project Generation (Scratch to Production)

- **Description:** User says "Build me a complete e-commerce platform with auth, payments, inventory, admin dashboard" → Prometheus generates everything, deploys, provides URL
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-025, GAP-024, GAP-041, GAP-057
- **Acceptance Criteria:** Complete working deployed app from single prompt, including: database schema, API, frontend, auth, payments, CI/CD, monitoring
- **Competitor Reference:** Bolt.new (simple apps), Lovable (simple apps) — but nothing does complex apps

---

### GAP-062: Self-Improving Agents

- **Description:** Agents get measurably better over time without human intervention. Self-play + pattern mining + prompt evolution
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-045, GAP-021
- **Acceptance Criteria:** SWE-bench score improves 10%+ over 3 months with zero manual prompt changes
- **Competitor Reference:** No competitor has this

---

### GAP-063: Multi-Repository Orchestration

- **Description:** Agent understands and modifies multiple repos simultaneously (e.g., frontend repo + backend repo + shared library)
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-012, GAP-041
- **Acceptance Criteria:** "Add user avatars" → agent modifies backend API, frontend UI, and shared types across 3 repos → all PRs are consistent
- **Competitor Reference:** No competitor does this

---

### GAP-064: Design-to-Code (Figma Integration)

- **Description:** Import Figma design → agent generates pixel-perfect implementation
- **Effort:** XL (1-3 months)
- **Dependencies:** Figma MCP adapter, GAP-034 (visual verification)
- **Acceptance Criteria:** Figma design input → generated UI matches design within 95% pixel accuracy
- **Competitor Reference:** v0 (partial), Lovable (partial) — but none are pixel-perfect

---

### GAP-065: Incident Response Agent

- **Description:** Detect production error from Sentry/Datadog → diagnose → generate hotfix → deploy
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-060, GAP-026, integrations
- **Acceptance Criteria:** Sentry alert → agent diagnoses root cause → generates fix → deploys hotfix → error rate drops
- **Competitor Reference:** No competitor has this — revolutionary for SRE teams

---

### GAP-066: Voice-Driven Development

- **Current State:** `packages/voice/` with speech recognizer, command parser.
- **Description:** Speak task description → agent executes → speak results back
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-002
- **Acceptance Criteria:** "Hey Prometheus, add a search bar to the header" → agent executes → speaks "Done, the search bar is live on your preview"
- **Competitor Reference:** Copilot (voice in VS Code) — but not for autonomous tasks

---

### GAP-067: Real-Time Pair Programming

- **Description:** Human and AI code simultaneously in the same file with CRDT conflict resolution, AI suggests as human types
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-048
- **Acceptance Criteria:** Human writes function signature → AI fills implementation in real-time → both see each other's cursors
- **Competitor Reference:** Cursor (inline completion) — but not real-time collaborative

---

### GAP-068: Client SDK Generation

- **Description:** Auto-generate TypeScript, Python, Go SDKs from our tRPC API
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-002
- **Acceptance Criteria:** `@prometheus/sdk` npm package with full typed client for all API endpoints
- **Competitor Reference:** OpenAI (excellent SDKs), Anthropic (excellent SDKs)

---

### GAP-069: Cost Prediction Before Execution

- **Description:** Estimate task cost and time before user commits, based on historical data
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-043, historical data
- **Acceptance Criteria:** "This task will cost ~$2.50 and take ~15 minutes" shown before execution, accurate within 30%
- **Competitor Reference:** Devin (shows estimated cost)

---

### GAP-070: Team Velocity Analytics

- **Description:** Track how much faster teams are with Prometheus, ROI calculation
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-040
- **Acceptance Criteria:** Dashboard shows: "Your team saved 120 hours this month, equivalent to $24,000 in developer time"
- **Competitor Reference:** GitHub Copilot (productivity metrics)

---

### GAP-071: Enterprise Admin Dashboard

- **Description:** Admin panel for managing 1000+ users: RBAC, cost limits, compliance, audit
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-005, GAP-040
- **Acceptance Criteria:** Admin sees all org activity, sets per-team budgets, exports audit logs, manages SSO
- **Competitor Reference:** Copilot Enterprise, Devin Enterprise

---

### GAP-072: SOC2 / ISO27001 Compliance

- **Description:** Organizational and technical controls for enterprise compliance
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-016, GAP-003
- **Acceptance Criteria:** Pass SOC2 Type II audit, receive certification
- **Competitor Reference:** Devin (SOC2), Copilot (SOC2)

---

### GAP-073: Performance Optimization Agent

- **Description:** Agent analyzes app performance (Lighthouse, bundle size, DB queries) and automatically optimizes
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-010, GAP-034
- **Acceptance Criteria:** Agent runs Lighthouse → identifies issues → fixes → score improves 20+ points
- **Competitor Reference:** No competitor has this

---

### GAP-074: Security Hardening Agent

- **Description:** Agent runs OWASP scans, identifies vulnerabilities, generates fixes, verifies fixes
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-010, guardian module
- **Acceptance Criteria:** Agent scans codebase → finds SQL injection → generates parameterized query fix → verifies
- **Competitor Reference:** Copilot (basic security), Snyk integration — but not autonomous

---

### GAP-075: Documentation Generation

- **Description:** Agent auto-generates API docs, README, architecture docs, changelog from codebase
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-010
- **Acceptance Criteria:** Agent generates OpenAPI spec, README with setup instructions, architecture diagram
- **Competitor Reference:** Copilot (doc generation) — but not comprehensive

---

### GAP-076: Automatic Infrastructure Provisioning

- **Description:** Agent creates cloud infrastructure (AWS/GCP/Azure) for generated projects using Terraform/Pulumi
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-059, cloud credentials
- **Acceptance Criteria:** "Deploy to AWS" → agent creates VPC, RDS, ECS, CloudFront → app running
- **Competitor Reference:** No competitor does this — revolutionary

---

### GAP-077: Natural Language to Technical Spec

- **Description:** Convert vague requirements ("build something like Airbnb for pet sitting") into detailed technical specification
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-009, discovery agent
- **Acceptance Criteria:** Vague prompt → detailed spec with user stories, tech stack, architecture, data model, API endpoints
- **Competitor Reference:** Devin (requirement analysis) — but not formalized

---

### GAP-078: Cross-User Learning (Anonymized)

- **Description:** Agent learns from all users' successful patterns (anonymized), improving for everyone
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-042, GAP-072 (privacy compliance)
- **Acceptance Criteria:** Common patterns extracted from 1000+ tasks → agent performance improves for all users
- **Competitor Reference:** GitHub Copilot (trained on usage data) — but Prometheus is transparent about it

---

### GAP-079: JetBrains Plugin

- **Current State:** `packages/jetbrains-plugin/` directory exists.
- **Description:** IntelliJ/WebStorm/PyCharm plugin with chat, code actions, session management
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-002
- **Acceptance Criteria:** Plugin installs in IntelliJ, chat panel works, code actions trigger Prometheus tasks
- **Competitor Reference:** Copilot (JetBrains support)

---

### GAP-080: Mobile App / PWA

- **Description:** Monitor tasks, approve actions, view results from mobile phone
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-013
- **Acceptance Criteria:** PWA installable on iOS/Android, shows active tasks, allows approval of pending actions
- **Competitor Reference:** Devin (mobile-responsive web)

---

### GAP-101: AWS/GCP/Azure MCP Adapters for Cloud Provisioning

- **Current State:** AWS adapter exists at `apps/mcp-gateway/src/adapters/aws/`. GCP/Azure adapters do not exist.
- **What's Missing:** Full cloud provisioning via MCP — create VPCs, databases, compute instances, CDNs across all 3 major clouds
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-076, cloud credentials
- **Acceptance Criteria:** Agent provisions cloud resources via MCP adapters for AWS, GCP, and Azure

---

### GAP-102: Multi-Tenant GPU Scheduling for Ollama

- **Current State:** Ollama in docker-compose serves one tenant.
- **What's Missing:** Multiple orgs sharing GPU resources with fair scheduling, queue management, and isolation
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-003, GPU infrastructure
- **Acceptance Criteria:** 10 orgs share GPU pool, each gets fair allocation, no interference

---

### GAP-103: Agent Replay & Step-by-Step Debugging

- **Current State:** Session events logged in DB. No replay mechanism.
- **What's Missing:** Replay completed agent sessions step-by-step, inspect decisions, understand failures
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-008, GAP-013
- **Acceptance Criteria:** Select completed session → replay each agent step with timing → see decisions and tool calls

---

### GAP-104: Terraform State Management for Generated IaC

- **Current State:** IaC generator tool creates Terraform files. No state management.
- **What's Missing:** Terraform state stored securely, plan/apply cycle managed, drift detection
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-076
- **Acceptance Criteria:** Agent generates Terraform → applies → state stored → subsequent runs detect drift

---

### GAP-105: Model Fine-Tuning Pipeline on Successful Sessions

- **Current State:** Training data collection exists in `apps/orchestrator/src/training/`.
- **What's Missing:** Pipeline to fine-tune open models on successful session data, deploy fine-tuned models via Ollama
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-045, GAP-062, GPU infrastructure
- **Acceptance Criteria:** Fine-tuned model outperforms base model on domain-specific tasks

---

### GAP-106: API Versioning & Backward Compatibility

- **Current State:** Single API version. No versioning strategy.
- **What's Missing:** API version headers, deprecation warnings, backward-compatible changes
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-068
- **Acceptance Criteria:** API v1 continues working when v2 is deployed, deprecation warnings on old endpoints

---

### GAP-107: Load Testing & Benchmark Validation

- **Current State:** k6 listed as planned. No load tests exist.
- **What's Missing:** Load tests simulating 50+ concurrent agent sessions, validated throughput targets
- **Effort:** L (2-4 weeks)
- **Dependencies:** GAP-003
- **Acceptance Criteria:** k6 load test runs 50 concurrent sessions → system handles within SLO targets

---

### GAP-108: Data Export & Portability

- **Current State:** GDPR export router exists. No general data portability.
- **What's Missing:** Export all org data in standard formats (JSON, CSV), import to new instance
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-071
- **Acceptance Criteria:** Org admin exports all data → imports into fresh Prometheus instance → all data preserved

---

### GAP-109: Multi-Region Deployment

- **Current State:** K8s manifests for single-region. Hetzner EU planned.
- **What's Missing:** Multi-region deployment with data replication, region-aware routing
- **Effort:** XL (1-3 months)
- **Dependencies:** GAP-003, GAP-072
- **Acceptance Criteria:** US and EU regions, data residency enforced, <100ms latency per region

---

### GAP-110: Audit Log Retention & Archival

- **Current State:** Audit logger writes to DB. No retention policy.
- **What's Missing:** Configurable retention periods, cold storage archival, searchable historical audit trail
- **Effort:** M (1-2 weeks)
- **Dependencies:** GAP-071
- **Acceptance Criteria:** 90-day hot retention, archival to S3/R2, compliance-ready export

---

## Summary Scorecard

| Priority | Count | Effort Breakdown | Timeline |
|----------|-------|-----------------|----------|
| **P0 Ship Blockers** | 25 | 4 XL, 6 L, 10 M, 5 S | 0-30 days |
| **P1 Devin Parity** | 25 | 0 XL, 4 L, 20 M, 1 S | 30-60 days |
| **P2 10x Advantage** | 30 | 1 XL, 15 L, 14 M, 0 S | 60-120 days |
| **P3 100x Moonshot** | 30 | 9 XL, 12 L, 7 M, 0 S | 120-365 days |
| **TOTAL** | **110** | **14 XL, 37 L, 51 M, 6 S** | **~12 months** |

---

## The Path to 100x

### Month 1: Ship It (P0)
- All services running and communicating
- End-to-end task execution working
- Live demo instance
- First SWE-bench run

### Month 2: Match Devin (P1)
- Slack bot and GitHub App deployed
- Preview deployments working
- Multi-language support
- Onboarding flow polished

### Month 3-4: Surpass Devin (P2)
- Multi-agent orchestration proven and measured
- Memory system improving agent quality
- Cost optimization saving 60%+ vs competitors
- Plugin marketplace live

### Month 5-12: 100x Moonshot (P3)
- Full project generation from scratch to production
- Self-improving agents (SWE-bench score climbing automatically)
- Incident response agent (detect → diagnose → fix → deploy)
- Design-to-code (Figma → pixel-perfect implementation)
- Enterprise admin dashboard with SOC2 compliance
- Voice-driven development
- Cross-user learning

### The Result
A platform where you can say "Build me a complete SaaS product with auth, billing, dashboard, API, and deploy it to production" and wake up to a working, tested, deployed application — monitored, secure, and ready for users. That's 100x.
