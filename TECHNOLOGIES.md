# PROMETHEUS / APEX — Complete Technology Reference

> Every open source technology we **MUST USE**, **SHOULD USE**, and **CAN USE** to build the 10x Devin Killer.
>
> Last updated: March 2026

---

## Classification Key

| Label | Meaning |
|-------|---------|
| **MUST USE** | Core to the architecture. Already in use or required for launch. Non-negotiable. |
| **SHOULD USE** | Strongly recommended. High value, proven at scale, fills a critical gap. |
| **CAN USE** | Good alternative. Useful for specific use cases, future scaling, or enterprise features. |

**Status indicators**: `IN USE` = already in our codebase | `PLANNED` = scheduled for implementation | `OPTIONAL` = evaluate when needed

---

## Table of Contents

1. [Core Framework Layer](#1-core-framework-layer)
2. [UI & Design System](#2-ui--design-system)
3. [State Management & Data Fetching](#3-state-management--data-fetching)
4. [Real-Time Communication](#4-real-time-communication)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Database & ORM](#6-database--orm)
7. [Caching & Message Broker](#7-caching--message-broker)
8. [Task Queue & Workflow Orchestration](#8-task-queue--workflow-orchestration)
9. [AI Agent Frameworks](#9-ai-agent-frameworks)
10. [LLM Model Serving & Local AI](#10-llm-model-serving--local-ai)
11. [LLM Routing & Gateway](#11-llm-routing--gateway)
12. [Vector Database & Embeddings](#12-vector-database--embeddings)
13. [RAG & Code Intelligence](#13-rag--code-intelligence)
14. [Knowledge Graph](#14-knowledge-graph)
15. [Memory Systems](#15-memory-systems)
16. [Browser Automation](#16-browser-automation)
17. [Sandbox & Container Isolation](#17-sandbox--container-isolation)
18. [Code Analysis & Security](#18-code-analysis--security)
19. [MCP Servers (Model Context Protocol)](#19-mcp-servers-model-context-protocol)
20. [Search](#20-search)
21. [Object Storage](#21-object-storage)
22. [Email & Notifications](#22-email--notifications)
23. [Payments & Billing](#23-payments--billing)
24. [Monitoring & Observability](#24-monitoring--observability)
25. [CI/CD & Build](#25-cicd--build)
26. [Infrastructure & Hosting](#26-infrastructure--hosting)
27. [Kubernetes & Scaling](#27-kubernetes--scaling-3k-users)
28. [API Rate Limiting & Gateway](#28-api-rate-limiting--gateway)
29. [Workflow Automation & Integrations](#29-workflow-automation--integrations)
30. [Development Tools](#30-development-tools)
31. [LLM Models (Free / Open Source)](#31-llm-models-free--open-source)
32. [Testing](#32-testing)

---

## 1. Core Framework Layer

### Next.js 15 / 16 — `MUST USE` — `IN USE`
- **Version**: 15.3.0 (current), targeting 16.x
- **License**: MIT
- **GitHub**: 130K+ stars
- **What**: Full-stack React framework with App Router, React Server Components (RSC), streaming, and Turbopack
- **Why**: RSC + streaming is essential for real-time agent UI. Best ecosystem for shadcn/ui. Deployed on Fly.io as persistent server (not Vercel serverless) to support WebSockets
- **Alternatives**: Remix, SvelteKit, Nuxt
- **Status**: `IN USE` — `apps/web`

### React 19 — `MUST USE` — `IN USE`
- **Version**: 19.1.0
- **License**: MIT
- **GitHub**: 235K+ stars
- **What**: UI component library with concurrent features, Server Components, Actions, and `use()` hook
- **Why**: Foundation of our entire frontend. React 19's streaming + Suspense powers the real-time agent session UI
- **Status**: `IN USE`

### TypeScript 5.7 — `MUST USE` — `IN USE`
- **Version**: 5.7.0
- **License**: Apache-2.0
- **GitHub**: 105K+ stars
- **What**: Typed superset of JavaScript
- **Why**: Type safety across the entire monorepo. Required for tRPC end-to-end type safety, Drizzle ORM, and Zod schemas
- **Status**: `IN USE` — strict mode enabled

### Hono — `MUST USE` — `IN USE`
- **Version**: 4.7.0
- **License**: MIT
- **GitHub**: 22K+ stars
- **What**: Ultrafast, lightweight web framework for edge and Node.js. Built on Web Standards
- **Why**: Powers all our backend microservices (api, orchestrator, sandbox-manager, model-router, mcp-gateway, socket-server). Faster and lighter than Express
- **Alternatives**: Express, Fastify, Elysia
- **Status**: `IN USE` — 6 services

### Node.js 22 — `MUST USE` — `IN USE`
- **Version**: 22.0.0+
- **License**: MIT
- **What**: JavaScript runtime
- **Why**: Required runtime. LTS with native fetch, WebStreams, and improved performance
- **Status**: `IN USE`

---

## 2. UI & Design System

### shadcn/ui — `MUST USE` — `PLANNED`
- **Version**: Latest (CLI install)
- **License**: MIT
- **GitHub**: 80K+ stars
- **What**: Beautifully designed, accessible component library built on Radix UI + Tailwind CSS. You own the code — no npm dependency
- **Why**: Primary design system. AI Agent Skills (March 2026) reduce LLM hallucinations when generating UI. Design System Presets for rapid theming. Dark mode native. Every screen in APEX is built with shadcn
- **Key components**: Card, Badge, ScrollArea, Separator, Dialog, Select, Textarea, Button, Tabs, Table, Chart, Command
- **Alternatives**: Ark UI, Park UI, NextUI
- **Status**: `PLANNED` — Sprint 1

### Radix UI — `MUST USE` — `PLANNED`
- **Version**: Latest (@radix-ui/react-*)
- **License**: MIT
- **GitHub**: 16K+ stars
- **What**: Unstyled, accessible UI primitives. The foundation underneath shadcn/ui
- **Why**: Provides accessible, WAI-ARIA compliant primitives that shadcn styles with Tailwind
- **Status**: `PLANNED` — installed with shadcn

### AI Elements / Vercel AI SDK — `MUST USE` — `PLANNED`
- **Version**: ai ^5.0.0, ai-elements latest
- **License**: MIT / Apache-2.0
- **GitHub**: 12K+ stars (ai SDK)
- **What**: AI-native UI components (Terminal, FileTree, Plan, Message, Reasoning, CodeBlock, Queue, Task, Checkpoint, PromptInput, Sources, Suggestion) + React hooks (useChat, useCompletion)
- **Why**: These components ARE the agent session UI. Terminal for live shell output, Plan for task plans, Queue for Fleet Mode, Message for Ask Mode. No other library provides these AI-native primitives
- **Key components used**: `<Terminal />`, `<FileTree />`, `<Plan />`, `<PlanAction />`, `<Message />`, `<MessageContent />`, `<Reasoning />`, `<ReasoningContent />`, `<CodeBlock />`, `<Queue />`, `<QueueItem />`, `<Task />`, `<TaskContent />`, `<Checkpoint />`, `<PromptInput />`, `<Sources />`, `<Suggestion />`
- **Status**: `PLANNED` — Sprint 2

### Tailwind CSS v4 — `MUST USE` — `IN USE`
- **Version**: 4.0.0
- **License**: MIT
- **GitHub**: 86K+ stars
- **What**: Utility-first CSS framework
- **Why**: Fastest iteration speed. Native shadcn compatibility. Dark mode trivial. CSS-first config in v4 (no tailwind.config.js)
- **Status**: `IN USE`

### Framer Motion — `SHOULD USE` — `PLANNED`
- **Version**: ^11.0.0
- **License**: MIT
- **GitHub**: 25K+ stars
- **What**: Production-ready animation library for React
- **Why**: Smooth UI animations for agent status transitions, panel resizing, and micro-interactions. Makes the UI feel premium
- **Alternatives**: React Spring, CSS animations
- **Status**: `PLANNED`

### cmdk — `SHOULD USE` — `PLANNED`
- **Version**: ^1.0.0
- **License**: MIT
- **GitHub**: 10K+ stars
- **What**: Fast, composable command palette component (Cmd+K)
- **Why**: Power user navigation. Quick access to repos, agents, tasks, settings. Essential for developer-focused UX
- **Status**: `PLANNED`

### CodeMirror 6 — `SHOULD USE` — `PLANNED`
- **Version**: ^6.0.0
- **License**: MIT
- **GitHub**: 5K+ stars
- **What**: Modular, extensible code editor with @codemirror/merge for diff/merge views
- **Why**: Lightweight code diff viewer in the agent session UI. Smaller bundle than Monaco. Merge extension for before/after diffs
- **Alternatives**: Monaco Editor (heavier, more features)
- **Status**: `PLANNED` — Sprint 2

### Monaco Editor — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 43K+ stars
- **What**: VS Code's editor component. Full-featured code editor
- **Why**: Alternative to CodeMirror if we need full IDE-like editing in the browser (Watch Mode). Heavier bundle but more features
- **Status**: `OPTIONAL`

### D3.js — `SHOULD USE` — `PLANNED`
- **Version**: ^7.9.0
- **License**: ISC
- **GitHub**: 110K+ stars
- **What**: Data visualization library for custom, interactive graphics
- **Why**: Powers the Project Brain codebase dependency graph visualization (Screen 4). No other library provides this level of graph customization
- **Status**: `PLANNED` — Sprint 3

### Recharts — `SHOULD USE` — `PLANNED`
- **Version**: ^2.12.0
- **License**: MIT
- **GitHub**: 24K+ stars
- **What**: Composable charting library built on D3 + React
- **Why**: Analytics dashboard charts (Screen 6). Used inside shadcn's Chart component. Tasks completed, PR success rate, credit consumption charts
- **Status**: `PLANNED` — Sprint 5

### diff2html — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 3K+ stars
- **What**: HTML diff visualization from unified/git diff output
- **Why**: Quick diff rendering for PR previews. Lighter alternative if CodeMirror merge is overkill for read-only diffs
- **Status**: `OPTIONAL`

---

## 3. State Management & Data Fetching

### Zustand 5 — `MUST USE` — `IN USE`
- **Version**: 5.0.0
- **License**: MIT
- **GitHub**: 50K+ stars
- **What**: Minimal, flexible state management for React
- **Why**: Global state for session state, user preferences, UI state. Tiny bundle (<1KB). No boilerplate. Works with React 19
- **Alternatives**: Jotai, Valtio, Redux Toolkit
- **Status**: `IN USE` — `apps/web`

### TanStack React Query 5 — `MUST USE` — `IN USE`
- **Version**: 5.67.0
- **License**: MIT
- **GitHub**: 44K+ stars
- **What**: Server state management with caching, background refetching, optimistic updates
- **Why**: All server data fetching. Automatic cache invalidation. Works perfectly with tRPC via @trpc/react-query
- **Status**: `IN USE` — `apps/web`

### tRPC 11 — `MUST USE` — `IN USE`
- **Version**: 11.0.0
- **License**: MIT
- **GitHub**: 36K+ stars
- **What**: End-to-end type-safe APIs without code generation
- **Why**: Type safety from database schema (Drizzle) → API routes (tRPC) → frontend (React Query). Zero runtime overhead. No OpenAPI/GraphQL codegen step
- **Alternatives**: GraphQL, REST + Zodios
- **Status**: `IN USE` — `apps/api` + `apps/web`

---

## 4. Real-Time Communication

### Socket.io 4.8 — `MUST USE` — `IN USE`
- **Version**: 4.8.0
- **License**: MIT
- **GitHub**: 62K+ stars
- **What**: Real-time bidirectional WebSocket library with automatic reconnection, room support, and fallbacks
- **Why**: Powers real-time collaboration: multiple users watching the same agent session, override/takeover, terminal input. Requires custom Next.js server (not Vercel serverless)
- **Status**: `IN USE` — `apps/socket-server` + `apps/web` (socket.io-client)

### Server-Sent Events (SSE) — `MUST USE` — `PLANNED`
- **Version**: Native Web API
- **License**: N/A (web standard)
- **What**: Unidirectional server→client streaming over HTTP
- **Why**: Primary transport for agent output streaming (terminal output, file changes, plan updates). SSE is stateless, works through any HTTP proxy, and is simpler than WebSockets for one-way data. Agent Orchestrator → Redis Pub/Sub → SSE → Browser
- **Status**: `PLANNED` — Sprint 2

### Liveblocks — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Proprietary (free tier)
- **What**: Real-time collaboration infrastructure (presence, cursors, comments, notifications)
- **Why**: If we need collaborative agent dashboards where multiple team members annotate/comment on agent sessions in real-time
- **Status**: `OPTIONAL`

### Ably — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Proprietary (free tier)
- **What**: Managed real-time messaging with stream resume, presence, and history
- **Why**: Alternative to self-hosted Socket.io if we need guaranteed message delivery at scale (10K+ concurrent connections)
- **Status**: `OPTIONAL`

---

## 5. Authentication & Authorization

### Clerk — `MUST USE` — `IN USE`
- **Version**: @clerk/nextjs 6.12.0, @clerk/backend 1.21.0
- **License**: Proprietary (free tier: 10K MAU)
- **What**: Managed authentication with multi-tenant organizations, GitHub OAuth, SSO, RBAC
- **Why**: Fastest path to launch. Multi-tenant org support out of the box (critical for team/enterprise plans). GitHub OAuth for developer auth. Pre-built UI components
- **Status**: `IN USE` — `packages/auth`

### NextAuth.js / Auth.js v5 — `CAN USE` — `OPTIONAL`
- **Version**: ^5.0.0
- **License**: ISC
- **GitHub**: 25K+ stars
- **What**: Open source authentication for Next.js. App Router native in v5
- **Why**: Open source alternative to Clerk. Use if we need to self-host auth for enterprise/privacy customers. No per-MAU pricing
- **Alternatives**: SuperTokens, Keycloak
- **Status**: `OPTIONAL` — enterprise self-hosted option

### SuperTokens — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 14K+ stars
- **What**: Self-hosted or managed auth with prebuilt UI, passwordless, social login
- **Why**: Full control over auth infrastructure. Better than Keycloak for modern stacks (lighter, Node.js native)
- **Status**: `OPTIONAL`

### Keycloak — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 25K+ stars
- **What**: Enterprise-grade IAM (identity and access management). Java-based
- **Why**: Enterprise customers requiring on-prem IAM with SAML, OIDC, LDAP. Resource-heavy but feature-complete
- **Status**: `OPTIONAL` — enterprise only

---

## 6. Database & ORM

### PostgreSQL 16 — `MUST USE` — `IN USE`
- **Version**: 16 (pgvector/pgvector:pg16 Docker image)
- **License**: PostgreSQL License (permissive)
- **What**: Advanced open source relational database
- **Why**: Primary database for all application data. pgvector extension for vector search. Row-Level Security (RLS) for multi-tenant isolation. pgcrypto for encryption at rest. FTS for basic search. One database, multiple capabilities
- **Status**: `IN USE` — `docker-compose.yml`

### pgvector — `MUST USE` — `IN USE`
- **Version**: Included in pgvector/pgvector:pg16 image
- **License**: PostgreSQL License
- **GitHub**: 13K+ stars
- **What**: PostgreSQL extension for vector similarity search (cosine, L2, inner product)
- **Why**: Vector embeddings for semantic code search stored in the same database. No extra service needed. Sub-50ms queries at our scale (1K users). Stores code_embeddings table with vector(1536) columns
- **Status**: `IN USE` — via Docker image

### Drizzle ORM — `MUST USE` — `IN USE`
- **Version**: 0.39.0
- **License**: Apache-2.0
- **GitHub**: 28K+ stars
- **What**: TypeScript ORM with SQL-like syntax. Lightweight, edge-native (5KB)
- **Why**: Type-safe database access across the entire monorepo. SQL-like API (not Prisma's custom DSL). Smallest bundle for serverless. drizzle-zod for automatic Zod schema generation from DB schema. drizzle-kit for migrations
- **Includes**: drizzle-orm 0.39.0, drizzle-kit 0.30.0, drizzle-zod 0.7.0
- **Alternatives**: Prisma (heavier), Kysely (lower-level)
- **Status**: `IN USE` — `packages/db`

### postgres (node-postgres) — `MUST USE` — `IN USE`
- **Version**: 3.4.0
- **License**: Unlicense
- **What**: Native PostgreSQL client for Node.js (postgres.js by porsager)
- **Why**: Fastest Node.js Postgres driver. Used by Drizzle under the hood. Native prepared statements, pipeline mode
- **Status**: `IN USE` — `packages/db`

### Neon — `SHOULD USE` — `PLANNED`
- **Version**: @neondatabase/serverless ^0.9.0
- **License**: Apache-2.0
- **What**: Serverless PostgreSQL with auto-scaling, branching, and connection pooling
- **Why**: Production database. Serverless scaling (pay per query), database branching for staging/preview, built-in pgvector support. $50/month at launch tier
- **Alternatives**: Supabase, PlanetScale (MySQL), CockroachDB
- **Status**: `PLANNED` — production deployment

### pgBouncer — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: ISC
- **What**: Lightweight connection pooler for PostgreSQL
- **Why**: Limits DB connections to 20-30 at peak (vs hundreds from microservices). Essential when running multiple services against one database
- **Status**: `PLANNED` — or use Neon's built-in pooling

---

## 7. Caching & Message Broker

### Redis / Valkey 8 — `MUST USE` — `IN USE`
- **Version**: valkey/valkey:8-alpine (Redis-compatible)
- **License**: BSD-3 (Valkey)
- **What**: In-memory data store for caching, pub/sub, session state, and as BullMQ backend
- **Why**: Multi-purpose: session state storage, rate limiting, BullMQ job queue backend, Redis Pub/Sub for SSE agent event streaming, agent session cache. Valkey is the open source Redis fork
- **Status**: `IN USE` — `docker-compose.yml`

### ioredis — `MUST USE` — `IN USE`
- **Version**: 5.9.3
- **License**: MIT
- **GitHub**: 14K+ stars
- **What**: Full-featured Redis client for Node.js with cluster support, Lua scripting, pub/sub
- **Why**: Primary Redis client across all services. Pinned to 5.9.3 in pnpm overrides for compatibility
- **Status**: `IN USE` — `packages/queue`

### Upstash — `SHOULD USE` — `PLANNED`
- **Version**: Serverless Redis
- **License**: Proprietary (free tier)
- **What**: Serverless Redis with per-request pricing, REST API, and global replication
- **Why**: Production Redis replacement. ~$30/month at usage tier. Includes Upstash Ratelimit for API rate limiting. No server management
- **Status**: `PLANNED` — production deployment

---

## 8. Task Queue & Workflow Orchestration

### BullMQ 5 — `MUST USE` — `IN USE`
- **Version**: 5.34.0
- **License**: MIT
- **GitHub**: 6K+ stars
- **What**: Redis-backed job queue for Node.js with retries, rate limiting, concurrency control, dead letter queues
- **Why**: Async task processing for agent sessions, indexing jobs, email notifications. Reliable job processing with automatic retries. Dashboard via Bull Board
- **Status**: `IN USE` — `packages/queue`, `apps/queue-worker`

### Temporal — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 13K+ stars
- **What**: Durable workflow orchestration engine with built-in state persistence, retries, and long-running workflow support
- **Why**: Agent task execution is a long-running, stateful workflow (Plan → Approve → Execute → Review → PR). Temporal's durable execution guarantees no work is lost on crashes. Better than BullMQ for complex multi-step agent flows. 1.31+ has AI tooling integration
- **Alternatives**: Trigger.dev, Inngest
- **Status**: `PLANNED` — recommended for agent orchestration

### Trigger.dev — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 10K+ stars
- **What**: TypeScript-first background job orchestration with automatic checkpointing
- **Why**: Simpler alternative to Temporal for TypeScript-only teams. Never-timeout workflows. Good for tasks that don't need Temporal's full complexity
- **Status**: `OPTIONAL`

### Inngest — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Proprietary (free tier)
- **What**: Reliable serverless functions with step-based execution and automatic retries
- **Why**: Event-driven workflows. Good for webhook → task creation flows. Simpler model than Temporal
- **Status**: `OPTIONAL`

---

## 9. AI Agent Frameworks

### OpenHands SDK — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 68K+ stars
- **What**: Modular agent SDK for building AI software engineers. Code editing, command execution, web browsing, and API calls. Model-agnostic
- **Why**: The core agent engine. 68K stars, production-proven. Our Agent Orchestrator wraps OpenHands in a custom Node.js REST API. Provides the agent loop: read files → write code → run tests → create PR
- **Status**: `PLANNED` — Sprint 1 (core integration)

### LangGraph — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 8K+ stars (34.5M monthly downloads)
- **What**: Framework for building stateful, multi-actor agent applications with cycles and branching
- **Why**: Orchestration layer for multi-agent flows (Fleet Mode). Battle-tested by 400+ companies (Cisco, Uber, LinkedIn, JPMorgan). Graph-based agent orchestration maps perfectly to our Plan → Execute → Review flow
- **Alternatives**: CrewAI, AutoGen
- **Status**: `PLANNED`

### SWE-agent — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 14K+ stars
- **What**: Agent optimized for software engineering tasks, achieving high scores on SWE-bench
- **Why**: Could be used as a specialized code-fixing agent within the agent fleet. Mini-swe-agent achieves 65% on SWE-bench in 100 Python lines
- **Status**: `OPTIONAL` — specialized agent

### Aider — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 25K+ stars
- **What**: AI pair programming in your terminal. Works with any LLM
- **Why**: Reference implementation for code editing patterns. Could be integrated as a coding backend for specific agent roles
- **Status**: `OPTIONAL`

### CrewAI — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 25K+ stars
- **What**: Multi-agent collaboration framework with defined roles and shared goals
- **Why**: Alternative to LangGraph for multi-agent orchestration. Simpler API but less flexible graph control
- **Status**: `OPTIONAL`

### AutoGen (Microsoft) — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 38K+ stars
- **What**: Multi-agent conversation framework by Microsoft Research
- **Why**: Strong multi-agent conversation patterns. Good for collaborative agent discussions (e.g., architect agent + coder agent + reviewer agent)
- **Status**: `OPTIONAL`

### AgentProtocol — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **What**: Standardized API specification for AI agents
- **Why**: If we want to expose our agent as a standardized API that other tools can interact with
- **Status**: `OPTIONAL`

---

## 10. LLM Model Serving & Local AI

### Ollama — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 115K+ stars
- **What**: Local LLM serving with automatic hardware detection, model management, and OpenAI-compatible API
- **Why**: Essential for local model fallback (background/indexing slot), enterprise air-gapped deployments, and development. 5KB footprint. Runs qwen2.5-coder, deepseek-coder, nomic-embed-text locally. FREE (electricity only)
- **Status**: `PLANNED` — background model slot

### vLLM — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 42K+ stars
- **What**: High-throughput LLM inference engine with PagedAttention memory management
- **Why**: Production model serving when self-hosting. 6x throughput vs Ollama at 50 concurrent users. Essential for GPU servers (Hetzner) serving multiple concurrent agent sessions. Supports continuous batching
- **Alternatives**: SGLang (emerging, better scheduling)
- **Status**: `PLANNED` — GPU infrastructure (500+ users)

### llama.cpp — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 75K+ stars
- **What**: C/C++ LLM inference engine. Maximum performance, broad hardware support (CUDA, Metal, ROCm, Vulkan)
- **Why**: Absolute maximum performance for self-hosted models. Ollama uses llama.cpp under the hood. Direct use for fine-tuned optimization
- **Status**: `OPTIONAL` — performance optimization

### LocalAI — `CAN USE` — `OPTIONAL`
- **Version**: 3.10.0 (Jan 2026)
- **License**: MIT
- **GitHub**: 28K+ stars
- **What**: Universal AI router with Anthropic API support, MCP integration, distributed inference, stateful agents
- **Why**: Alternative to Ollama with built-in MCP support and multi-model orchestration. Could replace our custom model-router for local models
- **Status**: `OPTIONAL`

### SGLang — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 8K+ stars
- **What**: Emerging LLM serving framework with better scheduling and structured output support
- **Why**: Potential vLLM replacement for production serving. Better at structured output generation (JSON, code)
- **Status**: `OPTIONAL` — evaluate vs vLLM

---

## 11. LLM Routing & Gateway

### claude-code-router — `MUST USE` — `PLANNED`
- **Version**: @musistudio/claude-code-router
- **License**: MIT
- **What**: Smart LLM request routing based on task type, context length, and cost budget
- **Why**: Core model intelligence layer. Routes: default→DeepSeek V3, think→DeepSeek R1/Claude Sonnet, longContext→Gemini Flash (FREE), background→Ollama local, vision→Claude Sonnet, review→Claude Sonnet, premium→Claude Opus. Average task costs $0.08-0.15
- **Status**: `PLANNED` — Sprint 1

### LiteLLM — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 18K+ stars
- **What**: Self-hosted, OpenAI-compatible proxy supporting 100+ LLM providers. Unified API, load balancing, fallbacks, spend tracking
- **Why**: Backup/enhancement to claude-code-router. Handles per-user and per-model rate limits. Unified logging of all LLM requests. Supports every provider we use (OpenAI, Anthropic, DeepSeek, Gemini, Ollama, Groq, Cerebras, Mistral, OpenRouter)
- **Alternatives**: Helicone, Portkey
- **Status**: `PLANNED`

### Helicone — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 3K+ stars
- **What**: Rust-based AI gateway with observability, caching, and rate limiting
- **Why**: Production-grade LLM observability. <5 min setup. Sophisticated load-balancing across providers
- **Status**: `OPTIONAL`

### Portkey — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Proprietary (free tier)
- **What**: Enterprise AI control plane with routing, observability, guardrails, and governance
- **Why**: Enterprise customers who need LLM governance, audit trails, and cost controls beyond what LiteLLM provides
- **Status**: `OPTIONAL` — enterprise feature

---

## 12. Vector Database & Embeddings

### pgvector (in PostgreSQL) — `MUST USE` — `IN USE`
- **Version**: Built into pgvector/pgvector:pg16 image
- **License**: PostgreSQL License
- **GitHub**: 13K+ stars
- **What**: PostgreSQL extension for vector similarity search
- **Why**: Primary vector store for code embeddings at launch scale. No extra service needed. Same database as application data. Supports HNSW indexing for sub-50ms queries. Maxes out at ~10-100M vectors (well beyond our 1K user needs)
- **Status**: `IN USE`

### Qdrant — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 22K+ stars
- **What**: Rust-based vector database with ACID transactions, payload filtering, distributed mode
- **Why**: Scale-up path when pgvector isn't enough (10K+ users, 10M+ vectors). ACID guarantees. Native filtering (e.g., "similar code in this repo only"). Distributed for horizontal scaling
- **Alternatives**: Milvus (GPU-accelerated), Weaviate (graph hybrid)
- **Status**: `PLANNED` — scaling milestone

### Milvus — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 35K+ stars
- **What**: GPU-accelerated vector database designed for billions of vectors
- **Why**: Extreme scale path. GPU acceleration for massive embedding collections. Overkill until 10K+ users with massive codebases
- **Status**: `OPTIONAL`

### ChromaDB — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 17K+ stars
- **What**: Developer-friendly vector database, in-process or client-server
- **Why**: Rapid prototyping and testing. Embedded mode (no server needed) for development
- **Status**: `OPTIONAL`

### LanceDB — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 5K+ stars
- **What**: Embedded, serverless vector database built on Lance columnar format
- **Why**: Zero-infra vector search for edge/local deployments. Could power local Project Brain for air-gapped customers
- **Status**: `OPTIONAL`

### Weaviate — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: BSD-3
- **GitHub**: 12K+ stars
- **What**: AI-native vector database with graph hybrid search and LLM integration
- **Why**: Built-in hybrid search (vector + keyword). Useful if we need more sophisticated retrieval beyond pure vector similarity
- **Status**: `OPTIONAL`

---

## 13. RAG & Code Intelligence

### tree-sitter — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 19K+ stars
- **What**: Incremental parsing library that builds concrete syntax trees for source code. Supports 100+ languages
- **Why**: Essential for code intelligence. Parse code into ASTs for: function extraction, dependency mapping, symbol resolution, and intelligent chunking for embeddings. Language-agnostic — works with any project regardless of tech stack
- **Status**: `PLANNED` — Sprint 3 (Project Brain)

### LlamaIndex — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 38K+ stars
- **What**: Data framework for LLM applications. Optimized for indexing, retrieval, and RAG pipelines
- **Why**: Code indexing pipeline for Project Brain. Handles document chunking, embedding generation, and retrieval. Optimized specifically for RAG (lower overhead than LangChain for pure retrieval)
- **Alternatives**: LangChain (more flexible, higher overhead), Haystack
- **Status**: `PLANNED`

### Haystack — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 18K+ stars
- **What**: LLM orchestration framework with debuggable, named pipelines
- **Why**: Lowest overhead (~5.9ms) for retrieval pipelines. Better debugging than LlamaIndex. Good for complex retrieval chains with multiple sources
- **Status**: `OPTIONAL`

### ast-grep — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 8K+ stars
- **What**: Rust-based structural code search and replace using AST patterns
- **Why**: Agent can search codebases structurally (e.g., "find all functions that call X") rather than text-based grep. Essential for intelligent code refactoring by the agent
- **Alternatives**: Semgrep (heavier, security-focused)
- **Status**: `PLANNED`

### Cognee — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 7K+ stars
- **What**: Knowledge engine combining vector search + graph database for AI memory
- **Why**: Powers the Project Brain knowledge graph. Extracts relationships from code (imports, calls, inheritance) and stores as queryable graph. Integrates with Memgraph for temporal context
- **Status**: `PLANNED` — Sprint 3

### Unstructured — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 10K+ stars
- **What**: Document parsing library (PDF, HTML, DOCX, images, etc.)
- **Why**: If agents need to process non-code documents (specs, designs, documentation) as part of task context
- **Status**: `OPTIONAL`

---

## 14. Knowledge Graph

### Neo4j — `CAN USE` — `OPTIONAL`
- **Version**: Latest Community Edition
- **License**: GPL-3.0 (Community), Commercial (Enterprise)
- **GitHub**: 14K+ stars
- **What**: Mature graph database with Cypher query language
- **Why**: Referenced in blueprint for code dependency mapping. Mature ecosystem with extensive tooling. However, heavier than needed at launch scale
- **Alternatives**: Memgraph (faster), ArangoDB (multi-model)
- **Status**: `OPTIONAL` — Cognee handles graph at launch

### Memgraph — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: BSL 1.1 (free for most uses)
- **GitHub**: 1K+ stars
- **What**: In-memory graph database with 41x lower latency than Neo4j. C++ core
- **Why**: Real-time code dependency queries. 100K insertions in 400ms vs Neo4j's 3.8s. Integrates with Cognee for the Project Brain knowledge graph. Better for operational/real-time analytics
- **Status**: `PLANNED` — Sprint 3

### ArangoDB — `CAN USE` — `OPTIONAL`
- **Version**: Latest Community
- **License**: Apache-2.0
- **GitHub**: 14K+ stars
- **What**: Multi-model database (document, graph, key-value, search)
- **Why**: Single database for graph + document needs. Compromises on pure graph performance but reduces operational complexity
- **Status**: `OPTIONAL`

---

## 15. Memory Systems

### Mem0 — `MUST USE` — `PLANNED`
- **Version**: mem0ai ^0.1.0
- **License**: Apache-2.0
- **GitHub**: 25K+ stars
- **What**: AI memory system with graph extraction + vector retrieval. Cross-session agent memory
- **Why**: Core of the Project Brain memory layer. Stores: framework choices, coding patterns, developer preferences, past decisions, failure patterns. Graph + vector hybrid means both semantic search AND relationship queries. Self-hosted for privacy
- **Memory types**: Architectural (patterns), Procedural (commands), Episodic (past sessions)
- **Status**: `PLANNED` — Sprint 3

### Letta / MemGPT — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 12K+ stars
- **What**: Stateful agent memory system. LLM-as-OS paradigm where memory is a first-class component
- **Why**: Persistent agent state across sessions. The agent "remembers" where it left off, what approaches worked/failed, and maintains a working memory of the current task. Better than Mem0 for long-running agent sessions
- **Status**: `PLANNED`

### Zep — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 3K+ stars
- **What**: Temporal/episodic memory for AI agents. Structures interactions as knowledge graphs with time awareness
- **Why**: Time-aware memory (e.g., "what changed since last week?"). Good for episodic recall of past agent interactions
- **Status**: `OPTIONAL`

---

## 16. Browser Automation

### browser-use — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 50K+ stars
- **What**: Turns any LLM into an autonomous browser agent with self-reasoning
- **Why**: Core browser automation for agents. Agent can: navigate websites, fill forms, click buttons, extract data, and verify UI changes visually. Used for visual debugging (screenshot → understand → fix) and documentation lookup
- **Status**: `PLANNED` — Sprint 4

### Playwright — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 70K+ stars
- **What**: Industry-standard browser automation. Multi-browser (Chromium, Firefox, WebKit). Fast, reliable
- **Why**: Foundation underneath browser-use. Also used for: agent-run E2E tests, browser preview panel in session UI, screenshot capture for visual verification. Playwright MCP for MCP protocol integration
- **Status**: `PLANNED` — Sprint 4

### Playwright MCP — `MUST USE` — `PLANNED`
- **Version**: @playwright/mcp
- **License**: Apache-2.0
- **What**: MCP server that exposes Playwright browser automation capabilities via Model Context Protocol
- **Why**: Allows the agent to control browsers through the standardized MCP protocol. Accessibility tree-based interaction (no screenshots needed for most operations)
- **Status**: `PLANNED` — Sprint 4

### Stagehand — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 10K+ stars
- **What**: AI browser automation with 3 APIs: act (perform actions), extract (get data), observe (understand page)
- **Why**: Simpler API than browser-use for common tasks. Built on Playwright. Good for structured data extraction from web pages
- **Status**: `OPTIONAL`

### Puppeteer — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 89K+ stars
- **What**: Chromium-only browser automation by Google
- **Why**: Lighter alternative to Playwright if only Chrome/Chromium is needed. Larger community but limited to one browser engine
- **Status**: `OPTIONAL`

---

## 17. Sandbox & Container Isolation

### Docker — `MUST USE` — `IN USE`
- **Version**: Latest
- **License**: Apache-2.0
- **What**: Container runtime. Every agent session gets a fresh Docker container
- **Why**: Core isolation layer. Pre-built sandbox image with Node.js, Python, common tools. Pre-warmed pool of 10 idle containers for instant session start. Auto-cleanup after session + 5 min grace period
- **Status**: `IN USE` — `docker-compose.yml`, sandbox images

### Dockerode — `MUST USE` — `IN USE`
- **Version**: 4.0.0
- **License**: Apache-2.0
- **GitHub**: 4K+ stars
- **What**: Docker API client for Node.js
- **Why**: Programmatic Docker container management in the Sandbox Manager service. Create, configure, monitor, and destroy agent containers
- **Status**: `IN USE` — `apps/sandbox-manager`

### gVisor (runsc) — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 17K+ stars
- **What**: Application kernel providing user-space kernel sandboxing for containers
- **Why**: Security hardening for agent sandboxes. Agent cannot escape container even with kernel exploits. Intercepts system calls in user space. Required for running untrusted code from any user's repository
- **Hardening**: Read-only filesystem (except /workspace, /tmp), cgroups (2 CPU, 2GB RAM, 10GB disk), no host network access
- **Status**: `PLANNED` — Sprint 1

### Firecracker — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 27K+ stars
- **What**: Lightweight microVMs by AWS. Strongest isolation (hardware virtualization)
- **Why**: Strongest possible sandbox isolation. Each agent gets a full microVM, not just a container. Required for SOC2/HIPAA compliance with untrusted code execution. E2B uses Firecracker underneath
- **Status**: `OPTIONAL` — enterprise security tier

### E2B — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 5K+ stars
- **What**: Firecracker-based sandbox platform purpose-built for AI code execution
- **Why**: Managed alternative to our self-hosted Docker + gVisor setup. Firecracker isolation out of the box. 24-hour session limit. Good for enterprise customers requiring strongest isolation without self-hosting
- **Status**: `OPTIONAL`

### Kata Containers — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 5K+ stars
- **What**: Hardware-virtualized containers using lightweight VMs
- **Why**: Alternative to Firecracker for strong isolation. Compatible with standard container orchestration (Kubernetes). Good middle ground between gVisor and Firecracker
- **Status**: `OPTIONAL`

### Daytona — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 14K+ stars
- **What**: Development environment manager with sub-90ms cold starts
- **Why**: Alternative sandbox approach. Docker-based with extremely fast cold starts. Weaker isolation than gVisor/Firecracker but faster startup
- **Status**: `OPTIONAL`

---

## 18. Code Analysis & Security

### Semgrep — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: LGPL-2.1
- **GitHub**: 11K+ stars
- **What**: Lightweight, pattern-based static analysis. Works at AST level across 30+ languages
- **Why**: Agent self-review step (Step 7). Before creating a PR, the agent runs Semgrep to catch: security vulnerabilities, code quality issues, common mistakes. Faster than CodeQL. Minimal dependencies
- **Status**: `PLANNED` — Sprint 6

### CodeQL — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT (CLI), Proprietary (analysis)
- **GitHub**: 8K+ stars
- **What**: GitHub's semantic code analysis engine. Most comprehensive security analysis
- **Why**: Deep security analysis for enterprise customers. Finds complex vulnerabilities that pattern-matching (Semgrep) misses. Free for open source
- **Status**: `OPTIONAL` — enterprise security feature

### ast-grep — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 8K+ stars
- **What**: Rust-based structural code search/replace on ASTs
- **Why**: Agent uses this for large-scale refactoring: "rename all instances of X across the codebase" structurally, not text-based. Faster and more accurate than regex-based find/replace
- **Status**: `PLANNED`

### Snyk — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Proprietary (free tier)
- **What**: Vulnerability scanning for dependencies, containers, and IaC
- **Why**: Sprint 6 security audit. Scans all npm/pip dependencies for known vulnerabilities. Container image scanning for sandbox images
- **Status**: `PLANNED` — Sprint 6

### ESLint 9 — `MUST USE` — `IN USE`
- **Version**: 9.20.0
- **License**: MIT
- **GitHub**: 25K+ stars
- **What**: JavaScript/TypeScript linter with flat config (eslint.config.js)
- **Why**: Code quality enforcement across the monorepo. Agent also runs ESLint as part of its execution loop (Step 4: run tests, linter, type checker after each change)
- **Status**: `IN USE` — `packages/config-eslint`

---

## 19. MCP Servers (Model Context Protocol)

### GitHub MCP — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **What**: MCP server for GitHub operations: create PRs, read issues, code search, repository management
- **Why**: Agent creates PRs after task completion (Step 6). Reads issues for task context. Code search across repos. Essential integration
- **Status**: `PLANNED` — Sprint 3

### Linear MCP — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **What**: MCP server for Linear project management: issues, cycles, sprints
- **Why**: Agent reads Linear tickets for task context, updates ticket status. High-velocity startup teams use Linear
- **Status**: `PLANNED` — Sprint 5

### Jira MCP — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **What**: MCP server for Jira: issues, sprints, workflows
- **Why**: Enterprise customers use Jira. Same integration pattern as Linear MCP but for Jira
- **Status**: `PLANNED` — Sprint 5

### Slack MCP — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **What**: MCP server for Slack: channel access, message posting, thread interaction
- **Why**: Tag @apex in Slack → creates task via n8n webhook. Notifications when tasks complete. Team collaboration
- **Status**: `PLANNED` — Sprint 5

### Playwright MCP — `MUST USE` — `PLANNED`
- **Version**: @playwright/mcp
- **License**: Apache-2.0
- **What**: Browser automation via MCP. Agent controls browser through standardized protocol
- **Why**: Agent can run Playwright tests, browse documentation, verify UI changes — all through MCP
- **Status**: `PLANNED` — Sprint 4

### Notion MCP — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **What**: MCP server for Notion: read/write pages, databases, comments
- **Why**: Agent can read project documentation from Notion. Write task summaries back to Notion
- **Status**: `OPTIONAL`

### Discord MCP — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **What**: MCP server for Discord: send messages, manage channels
- **Why**: Community integration. Agent notifications in Discord channels
- **Status**: `OPTIONAL`

---

## 20. Search

### PostgreSQL Full-Text Search — `MUST USE` — `IN USE`
- **Version**: Built into PostgreSQL 16
- **License**: PostgreSQL License
- **What**: Built-in full-text search with tsvector, tsquery, ranking
- **Why**: Adequate for basic search at 1K users. No extra service needed. Combined with pgvector for hybrid search (keyword + semantic)
- **Status**: `IN USE`

### Meilisearch — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 50K+ stars
- **What**: Rust-based instant search engine. Typo-tolerant, faceted, <1ms response
- **Why**: User-facing search: search tasks, sessions, repositories, codebase. Instant autocomplete. Typo tolerance (essential for code search). Ranked #1 search engine for 2026
- **Alternatives**: Typesense (C++, also excellent)
- **Status**: `PLANNED` — when PostgreSQL FTS isn't enough

### Typesense — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: GPL-3.0
- **GitHub**: 22K+ stars
- **What**: C++ search engine with built-in vector search, typo tolerance, geo search
- **Why**: Alternative to Meilisearch. Has built-in vector search (hybrid keyword + vector in one engine). Lightning-fast
- **Status**: `OPTIONAL`

---

## 21. Object Storage

### MinIO — `MUST USE` — `IN USE`
- **Version**: minio/minio:latest
- **License**: AGPL-3.0 (server), Apache-2.0 (client)
- **GitHub**: 50K+ stars
- **What**: S3-compatible object storage. Self-hosted, high-performance
- **Why**: Development and self-hosted production object storage. Stores: agent session artifacts, sandbox snapshots, PR screenshots, user uploads. S3-compatible API works with any S3 client
- **Status**: `IN USE` — `docker-compose.yml`

### Cloudflare R2 — `SHOULD USE` — `PLANNED`
- **Version**: N/A (managed service)
- **License**: Proprietary
- **What**: S3-compatible object storage with zero egress fees
- **Why**: Production object storage. ~$10/month for 500GB. Zero egress fees (huge savings vs S3). S3-compatible so same code works with MinIO (dev) and R2 (production)
- **Status**: `PLANNED` — production deployment

---

## 22. Email & Notifications

### React Email — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 15K+ stars
- **What**: React component library for building email templates
- **Why**: Build email templates as React components. Type-safe, preview-able, version-controlled. Used for: PR ready notifications, task failed alerts, credit low warnings, weekly digest
- **Status**: `PLANNED` — Sprint 5

### Resend — `SHOULD USE` — `PLANNED`
- **Version**: resend ^4.0.0
- **License**: Proprietary (free tier: 100 emails/day)
- **What**: Developer-first email platform. Built by the React Email team
- **Why**: Production email delivery. Simple API, high deliverability, React Email integration. ~$20/month at scale
- **Alternatives**: Nodemailer + SMTP (self-hosted), SendGrid, Postmark
- **Status**: `PLANNED` — Sprint 5

### Nodemailer — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 17K+ stars
- **What**: Zero-dependency SMTP email client for Node.js
- **Why**: Self-hosted alternative to Resend. Use with React Email templates for air-gapped/enterprise deployments where external email services aren't allowed
- **Status**: `OPTIONAL`

---

## 23. Payments & Billing

### Stripe — `MUST USE` — `PLANNED`
- **Version**: stripe ^17.0.0 (server), @stripe/stripe-js ^4.0.0 (client)
- **License**: Proprietary
- **What**: Payment processing, subscriptions, invoicing
- **Why**: Handles all 5 pricing tiers (Hobby free → Enterprise custom). Subscription management, payment UI (Stripe Elements), webhooks for payment events. Industry standard
- **Status**: `PLANNED` — Sprint 5

### Orb — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Proprietary
- **What**: Usage-based billing and metering platform
- **Why**: Powers the credit system. Tracks credit consumption per task, per user, per model. Integrates with Stripe for unified billing. Shows real-time credit balance. Handles credit rollover, per-task limits, model overrides (2x credits for Opus)
- **Alternatives**: Custom credit tracking in PostgreSQL (simpler but more work)
- **Status**: `PLANNED` — Sprint 5

---

## 24. Monitoring & Observability

### OpenTelemetry — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 5K+ stars (JS SDK)
- **What**: Vendor-neutral telemetry standard for traces, metrics, and logs. 73% adoption rate
- **Why**: Unified instrumentation across all 9 microservices. Auto-instrumentation for Hono, tRPC, PostgreSQL, Redis. Exports to Prometheus (metrics), Grafana Tempo (traces), Loki (logs). Switch backends without code changes
- **Status**: `PLANNED`

### Prometheus — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 57K+ stars
- **What**: Metrics collection and alerting. Pull-based model, PromQL query language
- **Why**: Collects metrics from all services: request latency, agent session duration, credit consumption rate, container resource usage, LLM response times. Alerting for SLO breaches
- **Status**: `PLANNED`

### Grafana — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 67K+ stars
- **What**: Unified visualization for metrics (Prometheus), logs (Loki), and traces (Tempo)
- **Why**: Single dashboard for all observability. Agent session monitoring, infrastructure health, LLM cost tracking, error rates. The oncall dashboard for production monitoring
- **Status**: `PLANNED`

### Sentry — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: FSL (functional source license)
- **GitHub**: 40K+ stars
- **What**: Error tracking, performance monitoring, session replay
- **Why**: Catches every error across frontend and all backend services. Stack traces, breadcrumbs, user context. Session replay for debugging user-reported issues. Critical for a multi-service architecture
- **Status**: `PLANNED` — Sprint 6

### Pino — `MUST USE` — `IN USE`
- **Version**: 9.6.0
- **License**: MIT
- **GitHub**: 14K+ stars
- **What**: Fastest JSON logger for Node.js. Structured logging
- **Why**: Structured JSON logs from all services. pino-pretty for development. Feeds into Loki/Axiom for production log aggregation
- **Includes**: pino 9.6.0, pino-pretty 13.0.0
- **Status**: `IN USE` — `packages/logger`

### Axiom — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Proprietary (free tier: 500GB/month)
- **What**: Log aggregation and analytics platform
- **Why**: Alternative to self-hosted Loki. Zero-config log ingestion, powerful query language. Good for early stage before setting up full Grafana stack
- **Status**: `OPTIONAL`

### Loki — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 24K+ stars
- **What**: Log aggregation system by Grafana Labs. Like Prometheus but for logs
- **Why**: Production log aggregation. Integrates natively with Grafana for unified metrics + logs dashboard. Label-based indexing (efficient, cost-effective)
- **Status**: `PLANNED`

---

## 25. CI/CD & Build

### GitHub Actions — `MUST USE` — `PLANNED`
- **Version**: N/A
- **License**: Proprietary (free tier: 2000 min/month for public repos)
- **What**: CI/CD pipelines integrated with GitHub. 15K+ reusable actions
- **Why**: Standard, reliable, free for public repos. Build, test, deploy on every push. Docker image building and publishing. Integration testing with docker-compose
- **Status**: `PLANNED` — Sprint 1

### Turbo — `MUST USE` — `IN USE`
- **Version**: 2.5.0
- **License**: MIT
- **GitHub**: 27K+ stars
- **What**: High-performance monorepo build system. Remote caching, parallel execution, task pipelines
- **Why**: Orchestrates builds across 9 apps and 13 packages. Remote cache means CI builds only rebuild what changed. Parallel execution of independent tasks
- **Status**: `IN USE` — `turbo.json`

### Dagger — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 12K+ stars
- **What**: Portable CI pipeline engine. Write CI in Python/Go/TypeScript, run anywhere
- **Why**: Escape GitHub Actions vendor lock-in. Same pipeline runs locally and in any CI. Containerized builds for reproducibility
- **Status**: `OPTIONAL`

### Docker Hub / GHCR — `MUST USE` — `PLANNED`
- **Version**: N/A
- **License**: Proprietary (free for public)
- **What**: Container image registries
- **Why**: Publish sandbox Docker images, service images for deployment. GHCR (GitHub Container Registry) integrates with GitHub Actions
- **Status**: `PLANNED`

---

## 26. Infrastructure & Hosting

### Fly.io — `MUST USE` — `PLANNED`
- **Version**: N/A
- **License**: Proprietary
- **What**: Persistent server hosting with global edge deployment, Docker-native
- **Why**: Primary hosting platform. Runs actual VMs (not serverless) — required for WebSockets, long-lived agent containers. Global edge for low latency. Est. cost: ~$385/month for 1K users
- **Services**: APEX Web ($80), Agent Orchestrator ($160), Sandbox Manager ($160), claude-code-router ($15), Project Brain ($40)
- **Status**: `PLANNED`

### Hetzner — `SHOULD USE` — `PLANNED`
- **Version**: N/A
- **License**: N/A
- **What**: EU cloud hosting with dedicated servers, VPS, and GPU servers
- **Why**: EU privacy compliance. Cost-optimized: ~€295/month ($325) for full stack. GPU servers (2× NVIDIA A30, 64GB RAM) for local model serving at ~€800/month. Break-even vs API costs at 500+ heavy users
- **Status**: `PLANNED` — EU deployment + GPU infrastructure

### Coolify — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 50K+ stars
- **What**: Self-hosted PaaS (Vercel/Heroku alternative). One-click deployments, automatic SSL, monitoring
- **Why**: Self-hosted deployment dashboard for Hetzner servers. Deploy and manage all services from a web UI. Good for enterprise customers who want to self-host the entire APEX stack
- **Status**: `OPTIONAL`

### Kamal — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 12K+ stars
- **What**: Deploy web apps anywhere with zero downtime. By 37signals (Basecamp/HEY)
- **Why**: Production deployment tool for Hetzner/bare metal servers. Docker-based, zero-downtime deploys, rolling restarts. Powers Basecamp and HEY in production
- **Status**: `OPTIONAL`

### Dokku — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 30K+ stars
- **What**: Docker-powered mini-Heroku. Git push to deploy
- **Why**: Simplest self-hosted PaaS. Good for single-server deployments (MVP/staging). Heroku-like git push workflow
- **Status**: `OPTIONAL`

### Cloudflare — `MUST USE` — `PLANNED`
- **Version**: N/A
- **License**: Proprietary (generous free tier)
- **What**: CDN, DDoS protection, DNS, Workers (edge compute)
- **Why**: Free DDoS protection, edge caching for static assets, DNS management, SSL. Workers for edge logic (auth checks, rate limiting). R2 for object storage (zero egress)
- **Status**: `PLANNED`

---

## 27. Kubernetes & Scaling (3K+ Users)

### k3s — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 29K+ stars
- **What**: Lightweight Kubernetes distribution. Single binary, <100MB, production-ready
- **Why**: Container orchestration at scale. Auto-scaling sandbox pools, multi-region deployment, rolling updates. Not needed until 3K+ users. k3s is lighter than full k8s, perfect for our scale
- **Status**: `PLANNED` — 3K+ users milestone

### KEDA — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 9K+ stars
- **What**: Kubernetes-based event-driven autoscaling. Scale based on BullMQ queue depth, CPU, custom metrics
- **Why**: Auto-scale sandbox containers based on agent session demand. Scale to zero when idle, burst to 100+ during peak. Event-driven (not just CPU-based)
- **Status**: `PLANNED` — 3K+ users

### Traefik — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 53K+ stars
- **What**: Modern reverse proxy and ingress controller with auto-discovery, SSL, and load balancing
- **Why**: Kubernetes ingress controller. Automatic service discovery, Let's Encrypt SSL, WebSocket support, middleware (rate limiting, auth). Lighter than NGINX for our use case
- **Status**: `PLANNED` — 3K+ users

---

## 28. API Rate Limiting & Gateway

### Upstash Ratelimit — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 2K+ stars
- **What**: Serverless rate limiting built on Upstash Redis. Token bucket and sliding window algorithms
- **Why**: API rate limiting and abuse prevention. Per-user limits (free tier: 5 tasks/day), per-endpoint limits, DDoS protection. Serverless — no extra infrastructure
- **Status**: `PLANNED` — Sprint 6

### Unkey — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 4K+ stars
- **What**: API key management + rate limiting. Sub-millisecond verification
- **Why**: If we need API key management (for API access beyond the web UI). Key issuance, per-key rate limits, usage analytics, key rotation
- **Status**: `OPTIONAL`

### Kong — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 40K+ stars
- **What**: Enterprise API gateway with built-in rate limiting, auth, logging, gRPC/WebSocket/GraphQL support
- **Why**: Enterprise-grade API gateway if we need centralized API management. Built-in Redis-backed rate limiting. Overkill at launch but valuable at enterprise scale
- **Status**: `OPTIONAL` — enterprise

---

## 29. Workflow Automation & Integrations

### n8n — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Sustainable Use License (free self-hosted)
- **GitHub**: 55K+ stars
- **What**: Visual workflow automation with 400+ integrations. Code + no-code hybrid
- **Why**: Powers integration orchestration: Slack → n8n → APEX session auto-created. GitHub webhook → n8n → task creation. AI-native nodes for LLM workflows. Self-hosted for privacy
- **Status**: `PLANNED` — Sprint 5

### Webhooks — `MUST USE` — `PLANNED`
- **Version**: N/A (custom implementation)
- **What**: HTTP callbacks for event-driven integrations
- **Why**: Universal integration point. Any external service can trigger APEX tasks via webhook. Used for: git push → re-index, Slack mention → create task, CI failure → diagnose
- **Status**: `PLANNED`

---

## 30. Development Tools

### pnpm 10 — `MUST USE` — `IN USE`
- **Version**: 10.32.1
- **License**: MIT
- **GitHub**: 30K+ stars
- **What**: Fast, disk-efficient package manager. Content-addressable store, workspace support
- **Why**: Monorepo package management. Workspace protocol for internal packages. 3x faster than npm, efficient disk usage via hard links
- **Status**: `IN USE` — `pnpm-workspace.yaml`

### tsx — `MUST USE` — `IN USE`
- **Version**: 4.19.0
- **License**: MIT
- **GitHub**: 10K+ stars
- **What**: TypeScript execute — run .ts files directly with no config
- **Why**: Development scripts, one-off tasks, service dev mode. Faster than ts-node, zero config
- **Status**: `IN USE`

### tsup — `MUST USE` — `IN USE`
- **Version**: 8.4.0
- **License**: MIT
- **GitHub**: 9K+ stars
- **What**: TypeScript bundler powered by esbuild. Zero config, fast builds
- **Why**: Bundles all backend services (api, orchestrator, sandbox-manager, etc.) for production. <1s build times
- **Status**: `IN USE` — all backend apps

### Prettier — `MUST USE` — `IN USE`
- **Version**: 3.5.0
- **License**: MIT
- **GitHub**: 50K+ stars
- **What**: Opinionated code formatter
- **Why**: Consistent formatting across the monorepo. No style debates
- **Status**: `IN USE`

### Zod — `MUST USE` — `IN USE`
- **Version**: 3.24.0
- **License**: MIT
- **GitHub**: 36K+ stars
- **What**: TypeScript-first schema validation with static type inference
- **Why**: Used everywhere: API input validation (tRPC), environment variables, agent task schemas, form validation, drizzle-zod for DB schema validation. Single validation library across the stack
- **Status**: `IN USE` — `packages/validators` + everywhere

### nanoid — `MUST USE` — `IN USE`
- **Version**: 5.1.0
- **License**: MIT
- **GitHub**: 25K+ stars
- **What**: Tiny, secure, URL-friendly unique ID generator
- **Why**: Generate IDs for sessions, tasks, API keys. Smaller and faster than UUID. URL-safe
- **Status**: `IN USE` — `packages/utils`

### superjson — `MUST USE` — `IN USE`
- **Version**: 2.2.0
- **License**: MIT
- **GitHub**: 4K+ stars
- **What**: JSON serializer that handles Date, Map, Set, BigInt, RegExp, undefined
- **Why**: tRPC data transformer. Serializes complex types across the API boundary (dates, sets, etc.)
- **Status**: `IN USE` — `apps/api`

---

## 31. LLM Models (Free / Open Source)

### DeepSeek V3 (deepseek-chat) — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: DeepSeek License
- **Cost**: $0.27/M input, $1.10/M output
- **What**: High-quality coding model. Default route for 90%+ of coding tasks
- **Why**: Best cost/quality ratio for code generation. 10-50x cheaper than Claude/GPT for routine coding tasks. Powers the `default` route slot
- **Status**: `PLANNED` — default model route

### DeepSeek R1 — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: DeepSeek License
- **Cost**: $0.55/M input, $2.19/M output
- **What**: Reasoning-focused model for planning and architecture decisions
- **Why**: Powers the `think` route slot. Plan Mode, architecture decisions, complex debugging. Chain-of-thought reasoning
- **Status**: `PLANNED` — think model route

### Claude Sonnet 4.6 (Anthropic) — `MUST USE` — `PLANNED`
- **Version**: claude-sonnet-4-6
- **License**: Proprietary API
- **Cost**: ~$3/M input, $15/M output
- **What**: Anthropic's balanced model. Strong at code review, security analysis, and vision
- **Why**: Powers `vision` (screenshot → code), `review` (PR security check), and `think` (fallback) route slots. Best at nuanced code review and security vulnerability detection
- **Status**: `PLANNED`

### Claude Opus 4.6 (Anthropic) — `CAN USE` — `PLANNED`
- **Version**: claude-opus-4-6
- **License**: Proprietary API
- **Cost**: ~$15/M input, $75/M output
- **What**: Anthropic's most capable model. 1M context window
- **Why**: `premium` route slot for power users who want the best model. 2× credits charged. Used when users explicitly select premium quality
- **Status**: `PLANNED` — premium route

### Gemini 2.0 Flash — `MUST USE` — `PLANNED`
- **Version**: Latest
- **License**: Proprietary API (generous free tier)
- **Cost**: FREE (up to quota)
- **What**: Google's fast model with massive context window
- **Why**: Powers `longContext` (>40K tokens — reading large codebases) and `webSearch` (documentation lookup, error research) route slots. FREE tier makes these operations cost nothing
- **Status**: `PLANNED` — longContext + webSearch routes

### Qwen3-Coder-Next — `CAN USE` — `OPTIONAL`
- **Version**: 80B MoE (40GB RAM)
- **License**: Apache-2.0
- **What**: Alibaba's coding-specialized model. Mixture of Experts architecture
- **Why**: Best open source coding model for local serving. 80B MoE means only ~40GB RAM needed. Run via Ollama/vLLM for air-gapped enterprise
- **Status**: `OPTIONAL` — local model option

### Qwen2.5-Coder — `SHOULD USE` — `PLANNED`
- **Version**: 7B / 14B / 32B variants
- **License**: Apache-2.0
- **What**: Open source coding model family. Multiple sizes for different hardware
- **Why**: `background` route slot via Ollama. Free (electricity only). Repo indexing, embeddings, search. 32B variant for capable local coding. 7B for resource-constrained environments
- **Status**: `PLANNED` — background model route

### DeepSeek-R1 (Local) — `CAN USE` — `OPTIONAL`
- **Version**: 32B distill
- **License**: DeepSeek License
- **What**: Distilled reasoning model for local deployment
- **Why**: Local reasoning model for air-gapped enterprise. Smaller than full R1 but retains reasoning capabilities
- **Status**: `OPTIONAL`

### Llama 3.2 — `CAN USE` — `OPTIONAL`
- **Version**: 3B
- **License**: Meta Llama License
- **What**: Meta's small language model
- **Why**: Ultra-lightweight local model for simple tasks (autocomplete, classification). Runs on CPU only
- **Status**: `OPTIONAL`

### Nomic Embed Text — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **What**: Open source text embedding model. Runs locally via Ollama
- **Why**: Generate code embeddings locally for free. No API costs for embedding generation. Good quality for code similarity search
- **Status**: `PLANNED` — via Ollama

---

## 32. Testing

### Vitest — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 14K+ stars
- **What**: Vite-native test framework. Jest-compatible API, ESM-first, TypeScript native
- **Why**: Unit and integration testing across the monorepo. Fastest test runner for Vite/TypeScript projects. Works with React Testing Library for component tests
- **Alternatives**: Jest (slower, CJS-first)
- **Status**: `PLANNED`

### Playwright Test — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **What**: E2E testing framework built on Playwright
- **Why**: End-to-end tests for the web app. Multi-browser testing. Also used by agents to run E2E tests on user codebases
- **Status**: `PLANNED`

### k6 — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 27K+ stars
- **What**: Load testing tool by Grafana Labs. Write tests in JavaScript
- **Why**: Sprint 6 load testing — simulate 50 concurrent agent sessions. Verify system stability at peak load. Integrates with Grafana for result visualization
- **Status**: `PLANNED` — Sprint 6

---

## Technology Count Summary

| Classification | Count |
|---------------|-------|
| **MUST USE** | 48 |
| **SHOULD USE** | 39 |
| **CAN USE** | 38 |
| **Total Technologies** | **125** |

| Status | Count |
|--------|-------|
| **IN USE** (already in codebase) | 28 |
| **PLANNED** (scheduled for implementation) | 68 |
| **OPTIONAL** (evaluate when needed) | 29 |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│  Next.js 15 + shadcn/ui + AI Elements + Tailwind v4 + Zustand  │
│  React Query + tRPC Client + Socket.io Client + Framer Motion   │
└────────────────────┬────────────────────────────────────────────┘
                     │ SSE / WebSocket / tRPC
┌────────────────────┴────────────────────────────────────────────┐
│                     API LAYER                                    │
│  Hono + tRPC Server + Clerk Auth + Zod Validation               │
│  Upstash Ratelimit + Stripe Webhooks + Cloudflare CDN           │
└──┬──────────┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │          │
┌──┴──┐  ┌───┴──┐  ┌───┴───┐  ┌──┴──┐  ┌───┴────┐
│Orch.│  │Sand- │  │Model  │  │Proj.│  │MCP     │
│     │  │box   │  │Router │  │Brain│  │Gateway │
│Open │  │Mgr   │  │       │  │     │  │        │
│Hands│  │Docker│  │claude │  │tree-│  │GitHub  │
│Lang │  │+gVis │  │-code- │  │sitter│ │Linear  │
│Graph│  │or    │  │router │  │Cognee│ │Jira    │
│     │  │      │  │LiteLLM│  │pgvec│  │Slack   │
└──┬──┘  └──┬───┘  └──┬────┘  └──┬──┘  └───┬────┘
   │        │         │          │          │
┌──┴────────┴─────────┴──────────┴──────────┴─────────────────────┐
│                     DATA LAYER                                    │
│  PostgreSQL 16 + pgvector │ Redis/Valkey │ MinIO/R2 │ Memgraph  │
│  Drizzle ORM │ BullMQ │ Mem0 │ Letta │ Meilisearch             │
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────────┐
│                     LLM PROVIDERS                                │
│  DeepSeek V3/R1 │ Claude Sonnet/Opus │ Gemini Flash │ Ollama   │
│  Qwen2.5-Coder │ Groq │ Cerebras │ OpenRouter │ Mistral       │
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────────┐
│                     INFRASTRUCTURE                               │
│  Fly.io │ Hetzner │ Cloudflare │ GitHub Actions │ Docker        │
│  k3s + KEDA + Traefik (at scale)                                │
│  OpenTelemetry + Prometheus + Grafana + Sentry + Pino + Loki    │
└─────────────────────────────────────────────────────────────────┘
```

---

> **This document is the single source of truth for all technology decisions in the Prometheus/APEX project.**
> Update it as technologies are evaluated, adopted, or replaced.
