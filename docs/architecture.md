# Prometheus Architecture

## System Architecture

High-level view of all 9 services and their interconnections.

```mermaid
graph TB
    subgraph Client
        Browser["Web Browser"]
    end

    subgraph "Frontend"
        Web["Web App<br/>(Next.js :3000)"]
    end

    subgraph "Core Services"
        API["API Server<br/>(Hono + tRPC :4000)"]
        Socket["Socket Server<br/>(WebSocket :4001)"]
        Orchestrator["Orchestrator<br/>(:4002)"]
    end

    subgraph "AI Services"
        Brain["Project Brain<br/>(:4003)"]
        ModelRouter["Model Router<br/>(:4004)"]
        MCP["MCP Gateway<br/>(:4005)"]
        Sandbox["Sandbox Manager<br/>(:4006)"]
    end

    subgraph "Background"
        QueueWorker["Queue Worker"]
    end

    subgraph "Data Stores"
        PG["PostgreSQL"]
        Redis["Redis"]
        MinIO["MinIO / S3"]
    end

    subgraph "External"
        LLM["LLM Providers<br/>(OpenAI, Anthropic, etc.)"]
        Clerk["Clerk Auth"]
        Stripe["Stripe Billing"]
        GitHub["GitHub / GitLab"]
    end

    Browser --> Web
    Web -->|tRPC| API
    Web -->|WebSocket| Socket
    API --> PG
    API --> Redis
    API --> Orchestrator
    Socket --> Redis
    Orchestrator --> Brain
    Orchestrator --> ModelRouter
    Orchestrator --> Sandbox
    Orchestrator --> MCP
    Orchestrator --> QueueWorker
    QueueWorker --> Redis
    QueueWorker --> PG
    Brain --> PG
    Brain --> Redis
    ModelRouter --> LLM
    MCP --> GitHub
    Sandbox --> MinIO
    API --> Clerk
    API --> Stripe
```

## Data Flow: Task Execution Lifecycle

End-to-end flow when a user submits a task through to completion.

```mermaid
sequenceDiagram
    participant U as User (Web)
    participant A as API Server
    participant Q as Queue Worker
    participant O as Orchestrator
    participant B as Project Brain
    participant MR as Model Router
    participant S as Sandbox Manager
    participant MC as MCP Gateway
    participant WS as Socket Server

    U->>A: Submit task (tRPC mutation)
    A->>A: Validate input, reserve credits
    A->>Q: Enqueue task (BullMQ)
    A->>U: Return task ID + status "queued"

    Q->>Q: Dequeue task
    Q->>O: Dispatch to orchestrator

    O->>B: Fetch project context & memories
    B-->>O: Return blueprint, conventions, history

    O->>MR: Select model (slot-based routing)
    MR->>MR: Evaluate slots, check quotas
    MR-->>O: Return model assignment

    O->>O: Plan via MCTS (generate step tree)

    loop For each execution step
        O->>MR: LLM inference (planning / coding)
        MR-->>O: Model response
        O->>S: Execute code in sandbox
        S-->>O: Execution result
        O->>MC: Call external tools (git, APIs)
        MC-->>O: Tool results
        O->>WS: Stream progress update
        WS->>U: Real-time update (WebSocket)
    end

    O->>B: Store episodic memory
    O->>A: Mark task complete, finalize credits
    A->>WS: Broadcast completion
    WS->>U: Task completed notification
```

## Database Schema Overview

Key tables and their relationships.

```mermaid
erDiagram
    organizations ||--o{ projects : "owns"
    organizations ||--o{ users : "has members"
    organizations ||--o{ credit_balances : "has"
    organizations ||--o{ subscriptions : "subscribes"
    organizations ||--o{ api_keys : "manages"
    organizations ||--o{ audit_logs : "records"

    projects ||--o{ sessions : "contains"
    projects ||--o{ blueprints : "defines"
    projects ||--o{ integrations : "connects"
    projects ||--o{ conventions : "follows"
    projects ||--o{ domain_rules : "enforces"

    sessions ||--o{ tasks : "includes"
    sessions ||--o{ agents : "runs"

    tasks ||--o{ task_steps : "comprises"
    tasks ||--o{ decisions : "produces"

    agents ||--o{ memories : "accumulates"
    agents ||--o{ quality_reviews : "generates"

    credit_balances ||--o{ credit_transactions : "tracks"
    credit_balances ||--o{ credit_reservations : "holds"

    organizations {
        text id PK
        text name
        text slug
        enum plan_tier
    }

    projects {
        text id PK
        text org_id FK
        text name
        enum status
        jsonb tech_stack
    }

    sessions {
        text id PK
        text project_id FK
        enum status
        jsonb config
    }

    tasks {
        text id PK
        text session_id FK
        text project_id FK
        enum status
        text prompt
        integer credits_used
    }

    task_steps {
        text id PK
        text task_id FK
        text agent_id FK
        text action
        jsonb result
    }

    agents {
        text id PK
        text session_id FK
        enum mode
        enum status
    }

    memories {
        text id PK
        text agent_id FK
        text project_id FK
        enum type
        text content
        vector embedding
    }

    blueprints {
        text id PK
        text project_id FK
        integer version
        jsonb spec
    }

    credit_balances {
        text id PK
        text org_id FK
        integer available
        integer reserved
    }

    model_usage_logs {
        text id PK
        text org_id FK
        text model_key
        text provider
        text slot
        integer total_tokens
    }
```

## Service Responsibilities

| Service | Purpose | Key Technologies |
|---------|---------|-----------------|
| **Web** | Next.js frontend with workspace UI | Next.js, React, tRPC client, Tailwind |
| **API** | Central REST/tRPC gateway | Hono, tRPC, Drizzle ORM, Zod |
| **Orchestrator** | Coordinates agent execution | Async generators, MCTS planner |
| **Socket Server** | Real-time bidirectional comms | WebSocket, Redis pub/sub |
| **Project Brain** | Knowledge graph and memory | Embeddings, vector search, RAG |
| **Model Router** | Slot-based LLM selection | Adaptive fallback, cost tracking |
| **MCP Gateway** | External tool integration | Model Context Protocol, GitHub API |
| **Sandbox Manager** | Isolated code execution | Container sandboxes, MinIO storage |
| **Queue Worker** | Background job processing | BullMQ, Redis-backed queues |
