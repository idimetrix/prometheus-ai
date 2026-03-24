# Prometheus — Comprehensive Gap Implementation Plan

## Context

Prometheus is an AI engineering platform with 9 services, 29 packages, 34 DB tables, 12 specialist agents, and 35+ tools. The codebase is **real and extensive** — all services have production-grade implementations with full middleware, auth, logging, and metrics. TypeScript compiles clean across all 35 packages.

**The core problem:** Nothing has been validated end-to-end. No user has ever submitted a task through the web UI and received a working result. MISSING.md documents 110 gaps across 4 priority tiers.

**What this plan addresses:** All code-level gaps that can be fixed without external accounts (Clerk, Stripe) or cloud infrastructure. Organized into 8 sequential/parallel phases.

---

## Phase 1: Dev Auth Bypass & Service Bootability (FOUNDATION)
> Unblocks everything else. All services must start and accept requests in dev mode.

### 1.1 Add DEV_AUTH_BYPASS mode to auth package
- **Files:** `packages/auth/src/server.ts`
- **Change:** When `DEV_AUTH_BYPASS=true`, accept `dev_token_<userId>` tokens and return synthetic AuthContext `{ userId, orgId: "org_dev", orgRole: "owner" }`
- **Why:** Every tRPC call and WebSocket connection requires Clerk JWT — this unblocks all dev/testing

### 1.2 Wire dev auth into API and Socket Server
- **Files:** `apps/api/src/context.ts`, `apps/socket-server/src/auth.ts` (or wherever auth middleware extracts context)
- **Change:** In dev mode, try dev auth bypass before returning unauthorized
- **Verify:** `curl -H "Authorization: Bearer dev_token_usr_seed" http://localhost:4000/trpc/health`

### 1.3 Make env vars non-fatal in dev mode
- **Files:** `packages/auth/src/server.ts`, `packages/billing/src/stripe.ts`, any package that throws on missing env vars at import time
- **Change:** Wrap Clerk/Stripe initialization in try-catch, log warning instead of crashing when `NODE_ENV=development`
- **Why:** Services crash at startup if CLERK_SECRET_KEY or STRIPE_SECRET_KEY is missing

### 1.4 Complete .env.example
- **Files:** `.env.example`
- **Change:** Add `DEV_AUTH_BYPASS=true`, `DEV_MOCK_LLM=true`, all service URLs with defaults, document required vs optional vars
- **Verify:** Copy .env.example → .env, all services start without "missing env var" errors

### 1.5 Verify all 8 backend services boot independently
- **Files:** Each `apps/*/src/index.ts` — audit for import-time crashes, missing configs, unhandled promise rejections
- **Change:** Fix any service that doesn't reach "listening on port X"
- **Verify:** Start each service individually with `tsx apps/<service>/src/index.ts`

### 1.6 Create smoke test script
- **Files:** NEW `scripts/smoke-test.ts`
- **Change:** Script that hits `/health` on all 8 services, reports status matrix, tests inter-service connectivity
- **Verify:** `tsx scripts/smoke-test.ts` shows all green

**GAPs addressed:** GAP-001, GAP-083, GAP-084, GAP-085

---

## Phase 2: Database Validation & Seed Data (DATA LAYER)
> Can run in parallel with Phase 1

### 2.1 Verify migrations from empty DB
- **Files:** `packages/db/drizzle.config.ts`, `packages/db/drizzle/` migration files
- **Change:** Run `pnpm db:generate` to ensure migrations are current, then `pnpm db:push` against clean Postgres
- **Verify:** `pnpm db:push` exits 0 on empty database

### 2.2 Enhance seed data for full pipeline testing
- **Files:** `packages/db/src/seed.ts`
- **Change:** Add: credit balances for dev org, subscription records, sample project with active session, sample pending task, seed API key for programmatic access
- **Why:** Pipeline testing needs credit balances (credit reservation will fail otherwise) and existing sessions

### 2.3 Add dev DB reset convenience script
- **Files:** NEW `scripts/dev-reset.ts`
- **Change:** Drops all, pushes schema, seeds. One command for clean starts.
- **Verify:** `tsx scripts/dev-reset.ts` succeeds from scratch

**GAPs addressed:** GAP-004

---

## Phase 3: Task Pipeline Wiring (CORE E2E PATH)
> The critical path. Depends on Phase 1 + 2.

### 3.1 Add mock LLM provider for dev mode
- **Files:** NEW `packages/ai/src/providers/mock.ts`, modify `apps/model-router/src/router.ts`
- **Change:** When `DEV_MOCK_LLM=true`, model-router's `/route` endpoint returns canned AI responses (structured tool calls for simple tasks). The mock provider returns realistic-looking code generation responses.
- **Why:** Full pipeline testing without Ollama/API keys

