# PROMETHEUS — System Architecture

> **Last updated:** 2026-03-20
> **Classification:** Internal Engineering Reference
> **Audience:** Engineers, SREs, and technical stakeholders

---

## Table of Contents

1. [High-Level System Overview](#1-high-level-system-overview)
2. [Request Lifecycle](#2-request-lifecycle)
3. [Service Interaction Map](#3-service-interaction-map)
4. [Database Schema](#4-database-schema)
5. [Real-Time Event Architecture](#5-real-time-event-architecture)
6. [Agent Execution Pipeline](#6-agent-execution-pipeline)
7. [Agent Composition & Multi-Agent Patterns](#7-agent-composition--multi-agent-patterns)
8. [Model Routing Decision Tree](#8-model-routing-decision-tree)
9. [Cost Optimization System](#9-cost-optimization-system)
10. [Scaling Architecture (1000+ Users)](#10-scaling-architecture-1000-users)
11. [Security & Isolation Model](#11-security--isolation-model)
12. [Credit & Billing Flow](#12-credit--billing-flow)
13. [Deployment Topology](#13-deployment-topology)
14. [Memory System (8 Layers)](#14-memory-system-8-layers)
15. [Governance & Compliance Engine](#15-governance--compliance-engine)
16. [Self-Play Training Pipeline](#16-self-play-training-pipeline)
17. [Plugin Architecture](#17-plugin-architecture)
18. [IDE & Voice Integration](#18-ide--voice-integration)
19. [Capacity Planning](#19-capacity-planning)
20. [Performance Targets & SLOs](#20-performance-targets--slos)
21. [Appendix: Key File Reference](#21-appendix-key-file-reference)

---

## 1. High-Level System Overview

Prometheus is an AI-powered engineering platform with 12 specialist agents that autonomously handle software development tasks — from requirements discovery through deployment. The platform is built as a **Turborepo monorepo** with **pnpm workspaces**, containing 9 application services and 28 shared packages.

### System Topology

```mermaid
graph TD
    subgraph "Client Layer"
        Browser["Browser<br/>(Next.js 16 / React 19)"]
    end

    subgraph "Edge / Ingress"
        Traefik["Traefik<br/>Reverse Proxy + TLS"]
    end

    subgraph "User-Facing Services"
        Web["web<br/>:3000<br/>Next.js Frontend"]
        API["api<br/>:4000<br/>tRPC + Hono"]
        Socket["socket-server<br/>:4001<br/>Socket.io + SSE"]
    end

    subgraph "Core Processing Services"
        Orchestrator["orchestrator<br/>:4002<br/>Agent Lifecycle"]
        QueueWorker["queue-worker<br/>BullMQ Consumer"]
        ModelRouter["model-router<br/>:4004<br/>LLM Routing"]
        SandboxMgr["sandbox-manager<br/>:4006<br/>Container Isolation"]
    end

    subgraph "Support Services"
        MCPGateway["mcp-gateway<br/>:4005<br/>External Integrations"]
        ProjectBrain["project-brain<br/>:4003<br/>Memory + Context"]
    end

    subgraph "IDE / Extensions"
        VSCode["VS Code Extension"]
        CLI["CLI Tool"]
    end

    subgraph "Data Layer"
        PG["PostgreSQL 16<br/>+ pgvector<br/>:5432"]
        Redis["Redis / Valkey 8<br/>:6379"]
        MinIO["MinIO<br/>:9000<br/>Object Storage"]
    end

    Browser --> Traefik
    Traefik --> Web
    Traefik --> API
    Traefik --> Socket

    API --> PG
    API --> Redis
    API --> QueueWorker

    QueueWorker --> Orchestrator
    Orchestrator --> ModelRouter
    Orchestrator --> SandboxMgr
    Orchestrator --> ProjectBrain
    Orchestrator --> Redis

    ModelRouter --> |"Ollama / Cerebras<br/>Groq / Gemini<br/>Anthropic / OpenAI<br/>DeepSeek"| LLMProviders["LLM Providers"]

    ProjectBrain --> PG
    ProjectBrain --> Redis

    MCPGateway --> |"GitHub / GitLab<br/>Linear / Jira<br/>Slack / Vercel<br/>Figma / Notion"| ExtServices["External Services"]

    Socket --> Redis
    SandboxMgr --> Docker["Docker Engine"]
```

### Monorepo Structure

```
prometheus/
├── apps/                          # 9 services
│   ├── web/                       # Next.js 16 frontend (port 3000)
│   ├── api/                       # tRPC v11 + Hono backend (port 4000)
│   ├── socket-server/             # Socket.io real-time relay (port 4001)
│   ├── orchestrator/              # Agent lifecycle management (port 4002)
│   ├── queue-worker/              # BullMQ job consumer
│   ├── model-router/              # Multi-provider LLM routing (port 4004)
│   ├── sandbox-manager/           # Container isolation (port 4006)
│   ├── mcp-gateway/               # MCP external integrations (port 4005)
│   └── project-brain/             # Memory + context assembly (port 4003)
├── packages/                      # 28 shared packages
│   ├── db/                        # Drizzle ORM schemas + migrations (33 tables, 28 enums)
│   ├── ai/                        # LLM client + model registry (9 providers, 40+ models)
│   ├── agent-sdk/                 # Agent role definitions + 30+ tools
│   ├── billing/                   # Stripe integration, plan tiers + credit costs
│   ├── queue/                     # BullMQ queue definitions (11 job types)
│   ├── validators/                # Zod schemas for all domains
│   ├── logger/                    # Pino structured logging with AsyncLocalStorage
│   ├── utils/                     # Shared utilities (generateId, encryption, circuit breaker)
│   ├── types/                     # Centralized TypeScript type definitions
│   ├── auth/                      # Clerk integration, SSO (OIDC/SAML), SCIM, FGA
│   ├── telemetry/                 # OpenTelemetry + Sentry + Prometheus metrics
│   ├── workflow/                  # Inngest workflow orchestration
│   ├── plugins/                   # Plugin SDK, marketplace, hot-loading
│   ├── notifications/             # Multi-channel notification system (Novu)
│   ├── feature-flags/             # Deterministic feature flag evaluation
│   ├── email/                     # Template-based email service (Resend)
│   ├── voice/                     # Speech recognition + TTS
│   ├── collaboration/             # Yjs CRDT collaborative editing
│   ├── code-intelligence/         # Tree-sitter parsing, AST analysis, call graphs
│   ├── architecture-graph/        # Architecture visualization + dependency analysis
│   ├── ci-integration/            # GitHub Actions + GitLab CI integration
│   ├── cli/                       # Command-line interface
│   ├── vscode-extension/          # VS Code IDE integration
│   ├── ui/                        # React component library (Radix UI + Tailwind)
│   ├── test-utils/                # Test fixtures, mock factories
│   ├── config-typescript/         # Shared tsconfig
│   ├── config-tailwind/           # Tailwind CSS config + design tokens
│   └── config-stacks/             # Tech stack presets
├── infra/                         # Infrastructure
│   ├── docker/                    # Dockerfile.base, Dockerfile.api, Dockerfile.web
│   └── k8s/base/                  # Kubernetes manifests (HPA, KEDA, Traefik)
└── docker-compose.yml             # Local development stack
```

### Communication Protocols

| Protocol | Used Between | Purpose |
|----------|-------------|---------|
| **tRPC over HTTP** | Browser ↔ API | Type-safe RPC for all CRUD operations |
| **Socket.io (WebSocket)** | Browser ↔ Socket Server | Real-time bidirectional events |
| **SSE** | Browser ↔ API | Streaming agent session output |
| **HTTP/JSON** | API ↔ Internal services | Inter-service communication |
| **Redis Pub/Sub** | Orchestrator ↔ Socket Server | Event relay for real-time updates |
| **BullMQ (Redis)** | API → Queue Worker | Async task scheduling |
| **OpenAI-compatible HTTP** | Model Router → LLM Providers | LLM completions |
| **Docker Engine API** | Sandbox Manager → Docker | Container lifecycle |

---

## 2. Request Lifecycle

This diagram traces the complete path of a user-submitted task — from browser click through agent execution to real-time result streaming.

```mermaid
sequenceDiagram
    participant User as Browser (React 19)
    participant Traefik as Traefik
    participant Web as web :3000
    participant API as api :4000
    participant Clerk as Clerk Auth
    participant PG as PostgreSQL
    participant Redis as Redis/Valkey
    participant BullMQ as BullMQ Queue
    participant QW as queue-worker
    participant TR as TaskRouter
    participant AL as AgentLoop
    participant MR as model-router :4004
    participant LLM as LLM Provider
    participant SM as sandbox-manager :4006
    participant PB as project-brain :4003
    participant Socket as socket-server :4001

    Note over User,Socket: Phase 1 — Task Submission
    User->>Traefik: POST /trpc/tasks.submit
    Traefik->>API: Route to api service
    API->>Clerk: Verify JWT + extract userId/orgId
    Clerk-->>API: Auth context (userId, orgId, role)
    API->>API: Zod validation (taskSchema)

    Note over User,Socket: Phase 2 — Credit Reservation
    API->>PG: SELECT balance, reserved FROM creditBalances WHERE orgId
    PG-->>API: { balance: 500, reserved: 50 }
    API->>API: Check: balance - reserved >= taskCost
    API->>PG: INSERT creditReservation (res_*, amount, status='active')
    API->>PG: UPDATE creditBalances SET reserved += amount

    Note over User,Socket: Phase 3 — Enqueue Task
    API->>PG: INSERT task (status='queued')
    API->>BullMQ: queue.add('agent-tasks', { taskId, projectId, orgId })
    API-->>User: 202 Accepted { taskId, queuePosition }

    Note over User,Socket: Phase 4 — Queue Processing
    QW->>BullMQ: process('agent-tasks', concurrency: 2)
    BullMQ-->>QW: Job { taskId, projectId }
    QW->>PG: UPDATE task SET status='running'

    Note over User,Socket: Phase 5 — Task Routing
    QW->>TR: route(task.description)
    TR->>TR: Regex pattern matching
    TR-->>QW: { agentRole: 'backend_coder', confidence: 0.85 }

    Note over User,Socket: Phase 6 — Context Assembly
    QW->>PB: POST /context/assemble { projectId, task, agentRole }
    PB->>PG: Semantic search (pgvector cosine similarity)
    PB->>PG: Knowledge graph query (dependencies)
    PB->>PG: Episodic memories (past decisions)
    PB->>Redis: Working memory (session state)
    PB-->>QW: AssembledContext { sections[], tokenEstimate: ~14000 }

    Note over User,Socket: Phase 7 — Agent Execution Loop (max 50 iterations)
    QW->>AL: start(agentRole, context, task)
    loop Each Iteration (1..50)
        AL->>MR: POST /route { slot, messages }
        MR->>MR: Check rate limits (sliding window)
        MR->>LLM: Chat completion request
        LLM-->>MR: Response { content, tool_calls[] }
        MR-->>AL: Completion result

        alt Has Tool Calls
            AL->>SM: Execute tool (file_write, terminal_exec, etc.)
            SM->>SM: Run in isolated Docker container
            SM-->>AL: Tool result
        end

        AL->>Redis: PUBLISH session:{id}:events { type, data }
    end

    Note over User,Socket: Phase 8 — Real-Time Streaming
    Redis-->>Socket: Subscribe session:{id}:events
    Socket-->>User: WebSocket emit('session:event', data)

    Note over User,Socket: Phase 9 — Completion
    AL-->>QW: AgentResult { status: 'completed', output }
    QW->>PG: UPDATE task SET status='completed'
    QW->>PG: UPDATE creditReservation SET status='committed'
    QW->>PG: INSERT creditTransaction (type='consumption')
    QW->>PG: UPDATE creditBalances SET balance -= cost, reserved -= amount
    QW->>Redis: PUBLISH session:{id}:events { type: 'task_status', status: 'completed' }
```

### Phase Breakdown

| Phase | Duration Target | Key Operations |
|-------|----------------|----------------|
| 1. Submission | < 100ms | Traefik routing, JWT verification, Zod validation |
| 2. Credit Reservation | < 50ms | Balance check, atomic reservation |
| 3. Enqueue | < 50ms | Task INSERT, BullMQ add |
| 4. Queue Processing | < 30s p95 | Worker picks up job |
| 5. Task Routing | < 10ms | Regex pattern matching |
| 6. Context Assembly | < 500ms | Vector search, graph query, memory recall |
| 7. Agent Loop | 30s – 10min | 1-50 LLM iterations with tool execution |
| 8. Event Streaming | < 100ms | Redis pub/sub → Socket.io relay |
| 9. Completion | < 100ms | Credit commit, status update |

---

## 3. Service Interaction Map

```mermaid
graph LR
    subgraph "Frontend"
        Web["web :3000"]
    end

    subgraph "API Gateway"
        API["api :4000"]
        SSE["SSE Endpoint"]
    end

    subgraph "Real-Time"
        Socket["socket-server :4001"]
    end

    subgraph "Processing"
        QW["queue-worker"]
        Orch["orchestrator"]
    end

    subgraph "AI"
        MR["model-router :4004"]
    end

    subgraph "Isolation"
        SM["sandbox-manager :4006"]
    end

    subgraph "Integrations"
        MCP["mcp-gateway :4005"]
    end

    subgraph "Memory"
        PB["project-brain :4003"]
    end

    subgraph "Data"
        PG["PostgreSQL :5432"]
        Redis["Redis :6379"]
        MinIO["MinIO :9000"]
    end

    Web -->|"tRPC HTTP"| API
    Web -->|"WebSocket"| Socket
    Web -->|"SSE Stream"| SSE

    API -->|"Drizzle ORM"| PG
    API -->|"BullMQ add"| Redis
    API -->|"Session pub/sub"| Redis

    SSE -->|"Subscribe"| Redis

    Socket -->|"Subscribe"| Redis
    Socket -->|"Adapter"| Redis

    QW -->|"BullMQ process"| Redis
    QW -->|"HTTP"| Orch

    Orch -->|"POST /route"| MR
    Orch -->|"POST /context/assemble"| PB
    Orch -->|"POST /exec"| SM
    Orch -->|"PUBLISH events"| Redis
    Orch -->|"Task state"| PG

    MR -->|"HTTP"| Ollama["Ollama (local)"]
    MR -->|"HTTP"| Cloud["Cloud LLMs"]
    MR -->|"Rate limit state"| Redis

    PB -->|"Vector search"| PG
    PB -->|"Working memory"| Redis

    SM -->|"Docker API"| Docker["Docker Engine"]
    SM -->|"File artifacts"| MinIO

    MCP -->|"REST APIs"| External["GitHub / Linear / Slack / ..."]
```

### Complete Connection Matrix

| From | To | Protocol | Port | Purpose |
|------|----|----------|------|---------|
| Browser | Traefik | HTTPS | 443 | TLS termination |
| Traefik | web | HTTP | 3000 | Next.js frontend |
| Traefik | api | HTTP | 4000 | tRPC API |
| Traefik | socket-server | WebSocket | 4001 | Real-time events |
| web | api | tRPC/HTTP | 4000 | All CRUD operations |
| web | socket-server | Socket.io | 4001 | Bidirectional events |
| web | api | SSE | 4000 | Streaming agent output |
| api | PostgreSQL | TCP | 5432 | Drizzle ORM queries |
| api | Redis | TCP | 6379 | BullMQ enqueue, pub/sub |
| queue-worker | Redis | TCP | 6379 | BullMQ consume |
| queue-worker | orchestrator | HTTP | 4002 | Agent lifecycle |
| orchestrator | model-router | HTTP | 4004 | LLM routing |
| orchestrator | project-brain | HTTP | 4003 | Context assembly |
| orchestrator | sandbox-manager | HTTP | 4006 | Tool execution |
| orchestrator | mcp-gateway | HTTP | 4005 | External tool execution |
| orchestrator | Redis | TCP | 6379 | Event publishing |
| orchestrator | PostgreSQL | TCP | 5432 | Task/agent state |
| model-router | Ollama | HTTP | 11434 | Local LLM inference |
| model-router | Cerebras API | HTTPS | 443 | Cloud inference |
| model-router | Groq API | HTTPS | 443 | Cloud inference |
| model-router | Gemini API | HTTPS | 443 | Cloud inference |
| model-router | Anthropic API | HTTPS | 443 | Cloud inference |
| model-router | OpenAI API | HTTPS | 443 | Cloud inference |
| model-router | DeepSeek API | HTTPS | 443 | Cloud inference |
| model-router | Redis | TCP | 6379 | Rate limit state |
| project-brain | PostgreSQL | TCP | 5432 | Vector search, memories |
| project-brain | Redis | TCP | 6379 | Working memory |
| sandbox-manager | Docker | Unix socket | — | `/var/run/docker.sock` |
| sandbox-manager | MinIO | HTTP | 9000 | File artifact storage |
| mcp-gateway | External APIs | HTTPS | 443 | GitHub, Linear, Slack, etc. |
| socket-server | Redis | TCP | 6379 | Pub/sub + adapter |

---

## 4. Database Schema

PostgreSQL 16 with pgvector extension. All IDs generated via `@prometheus/utils` `generateId()`. Row-Level Security (RLS) enforced via `orgId` on all tenant-scoped tables.

### Entity Relationship Diagram

```mermaid
erDiagram
    organizations ||--o{ orgMembers : "has members"
    organizations ||--o{ projects : "owns"
    organizations ||--o{ creditBalances : "has balance"
    organizations ||--o{ creditTransactions : "has transactions"
    organizations ||--o{ creditReservations : "has reservations"
    organizations ||--o{ subscriptions : "subscribes"
    organizations ||--o{ mcpConnections : "connects"
    organizations ||--o{ apiKeys : "issues"
    organizations ||--o{ modelConfigs : "configures"
    organizations ||--o{ modelUsage : "tracks usage"
    organizations ||--o{ usageRollups : "rolls up"

    users ||--o{ orgMembers : "belongs to"
    users ||--o| userSettings : "has settings"
    users ||--o{ sessions : "starts"
    users ||--o{ apiKeys : "creates"

    projects ||--o| projectSettings : "has settings"
    projects ||--o{ projectMembers : "has members"
    projects ||--o{ sessions : "contains"
    projects ||--o{ tasks : "has tasks"
    projects ||--o{ blueprints : "defines"
    projects ||--o{ codeEmbeddings : "embeds"
    projects ||--o{ fileIndexes : "indexes"
    projects ||--o{ agentMemories : "stores"
    projects ||--o{ episodicMemories : "records"
    projects ||--o{ proceduralMemories : "learns"
    projects ||--o{ mcpToolConfigs : "configures tools"

    sessions ||--o{ sessionEvents : "emits"
    sessions ||--o{ sessionMessages : "has messages"
    sessions ||--o{ tasks : "runs"
    sessions ||--o{ agents : "spawns"

    tasks ||--o{ taskSteps : "has steps"

    blueprints ||--o{ blueprintVersions : "versioned"
    subscriptionPlans ||--o{ subscriptions : "purchased"

    organizations {
        text id PK
        text name
        text slug UK
        enum planTier "hobby|starter|pro|team|studio|enterprise"
        text stripeCustomerId UK
        timestamp createdAt
        timestamp updatedAt
    }

    orgMembers {
        text id PK
        text orgId FK
        text userId
        enum role "owner|admin|member"
        timestamp invitedAt
        timestamp joinedAt
    }

    users {
        text id PK
        text clerkId UK
        text email UK
        text name
        text avatarUrl
        timestamp createdAt
        timestamp updatedAt
    }

    userSettings {
        text userId PK_FK
        enum theme "light|dark|system"
        text defaultModel
        boolean notificationsEnabled
    }

    projects {
        text id PK
        text orgId FK
        text name
        text description
        text repoUrl
        text techStackPreset
        enum status "active|archived|setup"
        timestamp createdAt
        timestamp updatedAt
    }

    projectSettings {
        text projectId PK_FK
        enum agentAggressiveness "balanced|full_auto|supervised"
        integer ciLoopMaxIterations "default 20"
        integer parallelAgentCount "default 1"
        enum blueprintEnforcement "strict|flexible|advisory"
        integer testCoverageTarget "default 80"
        enum securityScanLevel "basic|standard|thorough"
        enum deployTarget "staging|production|manual"
        real modelCostBudget
    }

    projectMembers {
        text id PK
        text projectId FK
        text userId
        enum role "owner|contributor|viewer"
    }

    sessions {
        text id PK
        text projectId FK
        text userId FK
        enum status "active|paused|completed|failed|cancelled"
        enum mode "task|ask|plan|watch|fleet"
        timestamp startedAt
        timestamp endedAt
    }

    sessionEvents {
        text id PK
        text sessionId FK
        enum type "agent_output|file_change|plan_update|task_status|queue_position|credit_update|checkpoint|error|reasoning|terminal_output|browser_screenshot"
        jsonb data
        text agentRole
        timestamp timestamp
    }

    sessionMessages {
        text id PK
        text sessionId FK
        enum role "user|assistant|system"
        text content
        text modelUsed
        integer tokensIn
        integer tokensOut
        timestamp createdAt
    }

    tasks {
        text id PK
        text sessionId FK
        text projectId FK
        text title
        text description
        enum status "pending|queued|running|paused|completed|failed|cancelled"
        integer priority "default 50"
        text agentRole
        integer creditsReserved
        integer creditsConsumed
        timestamp startedAt
        timestamp completedAt
        timestamp createdAt
    }

    taskSteps {
        text id PK
        text taskId FK
        integer stepNumber
        text description
        enum status "pending|queued|running|paused|completed|failed|cancelled"
        text output
    }

    agents {
        text id PK
        text sessionId FK
        text role
        enum status "idle|working|error|terminated"
        text modelUsed
        integer tokensIn
        integer tokensOut
        integer stepsCompleted
        text currentTaskId
        timestamp startedAt
        timestamp lastActiveAt
        timestamp terminatedAt
    }

    codeEmbeddings {
        text id PK
        text projectId FK
        text filePath
        integer chunkIndex
        text content
        vector embedding "768 dimensions"
        timestamp updatedAt
    }

    fileIndexes {
        text id PK
        text projectId FK
        text filePath
        text fileHash
        text language
        integer loc
        timestamp lastIndexed
    }

    agentMemories {
        text id PK
        text projectId FK
        enum memoryType "semantic|episodic|procedural|architectural|convention"
        text content
        vector embedding "768 dimensions"
        timestamp createdAt
    }

    episodicMemories {
        text id PK
        text projectId FK
        text eventType
        text decision
        text reasoning
        text outcome
        timestamp createdAt
    }

    proceduralMemories {
        text id PK
        text projectId FK
        text procedureName
        jsonb steps
        timestamp lastUsed
    }

    creditBalances {
        text orgId PK_FK
        integer balance
        integer reserved
        timestamp updatedAt
    }

    creditTransactions {
        text id PK
        text orgId FK
        enum type "purchase|consumption|refund|bonus|subscription_grant"
        integer amount
        integer balanceAfter
        text taskId
        text description
        timestamp createdAt
    }

    creditReservations {
        text id PK
        text orgId FK
        text taskId
        integer amount
        enum status "active|committed|released"
        timestamp createdAt
        timestamp expiresAt
    }

    modelUsage {
        text id PK
        text orgId FK
        text sessionId
        text taskId
        text provider
        text model
        integer tokensIn
        integer tokensOut
        real costUsd
        timestamp createdAt
    }

    modelConfigs {
        text id PK
        text orgId FK
        text provider
        text modelId
        text apiKeyEncrypted
        boolean isDefault
        integer priority
    }

    blueprints {
        text id PK
        text projectId FK
        text version
        text content
        jsonb techStack
        boolean isActive
        timestamp createdAt
    }

    blueprintVersions {
        text id PK
        text blueprintId FK
        text version
        text diff
        text changedBy
        timestamp createdAt
    }

    techStackPresets {
        text id PK
        text name
        text slug UK
        text description
        jsonb configJson
        text icon
    }

    subscriptionPlans {
        text id PK
        text name
        text stripePriceId
        integer creditsIncluded
        integer maxParallelAgents
        jsonb featuresJson
    }

    subscriptions {
        text id PK
        text orgId FK
        text planId FK
        text stripeSubscriptionId UK
        enum status "active|past_due|cancelled|trialing|incomplete"
        timestamp currentPeriodStart
        timestamp currentPeriodEnd
    }

    mcpConnections {
        text id PK
        text orgId FK
        text provider
        text credentialsEncrypted
        enum status "connected|disconnected|error"
        timestamp connectedAt
    }

    mcpToolConfigs {
        text id PK
        text projectId FK
        text toolName
        boolean enabled
        jsonb configJson
    }

    apiKeys {
        text id PK
        text orgId FK
        text userId FK
        text keyHash UK
        text name
        timestamp lastUsed
        timestamp createdAt
        timestamp revokedAt
    }

    usageRollups {
        text id PK
        text orgId FK
        timestamp periodStart
        timestamp periodEnd
        integer tasksCompleted
        integer creditsUsed
        real costUsd
    }
```

### Table Groups

| Group | Tables | Purpose |
|-------|--------|---------|
| **Core** | organizations, orgMembers, users, userSettings | Identity, multi-tenancy |
| **Projects** | projects, projectSettings, projectMembers | Project configuration |
| **Sessions** | sessions, sessionEvents, sessionMessages | User interaction tracking |
| **Tasks** | tasks, taskSteps, agents | Agent work tracking |
| **Memory / AI** | codeEmbeddings, fileIndexes, agentMemories, episodicMemories, proceduralMemories | AI memory system |
| **Billing** | creditBalances, creditTransactions, creditReservations, subscriptionPlans, subscriptions | Monetization |
| **Models** | modelUsage, modelConfigs | LLM tracking and configuration |
| **Integrations** | mcpConnections, mcpToolConfigs, apiKeys | External service connections |
| **Blueprints** | blueprints, blueprintVersions, techStackPresets | Architecture definitions |
| **Analytics** | usageRollups | Aggregated usage metrics |

### Key Indexes

| Table | Index | Columns | Purpose |
|-------|-------|---------|---------|
| codeEmbeddings | code_embeddings_project_file_idx | (projectId, filePath) | Fast file lookup |
| fileIndexes | file_indexes_project_path_idx | (projectId, filePath) | Dedup file indexing |
| codeEmbeddings | — (pgvector) | embedding | Cosine similarity search |
| agentMemories | — (pgvector) | embedding | Memory vector search |

### Multi-Tenancy (RLS)

Every tenant-scoped table includes an `orgId` column. All queries are scoped by organization:

```
WHERE orgId = :currentOrgId
```

This applies to: projects, sessions, tasks, credits, subscriptions, model configs, MCP connections, API keys, usage rollups, and all memory tables (scoped via projectId → project.orgId).

---

## 5. Real-Time Event Architecture

The platform supports three real-time delivery mechanisms:

1. **Socket.io WebSocket** — bidirectional, room-based
2. **SSE (Server-Sent Events)** — unidirectional streaming from API
3. **Redis Pub/Sub** — internal event bus between services

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant Redis as Redis Pub/Sub
    participant Socket as socket-server :4001
    participant SSE as api :4000 (SSE)
    participant Browser as Browser

    Note over Orch,Browser: Event Publication
    Orch->>Redis: PUBLISH session:{sessionId}:events<br/>{ type: 'agent_output', data: {...} }

    Note over Orch,Browser: Socket.io Path
    Redis-->>Socket: Subscription receives message
    Socket->>Socket: Parse event, route to namespace
    alt /sessions namespace
        Socket->>Browser: emit('session:event', { type, data, agentRole })
    else /fleet namespace
        Socket->>Browser: emit('fleet:event', { agents, tasks })
    else /notifications namespace
        Socket->>Browser: emit('notification', { title, body })
    end

    Note over Orch,Browser: SSE Path
    Redis-->>SSE: Subscription receives message
    SSE->>SSE: Format as SSE text/event-stream
    SSE->>Browser: event: agent_output\ndata: {...}\n\n

    Note over Orch,Browser: Heartbeat (SSE)
    loop Every 15 seconds
        SSE->>Browser: event: heartbeat\ndata: { ts }\n\n
    end
```

### Socket.io Namespaces

| Namespace | Room Pattern | Events Emitted | Events Received |
|-----------|-------------|----------------|-----------------|
| `/sessions` | `session:{sessionId}` | `session:event`, `session:error` | `join`, `leave`, `message`, `command`, `takeover`, `release`, `approve-plan`, `checkpoint-response`, `pause`, `resume` |
| `/fleet` | `fleet:{orgId}` | `fleet:event`, `fleet:status` | `fleet:status`, `fleet:stop-agent`, `fleet:reassign` |
| `/notifications` | `user:{userId}` | `notification` | `mark-read` |
| `/metrics` | `org:{orgId}` | `metrics:update` | — |
| `/presence` | `org:{orgId}` | `presence:joined`, `presence:left`, `presence:updated` | `heartbeat` |
| `/yjs` | `doc:{documentId}` | CRDT sync frames | CRDT sync frames |

### Session Event Types

| Event Type | Source | Payload |
|------------|--------|---------|
| `agent_output` | AgentLoop | `{ content, agentRole, iteration }` |
| `file_change` | AgentLoop | `{ filePath, operation, diff }` |
| `plan_update` | AgentLoop | `{ steps[], currentStep }` |
| `task_status` | QueueWorker | `{ taskId, status, agentRole }` |
| `queue_position` | API | `{ position, estimatedWait }` |
| `credit_update` | QueueWorker | `{ consumed, remaining }` |
| `checkpoint` | AgentLoop | `{ question, options[], context }` |
| `error` | AgentLoop | `{ message, code, recoverable }` |
| `reasoning` | AgentLoop | `{ thought, agentRole }` |
| `terminal_output` | SandboxManager | `{ stdout, stderr, exitCode }` |
| `browser_screenshot` | SandboxManager | `{ url, imageBase64 }` |

### Redis Channel Pattern

```
session:{sessionId}:events    — per-session agent events
fleet:{orgId}:events          — org-wide fleet events
notifications:{userId}        — per-user notifications
```

### SSE Configuration

The SSE endpoint (`apps/api/src/routes/sse.ts`) uses:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- 15-second heartbeat interval
- Traefik middleware for SSE headers (disables buffering)

---

## 6. Agent Execution Pipeline

### Agent Roles

Prometheus ships with 12 specialist agents, each with a preferred model and specific tool access:

```mermaid
flowchart TD
    subgraph "Task Input"
        Task["Incoming Task"]
    end

    subgraph "Routing"
        TR["TaskRouter<br/>Regex Pattern Matching"]
    end

    subgraph "Context"
        PB["Project Brain<br/>Context Assembly"]
    end

    subgraph "Agent Roles"
        direction LR
        Orch["orchestrator"]
        Disc["discovery"]
        Arch["architect"]
        Plan["planner"]
        FC["frontend_coder"]
        BC["backend_coder"]
        IC["integration_coder"]
        TE["test_engineer"]
        CI["ci_loop"]
        SA["security_auditor"]
        DE["deploy_engineer"]
    end

    subgraph "Execution"
        AL["AgentLoop<br/>(max 50 iterations)"]
    end

    subgraph "Model Router"
        MR["model-router :4004<br/>Slot-based routing"]
    end

    subgraph "Tool Execution"
        SM["sandbox-manager :4006"]
        Tools["file_read | file_write | file_edit<br/>terminal_exec | git_commit | git_diff<br/>search_files | search_content | search_semantic"]
    end

    Task --> TR
    TR --> |"Route by description"| Orch & Disc & Arch & Plan & FC & BC & IC & TE & CI & SA & DE
    Orch & Disc & Arch & Plan & FC & BC & IC & TE & CI & SA & DE --> PB
    PB --> |"Assembled context<br/>~14,000 tokens"| AL
    AL --> |"Chat completion"| MR
    MR --> |"Response + tool_calls"| AL
    AL --> |"Execute tools"| SM
    SM --> |"Tool results"| AL
    AL --> |"Loop until done<br/>or max iterations"| MR
```

### Agent Role Configuration

| # | Role | Preferred Model | Slot | Tools | Description |
|---|------|----------------|------|-------|-------------|
| 1 | `orchestrator` | ollama/qwen3.5:27b | think | — (coordination only) | Coordinates all agents, resolves conflicts, tracks velocity |
| 2 | `discovery` | gemini/gemini-2.5-flash | longContext | search_semantic, file_read, search_content | Requirements elicitation via 5-question framework (WHO, WHAT, NOT, DONE, RISK) |
| 3 | `architect` | ollama/deepseek-r1:32b | think | file_read, file_write, search_files, search_content | Designs architecture, creates Blueprint.md, defines tech stack + DB schema |
| 4 | `planner` | ollama/qwen3.5:27b | think | file_read, search_semantic | Creates sprint plans with task decomposition and dependency mapping |
| 5 | `frontend_coder` | ollama/qwen3-coder-next | default | file_read, file_write, file_edit, terminal_exec, git_commit, git_diff, search_files, search_content | Implements React/Next.js components, pages, styling |
| 6 | `backend_coder` | ollama/qwen3-coder-next | default | file_read, file_write, file_edit, terminal_exec, git_commit, git_diff, search_files, search_content | Implements APIs, services, business logic, DB queries |
| 7 | `integration_coder` | cerebras/qwen3-235b | fastLoop | file_read, file_write, file_edit, terminal_exec, search_files, search_content | Wires frontend ↔ backend, tRPC + Socket.io integration |
| 8 | `test_engineer` | groq/llama-3.3-70b | default | file_read, file_write, file_list, terminal_exec, search_files, search_content | Writes unit, integration, and E2E tests |
| 9 | `ci_loop` | cerebras/qwen3-235b | fastLoop | terminal_exec, file_read, search_content | Test-fail-analyze-fix cycle (max 20 iterations via `ciLoopMaxIterations`) |
| 10 | `security_auditor` | ollama/deepseek-r1:32b | think | file_read, search_files, search_content, terminal_exec | OWASP vulnerability scanning, security review |
| 11 | `deploy_engineer` | ollama/qwen3-coder-next | default | file_read, file_write, file_edit, terminal_exec, search_files | Docker, k8s, CI/CD pipeline configuration |
| 12 | `documentation` | gemini/gemini-2.5-flash | longContext | file_read, file_write, search_files, search_content | API docs, user guides, changelogs, architecture docs |

### Task Routing Rules

The `TaskRouter` uses regex pattern matching against the task description to select the appropriate agent role:

| Pattern Category | Example Regex Matches | Routes To | Confidence |
|------------------|-----------------------|-----------|------------|
| Discovery | `requirements`, `scope`, `user stories`, `clarify` | discovery | 0.80–0.95 |
| Architecture | `architecture`, `blueprint`, `schema design`, `tech stack` | architect | 0.80–0.95 |
| Planning | `plan`, `sprint`, `breakdown`, `estimate` | planner | 0.80–0.95 |
| Frontend | `react`, `component`, `page`, `css`, `tailwind`, `ui` | frontend_coder | 0.80–0.95 |
| Backend | `api`, `endpoint`, `database`, `query`, `service`, `trpc` | backend_coder | 0.80–0.95 |
| Integration | `connect`, `wire`, `integrate`, `socket`, `websocket` | integration_coder | 0.80–0.95 |
| Testing | `test`, `spec`, `coverage`, `e2e`, `unit test` | test_engineer | 0.80–0.95 |
| Security | `security`, `vulnerability`, `owasp`, `audit`, `xss` | security_auditor | 0.80–0.95 |
| Deployment | `deploy`, `docker`, `kubernetes`, `ci/cd`, `pipeline` | deploy_engineer | 0.80–0.95 |
| **Fallback** | *(no match)* | orchestrator | 0.50 |

### AgentLoop Execution Details

The `AgentLoop` class (`apps/orchestrator/src/agent-loop.ts`) manages the full lifecycle of a single agent execution:

1. **Initialization** — Load context from Project Brain, set up system prompt with role instructions
2. **LLM Loop** — Send messages to Model Router, process completions
3. **Tool Execution** — Execute tool calls in sandbox, collect results
4. **Event Publishing** — Publish all events to Redis for real-time streaming
5. **Credit Tracking** — 1 credit per 1,000 tokens consumed
6. **Blocker Detection** — 3 consecutive failures triggers "human input needed" checkpoint
7. **Termination** — Max 50 iterations, or task complete, or explicit stop

### Slot-to-Role Mapping

Different agent roles are routed to different Model Router slots based on their workload characteristics:

| Slot | Used By | Primary Model | Why |
|------|---------|---------------|-----|
| `think` | orchestrator, architect, planner, security_auditor | ollama/deepseek-r1:32b | Reasoning-heavy tasks |
| `default` | frontend_coder, backend_coder, test_engineer, deploy_engineer | ollama/qwen3-coder-next | Code generation |
| `fastLoop` | integration_coder, ci_loop | cerebras/qwen3-235b | Rapid iteration |
| `longContext` | discovery | gemini/gemini-2.5-flash | Large context windows |

---

## 7. Agent Composition & Multi-Agent Patterns

The orchestrator supports advanced multi-agent coordination patterns beyond simple sequential execution.

### Mixture of Agents (MoA)

Multiple agents work on the same task in parallel, then a voting mechanism selects the best output.

```
Task → [Agent A] → Output A ─┐
     → [Agent B] → Output B ─┼→ MoA Voting → Best Output
     → [Agent C] → Output C ─┘
```

**Components:**
- `apps/orchestrator/src/moa/parallel-generator.ts` — Spawns N agents concurrently
- `apps/orchestrator/src/moa/voting.ts` — Consensus voting across agent outputs

### Agent Composition

Agents can spawn sub-agents and coordinate complex multi-step workflows.

| Pattern | File | Description |
|---------|------|-------------|
| **Agent Composer** | `composition/agent-composer.ts` | Dynamic multi-agent composition based on task analysis |
| **Task Analyzer** | `composition/task-analyzer.ts` | Analyzes tasks to determine optimal agent composition |
| **Multi-Repo** | `composition/multi-repo.ts` | Cross-repository agent coordination |

### Workflow Patterns

| Pattern | File | Description |
|---------|------|-------------|
| **Spec-First** | `patterns/spec-first.ts` | Write tests/specs first, then implement to pass |
| **TDD Workflow** | `patterns/tdd-workflow.ts` | Red-green-refactor cycle with agents |
| **Design-to-Code** | `patterns/design-to-code.ts` | Convert design specs to implementation |
| **Generator-Evaluator** | `patterns/generator-evaluator.ts` | Generate solution, evaluate quality, iterate |
| **Ambiguity Resolver** | `patterns/ambiguity-resolver.ts` | Interactive clarification when requirements are ambiguous |

### Fleet Management

The fleet system (`apps/orchestrator/src/fleet/`) coordinates multiple agents across an organization:

- **Agent Bus** — Inter-agent message passing
- **Agent Lifecycle** — Spawn, monitor, terminate agents
- **Conflict Detector** — Detect when agents modify the same files
- **Merge Coordinator** — Resolve conflicts between agent outputs
- **Shared Context** — Shared memory between fleet agents
- **Spawn Manager** — Resource-aware agent spawning
- **Swarm Coordinator** — Large-scale parallel agent coordination

### CI Loop Enhancements

The CI Loop agent has advanced debugging and testing capabilities:

| Component | File | Description |
|-----------|------|-------------|
| **Five-Why Debugger** | `ci-loop/five-why-debugger.ts` | Root cause analysis via 5-why methodology |
| **Fuzz Testing** | `ci-loop/fuzz-testing.ts` | Automated fuzz testing for failure discovery |
| **Living Requirements** | `ci-loop/living-requirements.ts` | Dynamic requirement tracking from test outcomes |
| **Property Testing** | `ci-loop/property-testing.ts` | Property-based testing generation |
| **Systemic Analyzer** | `ci-loop/systemic-analyzer.ts` | Systemic issue detection across test failures |

---

## 8. Model Routing Decision Tree

The Model Router (`apps/model-router/`) provides intelligent routing across 15 models from 7 providers, with automatic fallback chains and Redis-backed rate limiting.

### Slot-Based Routing

```mermaid
flowchart TD
    Request["Incoming Request"]
    Request --> HasSlot{Explicit slot<br/>specified?}

    HasSlot -->|Yes| UseSlot["Use specified slot"]
    HasSlot -->|No| AutoSelect["Auto-select slot"]

    AutoSelect --> TokenCheck{Token count<br/>> 32K?}
    TokenCheck -->|Yes| LongCtx["slot: longContext"]
    TokenCheck -->|No| TaskType{Task type?}

    TaskType -->|"reasoning / planning"| Think["slot: think"]
    TaskType -->|"code generation"| Default["slot: default"]
    TaskType -->|"rapid iteration"| FastLoop["slot: fastLoop"]
    TaskType -->|"image analysis"| Vision["slot: vision"]
    TaskType -->|"code review"| Review["slot: review"]
    TaskType -->|"background / low-priority"| Background["slot: background"]
    TaskType -->|"high-stakes"| Premium["slot: premium"]

    UseSlot --> TryPrimary
    LongCtx --> TryPrimary
    Think --> TryPrimary
    Default --> TryPrimary
    FastLoop --> TryPrimary
    Vision --> TryPrimary
    Review --> TryPrimary
    Background --> TryPrimary
    Premium --> TryPrimary

    TryPrimary["Try Primary Model"]
    TryPrimary --> RateCheck{Rate limit<br/>available?}
    RateCheck -->|Yes| Success["Return completion"]
    RateCheck -->|No| Fallback1["Try Fallback 1"]
    Fallback1 --> Rate2{Rate limit<br/>available?}
    Rate2 -->|Yes| Success
    Rate2 -->|No| Fallback2["Try Fallback 2"]
    Fallback2 --> Rate3{Rate limit<br/>available?}
    Rate3 -->|Yes| Success
    Rate3 -->|No| Error["Return 429<br/>Rate Limited"]
```

### Slot Configuration

| Slot | Primary Model | Fallback 1 | Fallback 2 | Use Case |
|------|--------------|------------|------------|----------|
| `default` | ollama/qwen3-coder-next | cerebras/qwen3-235b | groq/llama-3.3-70b | General code generation |
| `think` | ollama/deepseek-r1:32b | ollama/qwen3.5:27b | anthropic/claude-sonnet-4-6 | Reasoning, architecture |
| `longContext` | gemini/gemini-2.5-flash | anthropic/claude-sonnet-4-6 | ollama/qwen3-coder-next | Large file analysis |
| `background` | ollama/qwen2.5-coder:7b | ollama/qwen2.5-coder:14b | ollama/qwen3-coder-next | Low-priority tasks |
| `vision` | anthropic/claude-sonnet-4-6 | gemini/gemini-2.5-flash | — | Image/screenshot analysis |
| `review` | anthropic/claude-sonnet-4-6 | ollama/deepseek-r1:32b | ollama/qwen3.5:27b | Code review, audits |
| `fastLoop` | cerebras/qwen3-235b | groq/llama-3.3-70b | ollama/qwen3-coder-next | CI loops, quick iteration |
| `premium` | anthropic/claude-opus-4-6 | anthropic/claude-sonnet-4-6 | ollama/deepseek-r1:32b | Critical decisions |

### Model Registry (5 Tiers)

| Tier | Provider | Model | Context Window | Cost (Input/Output per 1M tokens) | RPM Limit | TPM Limit |
|------|----------|-------|---------------|-----------------------------------|-----------|-----------|
| **0 — Free (Local)** | Ollama | qwen3-coder-next | 32K | $0 / $0 | ∞ | ∞ |
| 0 | Ollama | deepseek-r1:32b | 32K | $0 / $0 | ∞ | ∞ |
| 0 | Ollama | qwen3.5:27b | 32K | $0 / $0 | ∞ | ∞ |
| 0 | Ollama | qwen2.5-coder:14b | 32K | $0 / $0 | ∞ | ∞ |
| 0 | Ollama | nomic-embed-text | 8K | $0 / $0 | ∞ | ∞ |
| **1 — Free APIs** | Cerebras | qwen3-235b | 8K | $0 / $0 | 30 | 1,000,000 |
| 1 | Groq | llama-3.3-70b | 131K | $0 / $0 | 30 | 131,000 |
| 1 | Gemini | gemini-2.5-flash | 1M | $0 / $0 | 15 | 4,000,000 |
| **2 — Low-cost** | DeepSeek | deepseek-coder | 128K | $0.14 / $0.28 | 60 | ∞ |
| **3 — Mid-tier** | Anthropic | claude-sonnet-4-6 | 200K | $3.00 / $15.00 | 50 | 80,000 |
| **4 — Premium** | Anthropic | claude-opus-4-6 | 200K | $15.00 / $75.00 | 20 | 80,000 |

### Fallback Chain Diagram

```mermaid
flowchart LR
    subgraph "Code Generation Path"
        direction LR
        OQ["ollama/qwen3-coder-next<br/>(free, local)"] -->|"rate limited"| CQ["cerebras/qwen3-235b<br/>(free API, 30 RPM)"]
        CQ -->|"rate limited"| GL["groq/llama-3.3-70b<br/>(free API, 30 RPM)"]
    end

    subgraph "Reasoning Path"
        direction LR
        OD["ollama/deepseek-r1:32b<br/>(free, local)"] -->|"rate limited"| OW["ollama/qwen3.5:27b<br/>(free, local)"]
        OW -->|"rate limited"| CS["anthropic/claude-sonnet-4-6<br/>($3/$15 per 1M)"]
    end

    subgraph "Long Context Path"
        direction LR
        GF["gemini/gemini-2.5-flash<br/>(free, 1M ctx)"] -->|"rate limited"| CS2["anthropic/claude-sonnet-4-6<br/>(200K ctx)"]
        CS2 -->|"rate limited"| OQ2["ollama/qwen3-coder-next<br/>(32K ctx)"]
    end

    subgraph "Premium Path"
        direction LR
        CO["anthropic/claude-opus-4-6<br/>($15/$75 per 1M)"] -->|"rate limited"| CS3["anthropic/claude-sonnet-4-6<br/>($3/$15 per 1M)"]
        CS3 -->|"rate limited"| OD2["ollama/deepseek-r1:32b<br/>(free, local)"]
    end
```

### Rate Limiting

The Rate Limiter (`apps/model-router/src/rate-limiter.ts`) uses **Redis sliding windows** per provider:

| Provider | RPM Limit | TPM Limit | Window |
|----------|-----------|-----------|--------|
| Ollama | Unlimited | Unlimited | — |
| Cerebras | 30 | 1,000,000 | 60s |
| Groq | 30 | 131,000 | 60s |
| Gemini | 15 | 4,000,000 | 60s |
| OpenRouter | 20 | 200,000 | 60s |
| Mistral | 2 | Unlimited | 60s |
| DeepSeek | 60 | Unlimited | 60s |
| Anthropic | 50 | 80,000 | 60s |
| OpenAI | 60 | Unlimited | 60s |

### Model Router API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/route` | Primary slot-based routing |
| `POST` | `/v1/chat/completions` | OpenAI-compatible legacy endpoint |
| `GET` | `/v1/models` | List all available models |
| `GET` | `/v1/slots` | List slot configurations |
| `GET` | `/v1/rate-limits` | Current rate limit status |
| `POST` | `/v1/estimate-tokens` | Token estimation + slot recommendation |
| `GET` | `/health` | Health check |

---

## 9. Cost Optimization System

The Model Router includes sophisticated cost optimization beyond basic routing.

### Cost Optimization Components

| Component | File | Description |
|-----------|------|-------------|
| **Cost Monitor** | `model-router/src/cost-monitor.ts` | Real-time per-request cost tracking |
| **Cost Optimizer** | `model-router/src/cost-optimizer.ts` | Automatic cheapest-viable-model selection |
| **Prompt Cache** | `model-router/src/prompt-cache.ts` | Semantic caching of repeated prompts |
| **Request Coalescer** | `model-router/src/request-coalescer.ts` | Deduplication of near-identical requests |
| **Speculative Execution** | `model-router/src/speculative.ts` | Fast draft + full verification |
| **A/B Testing** | `model-router/src/ab-testing.ts` | Experimental model comparisons |
| **Model Scorer** | `model-router/src/model-scorer.ts` | Quality scoring per model |
| **Complexity Estimator** | `model-router/src/complexity-estimator.ts` | Task complexity → model selection |
| **Cascade Router** | `model-router/src/cascade.ts` | Quality-aware cascade fallback |

### BYO (Bring Your Own) Model Support

Users can provide their own API keys for private model providers:

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/byo/keys` | Register custom API key |
| `DELETE /v1/byo/keys/:provider` | Remove custom key |
| `GET /v1/byo/keys` | List configured providers |
| `POST /v1/byo/test` | Test custom API key validity |
| `GET /v1/byo/providers` | List supported BYO providers |

**BYO Validator** (`byo-model-validator.ts`) validates custom models for schema compliance, response format, and latency.

### Cost Reduction Strategy

```
Request → Complexity Estimator → Prompt Cache Check
                                       ↓ (cache miss)
                                 Request Coalescer → Deduplicated Request
                                       ↓
                                 Cost Optimizer → Cheapest viable model
                                       ↓
                                 Route to LLM → Track cost per request
```

Expected savings: 40-60% reduction in LLM costs via caching, coalescing, and smart model selection.

---

## 10. Scaling Architecture (1000+ Users)

### Cluster Topology

```mermaid
graph TD
    subgraph "k3s Cluster"
        subgraph "Ingress Layer"
            Traefik["Traefik<br/>IngressRoute<br/>TLS + SSE middleware"]
        end

        subgraph "Frontend Tier"
            Web1["web pod 1"]
            Web2["web pod 2"]
            WebN["web pod 3-8"]
            WebHPA["HPA<br/>2→8 replicas<br/>CPU 70%"]
        end

        subgraph "API Tier"
            API1["api pod 1"]
            API2["api pod 2"]
            APIN["api pod 3-6"]
            APIHPA["HPA<br/>2→6 replicas<br/>CPU 60% / Mem 75%"]
        end

        subgraph "WebSocket Tier"
            Socket1["socket-server pod 1"]
            Socket2["socket-server pod 2"]
        end

        subgraph "Worker Tier (KEDA)"
            QW1["queue-worker pod 1"]
            QW2["queue-worker pod 2"]
            QWN["queue-worker pod 3-16"]
            KEDA["KEDA ScaledObject<br/>2→16 replicas<br/>Trigger: Redis list length<br/>bull:agent-tasks:wait"]
        end

        subgraph "Data Tier"
            PG["PostgreSQL 16<br/>StatefulSet<br/>20Gi PVC<br/>500m CPU / 2Gi Mem"]
            Redis["Valkey 8<br/>Deployment<br/>5Gi PVC<br/>800mb maxmemory<br/>allkeys-lru"]
        end
    end

    Traefik --> Web1 & Web2 & WebN
    Traefik --> API1 & API2 & APIN
    Traefik --> Socket1 & Socket2

    API1 & API2 & APIN --> PG
    API1 & API2 & APIN --> Redis

    QW1 & QW2 & QWN --> Redis
    QW1 & QW2 & QWN --> PG

    Socket1 & Socket2 --> Redis

    WebHPA -.->|"scales"| Web1 & Web2 & WebN
    APIHPA -.->|"scales"| API1 & API2 & APIN
    KEDA -.->|"scales"| QW1 & QW2 & QWN
```

### Autoscaling Configuration

| Service | Scaler | Min | Max | Triggers | Stabilization |
|---------|--------|-----|-----|----------|---------------|
| **web** | HPA | 2 | 8 | CPU avg 70% | Scale-down: 300s |
| **api** | HPA | 2 | 6 | CPU avg 60%, Memory avg 75% | Scale-down: 300s |
| **queue-worker** | KEDA | 2 | 16 | Redis list `bull:agent-tasks:wait` length | Scale-down: 60s |
| **socket-server** | Manual | 2 | 2 | — | — |

### Resource Allocations (per pod)

| Service | CPU Request | CPU Limit | Memory Request | Memory Limit |
|---------|------------|-----------|---------------|-------------|
| **web** | 250m | 500m | 512Mi | 1Gi |
| **api** | 250m | 500m | 512Mi | 1Gi |
| **socket-server** | 250m | 500m | 512Mi | 1Gi |
| **queue-worker** | 500m | 1000m | 1.5Gi | 3Gi |
| **PostgreSQL** | 500m | 2000m | 2Gi | 4Gi |
| **Redis/Valkey** | — | — | — | 800mb (maxmemory) |

### Capacity Math for 1000+ MAU

```
Assumptions:
  - 1,000 Monthly Active Users (MAU)
  - 20% Daily Active User rate → 200 DAU
  - Peak concurrency: 25% of DAU → 50 concurrent users
  - 3 tasks/day per active user → 600 tasks/day
  - Average task duration: 2-5 minutes

Queue Worker Capacity:
  - Each pod: concurrency 2 (parallel tasks per worker)
  - Base: 2 pods × 2 = 4 concurrent tasks
  - Peak: 16 pods × 2 = 32 concurrent tasks
  - Throughput: 32 tasks × ~3 min avg = ~640 tasks/hour peak
  - Daily capacity at peak: easily handles 600 tasks/day

Sandbox Capacity:
  - Warm pool: 5 pre-created containers per sandbox-manager
  - Max containers: 16 per sandbox-manager instance
  - Warm start: <200ms, Cold start: <5s

API Capacity:
  - 2 pods baseline → handles ~200 concurrent connections
  - 6 pods at peak → handles ~600 concurrent connections
  - tRPC batching reduces actual request count

WebSocket Capacity:
  - 2 pods with Redis adapter for sticky sessions
  - Each pod: ~5,000 concurrent WebSocket connections
  - Total: ~10,000 concurrent connections (well above 50 concurrent users)

Database Capacity:
  - Connection pool: 20 connections per API pod
  - Peak: 6 pods × 20 = 120 connections
  - PostgreSQL default max: 100 (needs tuning for peak)
```

### KEDA Scaling Behavior

The KEDA `ScaledObject` monitors the Redis list length for the BullMQ `agent-tasks` queue:

```yaml
triggers:
  - type: redis
    metadata:
      address: redis:6379
      listName: bull:agent-tasks:wait
      listLength: "2"        # Scale up when >2 waiting jobs
```

When the wait queue exceeds 2 jobs, KEDA scales queue-worker pods from 2 up to 16. Scale-down occurs after the queue empties (cooldown: 60s).

---

## 11. Security & Isolation Model

### Three-Layer Security Architecture

```mermaid
flowchart LR
    subgraph "Layer 1: Authentication"
        direction TB
        Clerk["Clerk<br/>JWT + Session Management"]
        JWT["JWT Verification<br/>on every tRPC call"]
        RBAC["Role-Based Access<br/>owner | admin | member"]
    end

    subgraph "Layer 2: Multi-Tenancy"
        direction TB
        OrgId["org_id Scoping<br/>on all queries"]
        RLS["Row-Level Security<br/>Drizzle ORM enforced"]
        ProjectScope["Project membership<br/>owner | contributor | viewer"]
    end

    subgraph "Layer 3: Sandbox Isolation"
        direction TB
        Docker["Docker Containers<br/>node:22-alpine base"]
        Security["SecurityOpt<br/>no-new-privileges"]
        ReadOnly["Read-only rootfs<br/>+ tmpfs /tmp"]
        Resources["Resource Limits<br/>CPU + Memory caps"]
        Network["Bridge Network<br/>No host access"]
    end

    Clerk --> OrgId --> Docker
```

### Authentication (Clerk)

| Check | Applied At | Details |
|-------|-----------|---------|
| JWT verification | API middleware | Every tRPC request verified via Clerk |
| User identity | tRPC context | `userId` and `orgId` injected into context |
| Organization membership | Query layer | All queries scoped to authenticated org |
| Role authorization | Router level | owner/admin/member permissions per endpoint |
| API key auth | API middleware | SHA-256 hashed keys in `apiKeys` table, `keyHash` unique index |

### Multi-Tenancy Isolation

All tenant-scoped database queries include `WHERE orgId = :currentOrgId`. This is enforced at the Drizzle ORM query layer — not database-level RLS — ensuring no cross-tenant data leakage.

Scoping chain:
```
Organization → Projects → Sessions → Tasks → Agent Events
                       → Blueprints → Memories → Embeddings
```

### Sandbox Security Controls

The Sandbox Manager supports multiple isolation backends:

| Provider | File | Use Case |
|----------|------|----------|
| **Docker** | `providers/docker.ts` | Standard development containers |
| **Firecracker** | `providers/firecracker.ts` | Lightweight VMs for production |
| **gVisor** | `providers/gvisor.ts` | Google's sandboxed containers |
| **E2B** | `providers/e2b.ts` | Cloud-hosted sandboxes |
| **Dev** | `providers/dev.ts` | Testing, no isolation |

Additional sandbox features:
- **Pool Manager** (`pool-manager.ts`) — Pre-warmed container pool with predictive scaling
- **Auto-Snapshot** (`auto-snapshot.ts`) — Automatic state snapshots for rollback
- **Browser Automation** (`browser/browser-use-engine.ts`) — Playwright-based browser testing
- **Git Operations** (`git-ops.ts`) — Clone, commit, push within sandboxes
- **Zoekt Indexer** (`zoekt-indexer.ts`) — Code search indexing per sandbox
- **Network Isolation** (`network/`) — Network policies per sandbox
- **Security Monitoring** (`security/`) — Escape detection and resource monitoring

The `ContainerManager` (`apps/sandbox-manager/src/container.ts`) creates isolated Docker containers for agent tool execution:

| Control | Setting | Purpose |
|---------|---------|---------|
| **Base image** | `node:22-alpine` | Minimal attack surface |
| **Security options** | `no-new-privileges` | Prevent privilege escalation |
| **Filesystem** | Read-only root + tmpfs | Prevent persistent modifications |
| **tmpfs mount** | `/tmp` with noexec | Temp storage without execution |
| **CPU limit** | Configurable nanoseconds | Prevent CPU abuse |
| **Memory limit** | Configurable bytes | Prevent memory abuse |
| **Network** | Bridge mode | Isolated network namespace |
| **Docker socket** | Host-mounted read-only | For container management only |

### Credential Security

| Asset | Protection |
|-------|-----------|
| API keys (user) | SHA-256 hashed (`keyHash`), only hash stored |
| MCP credentials | AES-encrypted (`credentialsEncrypted` column) |
| Model API keys | AES-encrypted (`apiKeyEncrypted` column) |
| Stripe keys | Environment variables only, never in DB |
| Clerk secrets | Environment variables only |

### API Middleware Stack

The API service applies 14 middleware layers to every request:

| Middleware | File | Purpose |
|-----------|------|---------|
| **Auth (Clerk)** | `middleware/api-key-auth.ts` | JWT/API key verification |
| **RBAC** | `middleware/rbac.ts` | Role-based access control |
| **Org Context** | `middleware/org-context.ts` | Organization isolation injection |
| **Project Auth** | `middleware/project-auth.ts` | Project-level authorization |
| **Plan Enforcement** | `middleware/plan-enforcement.ts` | Plan tier limit enforcement |
| **Rate Limit** | `middleware/rate-limit.ts` | Basic request rate limiting |
| **Rate Limit Enhanced** | `middleware/rate-limit-enhanced.ts` | Advanced per-org rate limiting |
| **Security** | `middleware/security.ts` | OWASP security headers |
| **Audit** | `middleware/audit.ts` | Request/response audit trail |
| **Audit Logger** | `middleware/audit-logger.ts` | Detailed audit logging |
| **Cache** | `middleware/cache.ts` | Response caching |
| **Compression** | `middleware/compression.ts` | Response compression |
| **Sentry** | `middleware/sentry.ts` | Error tracking integration |

---

## 12. Credit & Billing Flow

### Reserve → Execute → Commit Pattern

```mermaid
sequenceDiagram
    participant User as Browser
    participant API as api :4000
    participant PG as PostgreSQL
    participant QW as queue-worker
    participant AL as AgentLoop

    Note over User,AL: Phase 1 — Reserve Credits
    User->>API: POST /trpc/tasks.submit { description, mode }
    API->>PG: SELECT balance, reserved FROM creditBalances
    API->>API: Determine cost by mode (ask:2, simple:5, plan:10, medium:25, complex:75)

    alt Insufficient balance
        API-->>User: 402 { error: 'insufficient_credits' }
    else Sufficient balance
        API->>PG: INSERT creditReservation { id: 'res_*', amount, status: 'active' }
        API->>PG: UPDATE creditBalances SET reserved += amount
        API-->>User: 202 { taskId, creditsReserved }
    end

    Note over User,AL: Phase 2 — Execute Task
    QW->>AL: Start agent execution
    AL->>AL: Track tokens consumed (1 credit per 1K tokens)

    Note over User,AL: Phase 3a — Commit on Success
    AL-->>QW: Task completed
    QW->>PG: UPDATE creditReservation SET status = 'committed'
    QW->>PG: INSERT creditTransaction { type: 'consumption', amount: actualCost }
    QW->>PG: UPDATE creditBalances SET balance -= actualCost, reserved -= reservedAmount
    QW->>PG: UPDATE task SET creditsConsumed = actualCost

    Note over User,AL: Phase 3b — Release on Failure
    AL-->>QW: Task failed
    QW->>PG: UPDATE creditReservation SET status = 'released'
    QW->>PG: UPDATE creditBalances SET reserved -= reservedAmount
```

### Plan Tiers

| Tier | Price | Credits/Month | Max Parallel Agents | Max Tasks/Day | Key Features |
|------|-------|--------------|--------------------|--------------|--------------|
| **Hobby** | $0 | 50 | 1 | 10 | Community support |
| **Starter** | $19/mo | 500 | 2 | 50 | Email support |
| **Pro** | $49/mo | 2,000 | 4 | 200 | Priority support, API access |
| **Team** | $99/mo | 5,000 | 8 | 500 | Team management, analytics |
| **Studio** | $249/mo | 15,000 | 16 | 1,000 | Custom blueprints, SSO |
| **Enterprise** | Custom | Unlimited | Unlimited | Unlimited | SLA, dedicated support |

### Credit Costs by Task Type

| Task Mode | Credits | Typical Use |
|-----------|---------|-------------|
| `ask_mode` | 2 | Quick questions, explanations |
| `simple_fix` | 5 | Bug fixes, small changes |
| `plan_mode` | 10 | Architecture planning, sprint breakdown |
| `medium_task` | 25 | Feature implementation, refactoring |
| `complex_task` | 75 | Multi-file features, full-stack implementation |

### BullMQ Queues

| Queue | Purpose | Concurrency | Retry Strategy | Cleanup |
|-------|---------|-------------|----------------|---------|
| `agent-tasks` | Primary agent execution | 2 per worker | 3 retries, exponential backoff | Completed: 1h, Failed: 24h |
| `enterprise-tasks` | Priority enterprise jobs | 4 per worker | 3 retries, exponential backoff | Completed: 1h, Failed: 24h |
| `index-project` | Code indexing | 1 (serial) | 3 retries, exponential backoff | Completed: 1h, Failed: 24h |
| `generate-embeddings` | Vector embeddings | 2 per worker | 3 retries, exponential backoff | Completed: 1h, Failed: 24h |
| `send-notification` | User notifications | 5 per worker | 3 retries, exponential backoff | Completed: 1h, Failed: 24h |
| `usage-rollup` | Usage aggregation | 1 | 3 retries | Scheduled: hourly |
| `usage-aggregation` | Billing aggregation | 1 | 3 retries | Scheduled: daily |
| `credit-grant` | Credit allocation | 3 per worker | 3 retries | On demand |
| `credit-reconciliation` | Credit verification | 1 | 3 retries | Scheduled: daily |
| `cleanup-sandbox` | Sandbox cleanup | 2 per worker | 3 retries | Periodic |
| `dlq-replay` | Dead letter queue recovery | 1 | Manual replay | On demand |

---

## 13. Deployment Topology

### Development vs Production

```mermaid
graph TD
    subgraph "Development (docker-compose)"
        direction TB
        DevPG["PostgreSQL 16<br/>+ pgvector<br/>port 5432<br/>Volume: pg_data"]
        DevRedis["Valkey 8<br/>port 6379<br/>Volume: redis_data"]
        DevMinIO["MinIO<br/>port 9000 (API) / 9001 (Console)<br/>Volume: minio_data"]
        DevApps["Apps via pnpm dev<br/>(turborepo, all 9 services)"]

        DevApps --> DevPG
        DevApps --> DevRedis
        DevApps --> DevMinIO
    end

    subgraph "Production (k3s + Traefik + KEDA)"
        direction TB
        ProdTraefik["Traefik IngressRoute<br/>TLS termination"]

        subgraph "app.prometheus.dev"
            ProdWeb["web (2-8 pods)<br/>HPA CPU 70%"]
        end

        subgraph "api.prometheus.dev"
            ProdAPI["api (2-6 pods)<br/>HPA CPU 60% / Mem 75%"]
        end

        subgraph "ws.prometheus.dev"
            ProdSocket["socket-server (2 pods)<br/>Sticky sessions"]
        end

        subgraph "Internal"
            ProdQW["queue-worker (2-16 pods)<br/>KEDA Redis trigger"]
            ProdOrch["orchestrator"]
            ProdMR["model-router :4004"]
            ProdSM["sandbox-manager :4006"]
            ProdMCP["mcp-gateway :4005"]
            ProdPB["project-brain :4003"]
        end

        subgraph "Stateful"
            ProdPG["PostgreSQL 16<br/>StatefulSet, 20Gi PVC"]
            ProdRedis["Valkey 8<br/>5Gi PVC, 800mb maxmem"]
        end

        ProdTraefik --> ProdWeb
        ProdTraefik --> ProdAPI
        ProdTraefik --> ProdSocket
    end
```

### Traefik Ingress Routes

| Host | Service | Port | Middleware |
|------|---------|------|-----------|
| `app.prometheus.dev` | web | 3000 | — |
| `api.prometheus.dev` | api | 4000 | SSE headers (disable buffering) |
| `ws.prometheus.dev` | socket-server | 4001 | — |

All routes use TLS via the `prometheus-tls` certificate resolver.

### SSE Headers Middleware

Traefik applies custom headers for SSE endpoints to prevent response buffering:

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: sse-headers
spec:
  headers:
    customResponseHeaders:
      X-Accel-Buffering: "no"
      Cache-Control: "no-cache"
```

### Docker Multi-Stage Builds

| Dockerfile | Base | Stages | Output |
|-----------|------|--------|--------|
| `Dockerfile.base` | node:22-alpine | 1 stage | Base image with pnpm 10 |
| `Dockerfile.api` | Dockerfile.base | 3 stages (deps → builder → runner) | API service image |
| `Dockerfile.web` | Dockerfile.base | 3 stages (deps → builder → runner) | Next.js standalone output |

Build flow:
```
Dockerfile.base → node:22-alpine + pnpm 10
                ↓
Dockerfile.api  → install deps → build → copy dist (minimal runtime)
Dockerfile.web  → install deps → next build → copy .next/standalone
```

### Monitoring & Alerts

The platform includes 10 PrometheusRule alert definitions (`infra/k8s/base/monitoring/alert-rules.yaml`):

| Alert | Condition | Severity |
|-------|-----------|----------|
| HighMemoryUsage | Container memory > 90% for 5m | warning |
| HighCPUUsage | Container CPU > 85% for 10m | warning |
| QueueDepthCritical | `agent-tasks:wait` > 50 for 5m | critical |
| PodOOMKilled | OOMKilled restart detected | critical |
| PostgresReplicationLag | Replication lag > 30s for 5m | warning |
| CertificateExpiringSoon | TLS cert expires < 7 days | warning |
| DiskUsageHigh | Disk usage > 85% | warning |
| APIErrorRateHigh | 5xx rate > 5% for 5m | critical |
| AgentFailureRateHigh | Agent failure rate > 20% for 15m | warning |
| CreditLedgerImbalance | Sum(transactions) ≠ balance | critical |

---

## 14. Memory System (8 Layers)

The Project Brain service (`apps/project-brain/`) implements an 8-layer memory architecture that gives agents persistent, contextual understanding of codebases.

### Memory Architecture

```mermaid
graph TD
    subgraph "Context Assembly"
        CA["ContextAssembler<br/>Token budget: 14,000"]
    end

    subgraph "Layer 1: Semantic Memory"
        Semantic["pgvector 768-dim embeddings<br/>Cosine similarity search<br/>Function-boundary chunking<br/>Max 2000 chars per chunk"]
    end

    subgraph "Layer 2: Knowledge Graph"
        KG["Code entity relationships<br/>Nodes: files, functions, classes, modules, components<br/>Edges: imports, calls, extends, implements, depends_on, contains<br/>Stored as architectural memories in agentMemories table"]
    end

    subgraph "Layer 3: Episodic Memory"
        Episodic["Past decisions + reasoning + outcomes<br/>Full-text search on decision/reasoning<br/>Used to avoid repeating mistakes<br/>Stored in episodicMemories table"]
    end

    subgraph "Layer 4: Procedural Memory"
        Procedural["Learned workflows as JSONB step sequences<br/>Name-based upsert (replaces if exists)<br/>Auto-extracted from package.json scripts<br/>Stored in proceduralMemories table"]
    end

    subgraph "Layer 5: Working Memory"
        Working["Redis with TTL (1 hour default)<br/>Session-scoped key-value pairs<br/>Prefix: wm:{sessionId}:{key}<br/>Cleared on session timeout"]
    end

    CA -->|"14% budget<br/>~1,960 tokens"| Global["Global Context<br/>Blueprint + Procedures"]
    CA -->|"57% budget<br/>~7,980 tokens"| TaskCtx["Task Context<br/>Semantic + Knowledge Graph"]
    CA -->|"14% budget<br/>~1,960 tokens"| SessionCtx["Session Context<br/>Episodic + Working Memory"]
    CA -->|"14% budget<br/>~1,960 tokens"| ToolCtx["Tool Context<br/>Agent Role Description"]

    Global --> Procedural
    TaskCtx --> Semantic
    TaskCtx --> KG
    SessionCtx --> Episodic
    SessionCtx --> Working
```

### Layer Details

#### Layer 1: Semantic Memory

Stores code understanding via vector embeddings for similarity search.

| Property | Value |
|----------|-------|
| **Storage** | `codeEmbeddings` table (PostgreSQL + pgvector) |
| **Embedding dimensions** | 768 |
| **Similarity metric** | Cosine similarity |
| **Chunking strategy** | Function/class boundary detection |
| **Max chunk size** | 2,000 characters |
| **Fallback** | ILIKE text search if vector search fails |
| **Language support** | 18+ languages (TS, JS, Python, Go, Rust, Java, C/C++, etc.) |
| **Max file size** | 256KB |

Indexing flow:
1. File watcher detects change → hash comparison with `fileIndexes`
2. If changed, chunk by declarations (functions, classes, exports)
3. Generate embeddings (pseudo-hash currently, real model TODO)
4. Upsert into `codeEmbeddings` with project + file path

#### Layer 2: Knowledge Graph

Tracks architectural relationships between code entities.

| Node Types | Edge Types |
|------------|------------|
| files | imports |
| functions | calls |
| classes | extends |
| modules | implements |
| components | depends_on |
| | contains |

The knowledge graph is stored in the `agentMemories` table with `memoryType = 'architectural'` and content as JSON describing nodes and edges.

Auto-analysis on file indexing:
- Extract import statements → create `imports` edges
- Detect class inheritance → create `extends` edges
- Find function exports → create `contains` edges

#### Layer 3: Episodic Memory

Records agent decisions, reasoning, and outcomes for learning from experience.

| Field | Purpose |
|-------|---------|
| `eventType` | Category of the event (e.g., "architecture_decision", "bug_fix") |
| `decision` | What was decided |
| `reasoning` | Why it was decided |
| `outcome` | What happened (success/failure + details) |

Search: Full-text search on `decision` and `reasoning` fields using ILIKE.

#### Layer 4: Procedural Memory

Stores reusable workflows as step sequences.

```json
{
  "procedureName": "run-tests",
  "steps": [
    { "action": "terminal_exec", "command": "pnpm test" },
    { "action": "parse_output", "pattern": "FAIL|PASS" },
    { "action": "file_read", "path": "coverage/summary.json" }
  ]
}
```

Auto-extraction: Parses `package.json` scripts into procedures (e.g., `pnpm dev`, `pnpm build`, `pnpm test`).

#### Layer 5: Working Memory

Ephemeral, session-scoped storage in Redis.

| Property | Value |
|----------|-------|
| **Storage** | Redis key-value |
| **Key pattern** | `wm:{sessionId}:{key}` |
| **Default TTL** | 1 hour |
| **Scope** | Single session |
| **Operations** | set, get, getAll, delete, clearSession |

Used for: current file being edited, conversation state, intermediate results, agent scratchpad.

#### Layer 6: Conversational Memory

Stores chat history and extracted insights from agent-user conversations.

| Property | Value |
|----------|-------|
| **Storage** | PostgreSQL |
| **Operations** | store, retrieve, extract insights, prune |
| **Scope** | Per-session, with cross-session carry-over |

#### Layer 7: Session Persistence

Carries forward relevant context when resuming sessions or starting related sessions.

| Property | Value |
|----------|-------|
| **Storage** | PostgreSQL + Redis |
| **Scope** | Cross-session within a project |
| **Use** | Session resume briefings, context carry-over |

#### Layer 8: Domain Knowledge

Stores framework-specific knowledge, conventions, and best practices.

| Property | Value |
|----------|-------|
| **Storage** | PostgreSQL |
| **Scope** | Per-project |
| **Use** | Framework patterns, coding conventions, learned project-specific rules |

### Additional Memory Components

| Component | File | Description |
|-----------|------|-------------|
| **Digital Twin** | `digital-twin.ts` | Live representation of codebase state, synchronized in real-time |
| **Meta-Learning** | `meta-learning/` | Learning from agent sessions to discover patterns and improve behavior |
| **Convention Extractor** | `analyzers/convention-extractor.ts` | Auto-extracts coding conventions from codebase |
| **Blueprint Enforcer** | `blueprint/enforcer.ts` | Validates agent output against project architecture blueprint |
| **Blueprint Auto-Updater** | `blueprint/auto-updater.ts` | Evolves blueprints as project changes |
| **Semantic Reranker** | `layers/reranker.ts` | Re-ranks search results by relevance |
| **Symbol Store** | `parsers/symbols.ts` | Tree-sitter based symbol extraction and resolution |

### Context Assembly Budget

The `ContextAssembler` (`apps/project-brain/src/context/assembler.ts`) allocates the 14,000 token default budget:

| Section | Budget % | ~Tokens | Sources |
|---------|----------|---------|---------|
| **Global** | 14% | 1,960 | Active blueprint + all project procedures |
| **Task-specific** | 57% | 7,980 | Top-5 semantic search results + knowledge graph dependencies |
| **Session** | 14% | 1,960 | Recent episodic memories + working memory |
| **Tools** | 14% | 1,960 | Agent role description and tool documentation |

Token estimation: ~4 characters per token.

### Session Resume

When resuming a paused session, the `SessionResume` service generates a briefing:

1. Load last 20 session events
2. Extract recent actions (file changes, agent output, task status)
3. Identify current state (active task, open files, agent status)
4. Surface pending decisions and unresolved errors
5. Return `SessionBriefing { summary, actions[], state, nextSteps[] }`

### Project Brain API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/context/assemble` | Assemble agent context with token budget |
| `POST` | `/sessions/:id/resume` | Generate session resume briefing |
| `POST` | `/index/file` | Index a file (chunk + embed) |
| `POST` | `/search/semantic` | Vector similarity search |
| `POST` | `/memory/store` | Store episodic/procedural memory |
| `POST` | `/graph/query` | Query knowledge graph |
| `POST` | `/working-memory/set` | Set working memory value |
| `GET` | `/working-memory/:sessionId/:key` | Get working memory value |

---

## 15. Governance & Compliance Engine

The orchestrator includes a comprehensive governance system for enterprise compliance.

### Governance Components

| Component | File | Description |
|-----------|------|-------------|
| **Governance Engine** | `governance/governance-engine.ts` | Policy enforcement and rule evaluation |
| **Trust Scorer** | `governance/trust-scorer.ts` | Agent trust scoring based on history and performance |
| **Audit Trail** | `governance/audit-trail.ts` | Full audit logging of all agent actions |
| **Business Logic Guardian** | `guardian/business-logic-guardian.ts` | Domain-specific rule enforcement |
| **Blueprint Enforcer** | `blueprint-enforcer.ts` | Architecture validation against project blueprints |

### Compliance Audit Logger

The `compliance/audit-logger.ts` (18.5KB) provides:

- Complete audit trail of all agent actions
- **PII detection and masking** in generated code and logs
- **License scanning** (GPL, LGPL, AGPL, copyleft detection)
- **ISO 42001 compliance reporting** (AI management system standard)
- **IP provenance tracking** for generated code attribution
- **Generated code attribution** to prevent IP issues

### Agent Hooks (Pre/Post Execution)

| Hook | File | Description |
|------|------|-------------|
| **Auto-Lint** | `hooks/auto-lint-hook.ts` | Lint code after every agent file write |
| **Security Scan** | `hooks/security-scan-hook.ts` | Run security checks on generated code |
| **Blueprint Guard** | `hooks/blueprint-guard-hook.ts` | Validate changes against architecture |
| **Cost Guard** | `hooks/cost-guard-hook.ts` | Enforce cost budgets per task |
| **Dependency Audit** | `hooks/dependency-audit-hook.ts` | Check for vulnerable dependencies |

---

## 16. Self-Play Training Pipeline

The orchestrator includes a self-play training system that learns from agent sessions.

### Training Pipeline

```
Completed Sessions → Example Extraction → Pattern Mining → Decision Trees
                                                              ↓
                                                     Improved Agent Prompts
```

**Self-Play Trainer** (`training/self-play-trainer.ts`):

1. **Example Collection** — Collects training examples from successful agent sessions
2. **Pattern Mining** — Discovers recurring patterns across accumulated examples
3. **Decision Tree Generation** — Builds decision trees for common scenarios
4. **Quality Scoring** — Rates examples by outcome quality

### Training Data Types

| Type | Description |
|------|-------------|
| **Positive** | Successful task completions with high quality |
| **Negative** | Failed attempts to learn what to avoid |
| **Correction** | Human feedback overrides on agent decisions |
| **Pattern** | Discovered recurring patterns from multiple sessions |

---

## 17. Plugin Architecture

The plugin system (`packages/plugins/`) enables extensibility through custom tools, skill packs, and marketplace integrations.

### Plugin System Components

| Component | File | Description |
|-----------|------|-------------|
| **Plugin Manager** | `core.ts` | Plugin lifecycle management |
| **Plugin Loader** | `loader.ts` | Dynamic hot-loading of plugins |
| **Plugin Registry** | `registry/` | Plugin discovery and registration |
| **Plugin Sandbox** | `sandbox.ts` | Isolated execution environment |
| **Plugin SDK** | `sdk/` | Development kit for plugin authors |
| **Marketplace Client** | `marketplace/` | Plugin marketplace integration |
| **Template Manager** | `templates/` | Project template management |
| **MCP Integration** | `mcp/` | MCP server wrapping for plugins |

### Skill Packs

Pre-built agent skill bundles for common domains:

| Pack | Description |
|------|-------------|
| **SaaS** | Subscription billing, user management, dashboards |
| **Mobile** | React Native, Flutter patterns |
| **Data Pipeline** | ETL, streaming, data warehouse |
| **E-Commerce** | Product catalog, cart, checkout, payments |

### Plugin Lifecycle

```
Discovery → Validation → Loading → Initialization → Active → Hot-Reload / Unload
```

---

## 18. IDE & Voice Integration

### VS Code Extension

The `packages/vscode-extension/` provides full IDE integration:

| Component | File | Description |
|-----------|------|-------------|
| **Extension Core** | `extension.ts` | Main entry point, command registration |
| **API Client** | `api-client.ts` | Communication with Prometheus API |
| **Chat Panel** | `chat-panel.ts` | Inline chat interface with agents |
| **Status Bar** | `status-bar.ts` | Agent status, credits, session info |
| **Commands** | `commands/` | VS Code command palette integration |
| **Git Integration** | `git/` | Git operations via VS Code |
| **UI Panels** | `panels/` | Custom webview panels |

### Voice Interface

The `packages/voice/` provides voice-based interaction:

| Component | File | Description |
|-----------|------|-------------|
| **Voice Interface** | `voice-interface.ts` | Main voice I/O controller |
| **Speech Recognizer** | `speech-recognizer.ts` | Web Speech API speech-to-text |
| **Command Parser** | `command-parser.ts` | Natural language → agent command |

Frontend components: `voice-input.tsx`, `voice-output.tsx`, `use-voice.ts` hook.

### CLI Tool

The `packages/cli/` provides command-line access:

- Agent invocation from terminal
- Task submission and management
- Project setup and configuration
- Session monitoring

---

## 19. Capacity Planning

### Compute Requirements (1000 MAU)

| Service | Pods | CPU (total) | Memory (total) | Notes |
|---------|------|-------------|---------------|-------|
| web | 2-8 | 0.5-4 cores | 1-8 Gi | HPA scales on CPU |
| api | 2-6 | 0.5-3 cores | 1-6 Gi | HPA scales on CPU + memory |
| socket-server | 2 | 0.5 cores | 1 Gi | Redis adapter for scaling |
| queue-worker | 2-16 | 1-16 cores | 3-48 Gi | KEDA scales on queue depth |
| orchestrator | 1-2 | 0.25-0.5 cores | 512Mi-1 Gi | Stateless coordinator |
| model-router | 1-2 | 0.25-0.5 cores | 256Mi-512Mi | Lightweight HTTP router |
| sandbox-manager | 1-2 | 0.5-1 cores | 1-2 Gi | Docker container management |
| mcp-gateway | 1 | 0.25 cores | 256Mi | External API proxy |
| project-brain | 1-2 | 0.5-1 cores | 1-2 Gi | Vector search + memory |
| **PostgreSQL** | 1 | 0.5-2 cores | 2-4 Gi | StatefulSet, 20Gi PVC |
| **Redis/Valkey** | 1 | — | 800 Mb max | 5Gi PVC, allkeys-lru |
| **Total baseline** | **~15 pods** | **~5 cores** | **~12 Gi** | |
| **Total peak** | **~40+ pods** | **~28 cores** | **~75 Gi** | |

### Database Sizing

| Metric | Estimate | Notes |
|--------|----------|-------|
| **Base schema** | ~5 MB | 30+ tables, indexes |
| **Per-org data** | ~1-5 MB/month | Sessions, tasks, events, messages |
| **Embeddings** | ~50-100 MB/project | 768-dim vectors, depends on codebase size |
| **Monthly growth** | ~100 MB | At 1000 MAU with average activity |
| **Year 1 total** | ~1.5-3 GB | Well within 20Gi PVC |
| **Recommended PVC** | 20 Gi | Room for 5+ years of growth |

### Redis Sizing

| Usage | Estimate | Notes |
|-------|----------|-------|
| **BullMQ queues** | ~50-100 MB | 4 queues, job retention 1-24h |
| **Socket.io adapter** | ~10-50 MB | Room state, session mappings |
| **Pub/sub channels** | ~10 MB | Transient message buffers |
| **Rate limit state** | ~5 MB | Sliding window counters |
| **Working memory** | ~50-100 MB | TTL 1h, session-scoped |
| **Total** | ~125-265 MB | Well within 800mb maxmemory |

### Infrastructure Cost Estimate

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| **Compute (Hetzner)** | $80-120 | CX41/CX51 dedicated or 2-3 cloud instances |
| **LLM API costs** | $50-200 | Primarily Tier 0-1 (free), occasional Tier 3-4 |
| **Domain + TLS** | $1-5 | Traefik + Let's Encrypt |
| **Object storage** | $5-10 | MinIO / S3-compatible |
| **Monitoring** | $0-20 | Self-hosted Prometheus + Grafana |
| **Backups** | $10-20 | PG dump + Redis RDB snapshots |
| **Total** | **$150-375/mo** | At 1000 MAU |

### LLM Cost Breakdown

| Tier | Models | Est. Usage | Monthly Cost |
|------|--------|-----------|--------------|
| **Tier 0** (Local) | Ollama models | 80% of requests | $0 (GPU amortized) |
| **Tier 1** (Free) | Cerebras, Groq, Gemini | 15% of requests | $0 |
| **Tier 2** (Low-cost) | DeepSeek | 2% of requests | $5-20 |
| **Tier 3** (Mid) | Claude Sonnet | 2% of requests | $20-80 |
| **Tier 4** (Premium) | Claude Opus | 1% of requests | $25-100 |
| **Total** | | | **$50-200** |

The model routing strategy prioritizes free Tier 0/1 models for the vast majority of tasks, reserving paid APIs for code review, vision analysis, and premium/critical decisions. This keeps LLM costs manageable even at scale.

---

## 20. Performance Targets & SLOs

### Service Level Objectives

| Metric | Target | Measurement |
|--------|--------|-------------|
| **API response time (p50)** | < 50ms | tRPC endpoint latency |
| **API response time (p99)** | < 200ms | tRPC endpoint latency |
| **WebSocket connection time** | < 500ms | Socket.io handshake |
| **Event delivery latency** | < 100ms | Redis pub/sub → client |
| **Queue pickup latency (p95)** | < 30s | Time from enqueue to worker pickup |
| **Sandbox warm start** | < 200ms | Pre-created container exec |
| **Sandbox cold start** | < 5s | New container creation + setup |
| **Agent loop iteration** | < 10s | Single LLM call + tool execution |
| **Context assembly** | < 500ms | Project Brain vector search + assembly |
| **Overall availability** | 99.5% | Monthly uptime (allows ~3.6h downtime) |

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Container memory | — | > 90% for 5m |
| Container CPU | — | > 85% for 10m |
| Queue depth | — | > 50 waiting for 5m |
| Pod OOM | — | Any OOMKilled restart |
| PostgreSQL replication lag | > 30s for 5m | — |
| TLS certificate expiry | < 7 days | — |
| Disk usage | > 85% | — |
| API error rate (5xx) | — | > 5% for 5m |
| Agent failure rate | > 20% for 15m | — |
| Credit ledger imbalance | — | Any mismatch |

### Throughput Targets

| Resource | Target | At 1000 MAU |
|----------|--------|-------------|
| Concurrent tasks | 4-32 | KEDA-scaled queue workers |
| Tasks per day | 600+ | ~3 tasks/user/day × 200 DAU |
| WebSocket connections | 10,000+ | 2 socket-server pods |
| LLM requests per minute | 100+ | Distributed across 7 providers |
| File indexing throughput | 1000 files/min | Background queue |

---

## 21. Appendix: Key File Reference

### Application Services

| File | Purpose |
|------|---------|
| `apps/web/` | Next.js 16 frontend (React 19, Tailwind CSS 4, shadcn/ui) |
| `apps/api/src/routers/index.ts` | Main tRPC router combining 23 sub-routers |
| `apps/api/src/routers/tasks.ts` | Task submission, queue integration |
| `apps/api/src/routers/sessions.ts` | Session lifecycle management |
| `apps/api/src/routers/billing.ts` | Credit balance, checkout, transactions |
| `apps/api/src/routers/analytics.ts` | Overview, task metrics, agent performance, ROI |
| `apps/api/src/routers/brain.ts` | Code search, memories, blueprints, dependency graphs |
| `apps/api/src/routers/fleet.ts` | Fleet task dispatch, status tracking |
| `apps/api/src/routers/settings.ts` | API keys, model preferences, MCP config |
| `apps/api/src/routers/integrations.ts` | MCP integration management (8 providers) |
| `apps/api/src/routes/sse.ts` | SSE streaming endpoint |
| `apps/socket-server/src/namespaces/sessions.ts` | Session WebSocket namespace |
| `apps/socket-server/src/namespaces/fleet.ts` | Fleet WebSocket namespace |
| `apps/socket-server/src/namespaces/notifications.ts` | Notification WebSocket namespace |
| `apps/orchestrator/src/agent-loop.ts` | Core agent execution loop (max 50 iterations) |
| `apps/orchestrator/src/task-router.ts` | Regex-based task → agent routing |
| `apps/model-router/src/router.ts` | Slot-based model routing + fallback chains |
| `apps/model-router/src/rate-limiter.ts` | Redis sliding window rate limiter |
| `apps/sandbox-manager/src/container.ts` | Docker container lifecycle + security |
| `apps/project-brain/src/context/assembler.ts` | Context assembly with token budgets |
| `apps/project-brain/src/layers/semantic.ts` | pgvector semantic search |
| `apps/project-brain/src/layers/knowledge-graph.ts` | Code entity relationship graph |
| `apps/project-brain/src/layers/episodic.ts` | Decision + outcome memory |
| `apps/project-brain/src/layers/procedural.ts` | Learned workflow storage |
| `apps/project-brain/src/layers/working-memory.ts` | Redis session-scoped memory |
| `apps/project-brain/src/resume/session-resume.ts` | Session resume briefing generator |
| `apps/project-brain/src/indexing/file-indexer.ts` | Incremental file indexer |
| `apps/mcp-gateway/` | External integration proxy (GitHub, Linear, Slack, etc.) |

### Shared Packages

| Package | Purpose |
|---------|---------|
| `packages/db/src/schema/*.ts` | Drizzle ORM schema definitions (33+ tables, 28 enums) |
| `packages/ai/src/models.ts` | Model registry (40+ models, 5 tiers, 9 providers) |
| `packages/ai/src/client.ts` | LLM client factory (9 providers) |
| `packages/agent-sdk/src/roles/*.ts` | Agent role configs (12 roles, 30+ tools) |
| `packages/billing/` | Stripe integration, plan tiers (6), credit system |
| `packages/queue/src/queues.ts` | BullMQ queue definitions (11 job types) |
| `packages/validators/` | Zod schemas for all domains |
| `packages/logger/` | Pino structured logging with AsyncLocalStorage |
| `packages/utils/` | generateId, encryption, circuit breaker, rate limiter |
| `packages/types/` | Centralized TypeScript type definitions |
| `packages/auth/` | Clerk integration, SSO (OIDC/SAML), SCIM, FGA |
| `packages/telemetry/` | OpenTelemetry + Sentry + Prometheus metrics + SLO monitoring |
| `packages/workflow/` | Inngest workflow orchestration |
| `packages/plugins/` | Plugin SDK, marketplace, hot-loading, skill packs |
| `packages/notifications/` | Multi-channel notifications (Novu) |
| `packages/feature-flags/` | Deterministic feature flag evaluation |
| `packages/email/` | Template-based email (Resend) |
| `packages/voice/` | Speech recognition + TTS |
| `packages/collaboration/` | Yjs CRDT collaborative editing |
| `packages/code-intelligence/` | Tree-sitter parsing, AST diff, call graphs |
| `packages/architecture-graph/` | Architecture visualization |
| `packages/ci-integration/` | GitHub Actions + GitLab CI integration |
| `packages/cli/` | Command-line interface |
| `packages/vscode-extension/` | VS Code IDE integration |
| `packages/ui/` | React component library (Radix UI + Tailwind) |
| `packages/test-utils/` | Test fixtures and mock factories |

### Infrastructure

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Local dev stack (PostgreSQL, Valkey, MinIO) |
| `infra/docker/Dockerfile.base` | Base image (node:22-alpine + pnpm 10) |
| `infra/docker/Dockerfile.api` | API multi-stage build |
| `infra/docker/Dockerfile.web` | Web multi-stage build |
| `infra/k8s/base/api/deployment.yaml` | API deployment (2 replicas, 250m/512Mi) |
| `infra/k8s/base/api/hpa.yaml` | API HPA (2→6, CPU 60%, Mem 75%) |
| `infra/k8s/base/web/deployment.yaml` | Web deployment (2 replicas) |
| `infra/k8s/base/web/hpa.yaml` | Web HPA (2→8, CPU 70%) |
| `infra/k8s/base/queue-worker/deployment.yaml` | Queue worker (2 replicas, 500m/1.5Gi) |
| `infra/k8s/base/keda/scaledobject-agent-worker.yaml` | KEDA scaler (2→16, Redis trigger) |
| `infra/k8s/base/socket-server/deployment.yaml` | Socket server (2 replicas) |
| `infra/k8s/base/postgres/deployment.yaml` | PostgreSQL StatefulSet (20Gi) |
| `infra/k8s/base/redis/deployment.yaml` | Valkey 8 (5Gi, 800mb maxmem) |
| `infra/k8s/base/traefik/ingress.yaml` | Traefik IngressRoute + SSE middleware |
| `infra/k8s/base/monitoring/alert-rules.yaml` | 10 PrometheusRule alerts |

### tRPC API Routers

| Router | Key Procedures |
|--------|---------------|
| `health` | `ping` |
| `projects` | `create`, `get`, `list`, `update`, `delete`, `members.add`, `members.remove`, `settings.update` |
| `sessions` | `create`, `get`, `list`, `pause`, `resume`, `cancel` |
| `tasks` | `submit`, `get`, `list`, `cancel` |
| `billing` | `balance`, `plan`, `checkout`, `purchaseCredits`, `transactions`, `usage` |
| `analytics` | `overview`, `taskMetrics`, `agentPerformance`, `modelUsage`, `roi` |
| `settings` | `apiKeys.create`, `apiKeys.list`, `apiKeys.revoke`, `modelPreferences`, `mcpSettings` |
| `queue` | `position`, `stats` |
| `brain` | `search`, `memories`, `blueprint`, `dependencies` |
| `fleet` | `dispatch`, `status`, `stopAgent` |
| `user` | `profile`, `settings`, `organizations` |
| `integrations` | `list`, `connect`, `disconnect`, `configure` |
| `apiKeys` | `create`, `list`, `revoke`, `rotate` |
| `architecture` | `graph`, `components`, `dependencies`, `metrics` |
| `audit` | `logs`, `search`, `export` |
| `blueprintsEnhanced` | `create`, `update`, `versions`, `enforce` |
| `codeAnalysis` | `analyze`, `review`, `quality`, `symbols` |
| `costAnalytics` | `perProject`, `perModel`, `forecast`, `budget` |
| `gdpr` | `export`, `delete`, `status` |
| `plugins` | `list`, `install`, `uninstall`, `configure` |
| `webhooksOutbound` | `create`, `list`, `delete`, `test`, `deliveries` |
| `stats` | `teamIntelligence`, `agentMetrics`, `costBreakdown` |
| `workspaces` | `create`, `list`, `update`, `members` |

---

*This document is auto-maintained. For the latest state, always cross-reference with the source code.*