### 3.2 Verify task submission → queue flow
- **Files:** `apps/api/src/routers/sessions.ts`, `apps/api/src/routers/tasks.ts`
- **Change:** Ensure `sessions.create` mutation correctly enqueues via `agentTaskQueue.add()`. Add dev-mode credit bypass (skip credit check or auto-grant when `DEV_AUTH_BYPASS=true`).
- **Verify:** Call sessions.create, verify job appears in Redis queue

### 3.3 Verify queue-worker → orchestrator connectivity
- **Files:** `apps/queue-worker/src/processor.ts`, service URL configuration
- **Change:** Verify `orchestratorClient.post("/process", ...)` sends correct payload. Fix error handling for connection refused.
- **Verify:** Submit task, see queue-worker log "Processing agent task", orchestrator log "Processing task"

### 3.4 Wire execution engine to model router with mock support
- **Files:** `apps/orchestrator/src/engine/execution-engine.ts`
- **Change:** Verify request format matches model-router `/route` expectations (slot, messages, tools). Ensure the agent loop correctly parses mock LLM responses (tool calls, text output).
- **Verify:** Full pipeline: submit task → queue → orchestrator → model-router (mock) → result

### 3.5 Add pipeline integration test
- **Files:** NEW `tests/integration/e2e-pipeline.test.ts`
- **Change:** Test that exercises: seed DB → create session → verify queued → process task with mock orchestrator → verify completion status
- **Verify:** `pnpm test --filter=tests/integration`

**GAPs addressed:** GAP-002, GAP-006, GAP-010, GAP-015

---

## Phase 4: Real-Time Streaming (WEBSOCKET LAYER)
> Can start after Phase 1

### 4.1 Verify event publisher → Redis → socket server pipeline
- **Files:** `packages/queue/src/pub-sub.ts`, `apps/socket-server/src/namespaces/sessions.ts`
- **Change:** Verify event format consistency between publisher and subscriber. Add reconnection logic for Redis subscriber failures.
- **Verify:** Publish test event to Redis, verify it arrives at socket client

### 4.2 Verify SSE fallback endpoint
- **Files:** `apps/api/src/routes/sse.ts`
- **Change:** Verify Redis subscription and event streaming works
- **Verify:** `curl -N http://localhost:4000/api/sse?sessionId=xxx`

### 4.3 Wire web UI session page to WebSocket
- **Files:** `apps/web/src/app/(dashboard)/dashboard/sessions/[id]/page.tsx`, `apps/web/src/hooks/`, `apps/web/src/stores/`
- **Change:** Ensure session detail page connects to `/sessions` namespace, joins room, renders incoming events
- **Verify:** Open session page, submit task, see events appear

**GAPs addressed:** GAP-008, GAP-090

---

## Phase 5: Agent System Refinement (INTELLIGENCE)
> Depends on Phase 3

### 5.1 Tune system prompts for all 12 agent roles
- **Files:** `packages/agent-sdk/src/roles/*.ts` (architect.ts, backend-coder.ts, frontend-coder.ts, test-engineer.ts, etc.)
- **Change:** Each role gets:
  - Detailed system prompt (>500 words) with role-specific instructions
  - Structured output format (OBSERVE/ANALYZE/PLAN/ACT protocol)
  - Tool usage examples specific to the role
  - Few-shot examples for common tasks
- **Verify:** Submit role-specific tasks, verify output quality

### 5.2 Verify tool registry completeness
- **Files:** `packages/agent-sdk/src/tools/*.ts`
- **Change:** Ensure all tools (file_write, file_read, terminal_exec, file_edit, git_*) have proper Zod schemas, descriptions, and execution handlers
- **Verify:** Unit tests for tool registry resolution

### 5.3 Add error recovery patterns
- **Files:** `apps/orchestrator/src/engine/recovery-strategy.ts`, `apps/orchestrator/src/engine/execution-engine.ts`
- **Change:** Verify retry logic for LLM timeout/500/429, sandbox crash recovery, max iteration limits
- **Verify:** Simulate failures, verify graceful recovery

**GAPs addressed:** GAP-009, GAP-010, GAP-011

---

## Phase 6: Web UI Functional Pages (FRONTEND)
> Can start after Phase 1 + 2

### 6.1 Fix dashboard page data loading
- **Files:** `apps/web/src/app/(dashboard)/dashboard/page.tsx`, `apps/web/src/app/(dashboard)/dashboard/projects/page.tsx`
- **Change:** Ensure tRPC queries match API router signatures, add error boundaries and loading states
- **Verify:** Navigate to /dashboard, see projects/sessions from seed data

### 6.2 Fix session detail page
- **Files:** `apps/web/src/app/(dashboard)/dashboard/sessions/[id]/page.tsx`, `apps/web/src/components/session/`
- **Change:** Wire session view to display events, chat messages, file changes, terminal output
- **Verify:** Open session, see agent output

### 6.3 Fix create project / new session flow
- **Files:** `apps/web/src/app/(dashboard)/create/page.tsx`, `apps/web/src/app/(dashboard)/new/page.tsx`
- **Change:** Ensure create project form submits to API, new session page sends task
- **Verify:** Create project → start session → submit prompt via UI

### 6.4 Add error boundaries to all route segments
- **Files:** Add `error.tsx` and `not-found.tsx` to key route segments under `apps/web/src/app/`
- **Change:** Friendly error pages with retry buttons instead of white screens
- **Verify:** Trigger errors, see recovery UI

**GAPs addressed:** GAP-013, GAP-086

---

## Phase 7: Testing Infrastructure (QUALITY)
> Can start after Phase 3

### 7.1 Fix and run existing tests
- **Files:** All `apps/*/src/**/*.test.ts`, `packages/*/src/**/*.test.ts`
- **Change:** Run `pnpm test`, fix any failures
- **Verify:** `pnpm test` exits 0

### 7.2 Add contract tests for service boundaries
- **Files:** NEW tests for: API ↔ orchestrator contract, orchestrator ↔ model-router contract, queue-worker ↔ orchestrator contract
- **Change:** Verify request/response shapes match between services
- **Verify:** Contract tests pass

### 7.3 Add service health integration test
- **Files:** NEW `tests/integration/service-health.test.ts`
- **Change:** Test all services respond to `/health`, `/live`, `/ready` with expected formats

**GAPs addressed:** GAP-017

---

## Phase 8: Sandbox & Git Integration (EXECUTION)
> Depends on Phase 3

### 8.1 Add mock sandbox provider for dev
- **Files:** NEW `apps/sandbox-manager/src/providers/mock.ts`
- **Change:** Execute commands in a temp directory instead of Docker. For dev/testing without Docker-in-Docker.
- **Verify:** Sandbox manager responds to create/exec in mock mode

### 8.2 Verify git operations module
- **Files:** `apps/sandbox-manager/src/git-ops.ts` (or equivalent)
- **Change:** Ensure clone, branch, commit, push work with proper error handling for missing credentials
- **Verify:** Unit tests for git operations

### 8.3 Verify container manager (when Docker available)
- **Files:** `apps/sandbox-manager/src/container.ts`, `apps/sandbox-manager/src/pool.ts`
- **Change:** Graceful degradation when Docker is not available
- **Verify:** With Docker: create container, exec command, destroy. Without Docker: mock provider activates.

**GAPs addressed:** GAP-007, GAP-012

---

## Execution Order & Parallelism

```
Phase 1 (Foundation)  ──┬──→ Phase 3 (Pipeline) ──→ Phase 5 (Agent Tuning)
                        │                         ──→ Phase 7 (Testing)
                        │                         ──→ Phase 8 (Sandbox)
                        ├──→ Phase 4 (Streaming)
                        └──→ Phase 6 (Web UI)
Phase 2 (Database)    ──┘
```

**Phases 1+2 in parallel → Phase 3 (critical path) → Phases 4-8 can parallelize**

---

## Verification Plan (End-to-End)

After all phases:
1. `pnpm typecheck` — zero errors
2. `pnpm unsafe` — zero lint/format issues
3. `pnpm test` — all tests pass
4. Start all services with `pnpm dev`
5. Run `tsx scripts/smoke-test.ts` — all services healthy
6. Open `http://localhost:3000` — dashboard renders with seed data
7. Create session, submit "Create a hello world Express server"
8. See task queued → orchestrator processing → model-router response → result in UI

---

## What's NOT In This Plan (Requires External Setup)

| Gap | Reason | What's Needed |
|-----|--------|---------------|
| GAP-003 (Live demo) | Cloud infrastructure | Server, DNS, TLS |
| GAP-005 (Auth E2E) | Clerk account | API keys, webhook config |
| GAP-014 (Billing) | Stripe account | API keys, products |
| GAP-016 (Monitoring) | Grafana/Prometheus infra | Running monitoring stack |
| GAP-018 (Self-hosting docs) | Validated deployment | Working production setup |
| GAP-019 (CLI working) | Running API instance | Deployed API endpoint |
| GAP-020 (VS Code ext) | VS Code marketplace | Extension packaging |
| GAP-021+ (P1/P2/P3) | Working P0 first | Complete P0 gaps |

---

## Summary

**Total P0 gaps addressable by code: ~15 of 25**
**Phases: 8 (3 parallel tracks after Phase 1+2)**
**Critical path: Phase 1 → Phase 3 (dev auth + pipeline wiring)**
**Key files:** `packages/auth/src/server.ts`, `apps/orchestrator/src/engine/execution-engine.ts`, `apps/queue-worker/src/processor.ts`, `apps/model-router/src/router.ts`, `packages/db/src/seed.ts`
