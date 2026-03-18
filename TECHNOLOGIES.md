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
33. [Prompt Engineering & LLM Evaluation](#33-prompt-engineering--llm-evaluation)
34. [Agent Evaluation & Benchmarking](#34-agent-evaluation--benchmarking)
35. [Web Crawling & Data Extraction](#35-web-crawling--data-extraction)
36. [Secrets Management](#36-secrets-management)
37. [Status Pages & Uptime](#37-status-pages--uptime)
38. [Security Scanning & Compliance](#38-security-scanning--compliance)
39. [Feature Flags & Experimentation](#39-feature-flags--experimentation)
40. [Documentation & API Reference](#40-documentation--api-reference)
41. [Desktop & CLI](#41-desktop--cli)
42. [Analytics & Tracking](#42-analytics--tracking)
43. [Mobile & PWA](#43-mobile--pwa)
44. [Accessibility & i18n](#44-accessibility--i18n)

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

### react-markdown — `MUST USE` — `PLANNED`
- **Version**: ^9.0.0
- **License**: MIT
- **GitHub**: 13K+ stars
- **What**: React component for rendering Markdown with remark/rehype plugin ecosystem
- **Why**: Renders all LLM markdown output in the agent session UI — chat messages, explanations, task summaries. Supports GFM (tables, checkboxes), syntax highlighting via rehype-highlight, and custom component overrides for shadcn integration
- **Alternatives**: @mdx-js/react (heavier, for interactive content)
- **Status**: `PLANNED` — Sprint 2

### MDX — `SHOULD USE` — `PLANNED`
- **Version**: ^3.0.0
- **License**: MIT
- **GitHub**: 18K+ stars
- **What**: Markdown with JSX support — embed React components inside Markdown documents
- **Why**: Interactive documentation, agent-generated tutorials with embedded code playgrounds, and rich task descriptions that include live UI components
- **Alternatives**: react-markdown (simpler, non-interactive)
- **Status**: `PLANNED`

### Shiki — `SHOULD USE` — `PLANNED`
- **Version**: ^1.0.0
- **License**: MIT
- **GitHub**: 10K+ stars
- **What**: VS Code-quality syntax highlighter using TextMate grammars. Supports 200+ languages
- **Why**: Syntax highlighting in agent code output, diff views, and code blocks. Uses the same grammars as VS Code so highlighting is pixel-perfect. Better accuracy than Prism.js or highlight.js
- **Alternatives**: Prism.js, highlight.js
- **Status**: `PLANNED`

### xterm.js — `MUST USE` — `PLANNED`
- **Version**: ^5.5.0
- **License**: MIT
- **GitHub**: 18K+ stars
- **What**: Full-featured terminal emulator for the browser. Used by VS Code, Hyper, and Theia
- **Why**: Powers the web terminal in agent session UI. Renders real-time shell output from sandbox containers with full ANSI color support, cursor positioning, and scroll-back. Essential for the live terminal experience
- **Alternatives**: None at this quality level
- **Status**: `PLANNED` — Sprint 2

### Sonner — `MUST USE` — `PLANNED`
- **Version**: ^1.7.0
- **License**: MIT
- **GitHub**: 9K+ stars
- **What**: Opinionated toast notification component for React
- **Why**: Toast notifications throughout APEX — task complete, PR created, credit low, errors. Part of the shadcn/ui ecosystem (shadcn ships a Sonner wrapper). Beautiful defaults, stacking, swipe-to-dismiss
- **Alternatives**: react-hot-toast
- **Status**: `PLANNED` — Sprint 1

### react-hook-form — `SHOULD USE` — `PLANNED`
- **Version**: ^7.54.0
- **License**: MIT
- **GitHub**: 42K+ stars
- **What**: Performant, flexible form library with minimal re-renders
- **Why**: All forms in APEX — settings, project creation, API key management, team invites. Native Zod integration via @hookform/resolvers for type-safe validation. Works with shadcn form components
- **Alternatives**: Formik (heavier), TanStack Form
- **Status**: `PLANNED`

### date-fns — `SHOULD USE` — `PLANNED`
- **Version**: ^4.0.0
- **License**: MIT
- **GitHub**: 35K+ stars
- **What**: Modern JavaScript date utility library. Tree-shakeable, immutable
- **Why**: Date formatting throughout APEX — "2 hours ago", session durations, billing periods, sprint dates. Tree-shakeable so only used functions are bundled. Smaller than Moment.js or Day.js in practice
- **Alternatives**: Day.js, Temporal API (future)
- **Status**: `PLANNED`

### SVGR — `SHOULD USE` — `PLANNED`
- **Version**: ^8.1.0
- **License**: MIT
- **GitHub**: 11K+ stars
- **What**: Transform SVGs into React components. CLI, webpack, and Vite plugin
- **Why**: Convert agent status icons, provider logos, and UI illustrations into type-safe React components. Automatic optimization with SVGO
- **Status**: `PLANNED`

### TanStack Virtual — `SHOULD USE` — `PLANNED`
- **Version**: ^3.0.0
- **License**: MIT
- **GitHub**: 5K+ stars
- **What**: Headless UI for virtualizing large lists, tables, and grids
- **Why**: Virtualized rendering for agent terminal output (thousands of lines), task history lists, and log viewers. Prevents DOM bloat and maintains 60fps even with 100K+ rows
- **Alternatives**: react-virtuoso (more features, heavier)
- **Status**: `PLANNED`

### react-virtuoso — `CAN USE` — `OPTIONAL`
- **Version**: ^4.12.0
- **License**: MIT
- **GitHub**: 5K+ stars
- **What**: React component for rendering large data sets with variable item sizes, grouped mode, and reverse scrolling
- **Why**: Alternative to TanStack Virtual with built-in support for chat-style reverse scrolling (newest at bottom). Useful for agent chat UI if variable-height messages cause issues with TanStack Virtual
- **Status**: `OPTIONAL`

### react-complex-tree — `SHOULD USE` — `PLANNED`
- **Version**: ^2.4.0
- **License**: MIT
- **GitHub**: 1K+ stars
- **What**: Accessible tree view with drag-and-drop, keyboard navigation, rename, multi-select, and search
- **Why**: File explorer tree in the agent session UI. Shows sandbox filesystem, allows navigation, supports drag-and-drop for file organization. More full-featured than building custom tree with Radix
- **Alternatives**: Custom implementation with Radix Accordion
- **Status**: `PLANNED`

### dnd-kit — `SHOULD USE` — `PLANNED`
- **Version**: ^6.1.0
- **License**: MIT
- **GitHub**: 13K+ stars
- **What**: Modern drag-and-drop toolkit for React. Modular, accessible, performant
- **Why**: Drag-and-drop for task boards, agent queue reordering, dashboard panel arrangement. Built for accessibility (keyboard + screen reader support). Modular architecture keeps bundle small
- **Alternatives**: pragmatic-drag-and-drop (Atlassian)
- **Status**: `PLANNED`

### pragmatic-drag-and-drop — `CAN USE` — `OPTIONAL`
- **Version**: ^1.0.0
- **License**: Apache-2.0
- **GitHub**: 10K+ stars
- **What**: Drag-and-drop library by Atlassian. Framework-agnostic, tiny core (4.7KB)
- **Why**: Alternative to dnd-kit. Smaller bundle, used in production by Atlassian (Jira, Confluence). Better for complex multi-container drag scenarios
- **Status**: `OPTIONAL`

### Mermaid — `SHOULD USE` — `PLANNED`
- **Version**: ^11.0.0
- **License**: MIT
- **GitHub**: 73K+ stars
- **What**: Generate diagrams and flowcharts from text (Markdown-like syntax)
- **Why**: Render agent-generated architecture diagrams, flowcharts, and sequence diagrams in chat output. Agents can output Mermaid syntax and it renders as interactive diagrams in the session UI
- **Alternatives**: PlantUML (heavier, Java-based)
- **Status**: `PLANNED`

### assistant-ui — `SHOULD USE` — `PLANNED`
- **Version**: ^0.7.0
- **License**: MIT
- **GitHub**: 3K+ stars
- **What**: React components for building AI chat interfaces — thread, message, composer, branch navigation
- **Why**: Pre-built AI chat UI components that integrate with Vercel AI SDK. Thread management, message branching, and streaming out of the box. Reduces custom chat UI code significantly
- **Alternatives**: Custom implementation with Vercel AI SDK hooks
- **Status**: `PLANNED`

### react-diff-viewer-continued — `SHOULD USE` — `PLANNED`
- **Version**: ^4.0.0
- **License**: MIT
- **GitHub**: 1K+ stars
- **What**: Side-by-side and unified diff viewer React component with syntax highlighting
- **Why**: Display code diffs in agent session UI — before/after file changes, PR preview diffs. Simpler and lighter than CodeMirror merge for read-only diff display. Supports syntax highlighting and line-level commenting
- **Alternatives**: diff2html, CodeMirror merge
- **Status**: `PLANNED`

### tokenx — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **What**: Token counting and visualization library for LLM context windows
- **Why**: Show users token consumption in real-time during agent sessions. Visualize how much of the context window is used. Helps with credit estimation
- **Status**: `OPTIONAL`

### llm-ui — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **What**: React components for rendering streaming LLM output with smooth animations
- **Why**: Alternative to raw react-markdown for streaming agent output. Handles partial markdown rendering during streaming without layout shifts
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

### TanStack DB — `CAN USE` — `OPTIONAL`
- **Version**: ^0.1.0 (early alpha)
- **License**: MIT
- **GitHub**: 2K+ stars
- **What**: Client-side reactive database with automatic sync, optimistic updates, and live queries
- **Why**: Future replacement for manual React Query cache management. Provides a local-first reactive data layer that automatically syncs with the server. Still early but aligns with our TanStack stack
- **Status**: `OPTIONAL` — evaluate when stable

### Y.js — `CAN USE` — `OPTIONAL`
- **Version**: ^13.6.0
- **License**: MIT
- **GitHub**: 17K+ stars
- **What**: CRDT framework for building collaborative applications. Supports shared types (Text, Array, Map, XML)
- **Why**: Real-time collaborative editing if we add Watch Mode (multiple users editing the same file in browser). Powers Google Docs-style collaboration. Works with CodeMirror 6 via y-codemirror.next
- **Alternatives**: Automerge
- **Status**: `OPTIONAL` — Watch Mode feature

### Automerge — `CAN USE` — `OPTIONAL`
- **Version**: ^2.0.0
- **License**: MIT
- **GitHub**: 4K+ stars
- **What**: CRDT library for building local-first collaborative applications. JSON-compatible data model
- **Why**: Alternative to Y.js for collaborative features. Better for structured data (JSON documents) vs Y.js which is better for text. Good for syncing project settings, task lists across clients
- **Status**: `OPTIONAL`

### ElectricSQL — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 7K+ stars
- **What**: Local-first sync framework. Syncs PostgreSQL data to client-side SQLite
- **Why**: Local-first architecture for APEX — works offline, syncs when connected. Could power offline agent task management and local project brain cache
- **Status**: `OPTIONAL` — future local-first initiative

### PowerSync — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 2K+ stars
- **What**: Managed Postgres-to-SQLite sync with conflict resolution
- **Why**: Simpler alternative to ElectricSQL for local-first sync. Managed service reduces operational overhead. Good for mobile/PWA offline support
- **Status**: `OPTIONAL`

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

### Novu — `SHOULD USE` — `PLANNED`
- **Version**: ^2.0.0
- **License**: MIT
- **GitHub**: 36K+ stars
- **What**: Open source notification infrastructure — in-app, email, push, SMS, chat via unified API
- **Why**: Unified notification layer for APEX. In-app notification center (bell icon), email digests, Slack/Discord notifications — all through one API. User notification preferences, digest/batching, and template management. Replaces building custom notification logic per channel
- **Alternatives**: Custom per-channel implementation
- **Status**: `PLANNED` — Sprint 5

### PartyKit — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 4K+ stars
- **What**: Real-time multiplayer infrastructure using Cloudflare Durable Objects
- **Why**: Alternative real-time backend for collaborative features. Each agent session could be a "party" with multiplayer state. Simpler than self-hosted Socket.io for certain use cases. Edge-native
- **Status**: `OPTIONAL`

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
- **Why**: Production database. Serverless scaling (pay per query), database branching for staging/preview environments (instant copy of production DB for each PR), built-in pgvector support. $50/month at launch tier. Branching is a killer feature — each preview deployment gets its own isolated database branch with no data copying overhead
- **Alternatives**: Supabase, PlanetScale (MySQL), CockroachDB
- **Status**: `PLANNED` — production deployment

### pgBouncer — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: ISC
- **What**: Lightweight connection pooler for PostgreSQL
- **Why**: Limits DB connections to 20-30 at peak (vs hundreds from microservices). Essential when running multiple services against one database
- **Status**: `PLANNED` — or use Neon's built-in pooling

### pg_stat_statements — `SHOULD USE` — `PLANNED`
- **Version**: Built into PostgreSQL 16
- **License**: PostgreSQL License
- **What**: PostgreSQL extension that tracks execution statistics of all SQL statements
- **Why**: Query performance monitoring — identify slow queries, track execution counts, measure mean/max execution time. Essential for optimizing Drizzle ORM queries in production. Zero overhead when enabled
- **Status**: `PLANNED`

### pg_cron — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: PostgreSQL License
- **GitHub**: 3K+ stars
- **What**: PostgreSQL extension for running scheduled jobs (cron) directly inside the database
- **Why**: Schedule database maintenance tasks — vacuum, partition pruning, stale session cleanup, credit reset — without external cron infrastructure. Simpler than BullMQ for periodic DB-only tasks
- **Status**: `OPTIONAL`

### TimescaleDB — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 18K+ stars
- **What**: PostgreSQL extension for time-series data with automatic partitioning (hypertables) and continuous aggregates
- **Why**: If we need efficient storage and querying of time-series metrics — agent session durations over time, credit consumption trends, LLM latency history. Auto-partitions by time, compresses old data
- **Status**: `OPTIONAL` — evaluate for analytics workload

### PgCat — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 3K+ stars
- **What**: PostgreSQL connection pooler with load balancing, sharding support, and query routing
- **Why**: Alternative to pgBouncer with additional features — query-level load balancing across read replicas, automatic sharding, and health checks. Better for multi-database setups at scale
- **Status**: `OPTIONAL` — evaluate vs pgBouncer at scale

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

### Dragonfly — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: BSL 1.1
- **GitHub**: 26K+ stars
- **What**: Modern in-memory data store, fully compatible with Redis/Memcached APIs. Multi-threaded, 25x throughput
- **Why**: Drop-in Redis replacement with dramatically better performance — 25x throughput on same hardware. Multi-threaded (Redis is single-threaded). Evaluate if Redis/Valkey becomes a bottleneck at scale (10K+ concurrent agent sessions)
- **Status**: `OPTIONAL` — performance optimization path

### NATS — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 16K+ stars
- **What**: Cloud-native messaging system with pub/sub, request/reply, and JetStream (persistent streams)
- **Why**: Alternative to Redis Pub/Sub for inter-service messaging. JetStream provides persistent message streams with replay, exactly-once delivery. Better for event sourcing patterns (agent session events). Lower latency than Redis Pub/Sub at high throughput
- **Status**: `OPTIONAL` — evaluate for event-driven architecture

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

### Mastra — `SHOULD USE` — `PLANNED`
- **Version**: ^0.5.0
- **License**: MIT
- **GitHub**: 22K+ stars
- **What**: TypeScript-native AI agent framework with built-in tool calling, RAG, workflows, and memory. First-class Vercel AI SDK integration
- **Why**: TypeScript-native alternative to LangGraph (Python). Built for our stack — works with Hono, tRPC, Zod. Agentic workflows with branching, parallel execution, and human-in-the-loop. Growing rapidly (22K stars in months)
- **Alternatives**: LangGraph (Python-first), CrewAI
- **Status**: `PLANNED`

### Claude Agent SDK — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **What**: TypeScript SDK for building Claude Code-style agents. Powers Claude Code itself. Agentic loop with tool use, streaming, and multi-turn conversations
- **Why**: Build custom agents that behave like Claude Code — autonomous coding, file editing, command execution. Official Anthropic SDK for agent development. Native support for Claude's extended thinking and tool use patterns
- **Alternatives**: Vercel AI SDK (more general), Mastra
- **Status**: `PLANNED`

### Google ADK (Agent Development Kit) — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 5K+ stars
- **What**: Google's framework for building AI agents with Gemini. Multi-agent orchestration, tool use, and memory
- **Why**: If we expand Gemini integration beyond the longContext/webSearch routes. Native Gemini function calling, grounding with Google Search, and code execution sandbox
- **Status**: `OPTIONAL`

### OpenAI Agents SDK — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 15K+ stars
- **What**: OpenAI's framework for building multi-agent systems with handoffs, guardrails, and tracing
- **Why**: If we add OpenAI models as a routing option. Built-in agent handoff patterns (specialist → generalist), input/output guardrails. Good reference architecture for multi-agent design
- **Status**: `OPTIONAL`

### Agno — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 20K+ stars
- **What**: Lightweight, model-agnostic agent framework. Minimal abstractions, maximum control
- **Why**: Alternative to heavier frameworks (LangGraph, CrewAI) when we need simple agent loops without complex orchestration. Good for single-purpose specialist agents in the fleet
- **Status**: `OPTIONAL`

### SmolAgents — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 3K+ stars (part of HuggingFace)
- **What**: Minimalist agent framework by HuggingFace. Code-first agents that write and execute Python
- **Why**: Tiny footprint, open source. Good for lightweight code execution agents. Reference implementation for code-as-action agent patterns
- **Status**: `OPTIONAL`

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
- **Version**: Latest (maintenance mode — merged into Microsoft Agent Framework, Oct 2025)
- **License**: MIT
- **GitHub**: 38K+ stars
- **What**: Multi-agent conversation framework by Microsoft Research. **Note**: AutoGen has been merged into the broader Microsoft Agent Framework as of October 2025 and is now in maintenance mode. New projects should evaluate Microsoft Agent Framework or AG2 (the community fork) instead
- **Why**: Strong multi-agent conversation patterns. Good for collaborative agent discussions (e.g., architect agent + coder agent + reviewer agent). Consider AG2 fork for active development
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

### Zoekt — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 2K+ stars
- **What**: Fast text search engine designed for source code. Trigram-based indexing for instant regex search across large codebases. Used by Sourcegraph
- **Why**: Powers code search in Project Brain. Instant regex search across entire repositories — faster than grep for indexed codebases. Agents can find relevant code across thousands of files in milliseconds. Complements tree-sitter (structural) with fast text search
- **Alternatives**: ripgrep (no index, per-query), Sourcegraph (hosted)
- **Status**: `PLANNED` — Sprint 3

### LSP Integration — `SHOULD USE` — `PLANNED`
- **Version**: N/A (protocol standard)
- **License**: N/A
- **What**: Language Server Protocol — standardized protocol for code intelligence (go-to-definition, find references, hover info, diagnostics)
- **Why**: Gives agents IDE-level code understanding — jump to definitions, find all usages of a function, get type information. Run language servers (TypeScript, Python, Go, Rust) inside sandbox containers to provide agents with the same code intelligence developers get in their IDE
- **Alternatives**: tree-sitter (lighter, no type info), CodeQL (heavier, security-focused)
- **Status**: `PLANNED`

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

### Wasmtime — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 15K+ stars
- **What**: Standalone WebAssembly runtime by the Bytecode Alliance. Fast, secure, standards-compliant
- **Why**: Lightweight sandbox alternative for specific workloads — run untrusted code as WASM modules with fine-grained capability-based security. Sub-millisecond cold starts. Could sandbox agent tool execution (file operations, network calls) without full container overhead. Emerging ecosystem for server-side WASM
- **Alternatives**: Wasmer, WasmEdge
- **Status**: `OPTIONAL` — evaluate for lightweight sandboxing

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

### Grafana Tempo — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 4K+ stars
- **What**: Distributed tracing backend by Grafana Labs. Stores and queries traces from OpenTelemetry
- **Why**: Trace every agent session end-to-end — from API request through orchestrator, model router, sandbox, back to client. Identify latency bottlenecks across microservices. Native Grafana integration for trace → log correlation
- **Alternatives**: Jaeger (heavier, self-managed)
- **Status**: `PLANNED`

### Pyroscope — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 10K+ stars
- **What**: Continuous profiling platform by Grafana Labs. CPU, memory, and allocation profiling
- **Why**: Profile Node.js services in production — find memory leaks, CPU hotspots, and slow code paths. Integrates with Grafana for unified observability (metrics + logs + traces + profiles). Essential for optimizing agent session throughput
- **Status**: `OPTIONAL`

### Netdata — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: GPL-3.0
- **GitHub**: 72K+ stars
- **What**: Real-time infrastructure monitoring with per-second granularity. Zero-config agent
- **Why**: Quick-start monitoring before full Prometheus/Grafana setup. Monitors every server and container with zero configuration. 1-second granularity. Auto-detects anomalies. Good for development and staging environments
- **Status**: `OPTIONAL`

### Pyrra — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 1K+ stars
- **What**: SLO (Service Level Objective) management with Prometheus. Define, track, and alert on error budgets
- **Why**: Define SLOs for APEX — "99.5% of agent sessions complete without errors", "p95 API latency < 200ms". Track error budgets over time. Alert before SLO is breached
- **Status**: `OPTIONAL`

### Alertmanager — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 7K+ stars
- **What**: Alert routing, grouping, and notification for Prometheus alerts. Supports PagerDuty, Slack, email, webhooks
- **Why**: Route Prometheus alerts to the right channels — critical alerts to PagerDuty, warnings to Slack, info to email. Deduplication, silencing, inhibition. Required complement to Prometheus for production alerting
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
- **What**: CDN, DDoS protection, DNS, Workers (edge compute), Image Resizing, R2 storage
- **Why**: Free DDoS protection, edge caching for static assets, DNS management, SSL. Workers for edge logic (auth checks, rate limiting, A/B routing). Image Resizing for user avatars and project thumbnails (transform on-the-fly, cache at edge). R2 for object storage (zero egress). Workers + KV for edge-cached session tokens and feature flags
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

### Argo CD — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 22K+ stars
- **What**: Declarative GitOps continuous delivery for Kubernetes. Git as single source of truth for cluster state
- **Why**: GitOps deployment model — push to `infra/k8s/` and Argo CD automatically syncs cluster state. Visual dashboard shows deployment status, drift detection, and rollback history. Essential for managing multiple environments (staging, production, EU) at scale
- **Alternatives**: Flux CD (lighter, no UI)
- **Status**: `PLANNED` — 3K+ users

### Flux CD — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 6K+ stars
- **What**: GitOps toolkit for Kubernetes. Lightweight, composable, CNCF graduated project
- **Why**: Lighter alternative to Argo CD. Better for teams that prefer CLI-first workflows over dashboards. Modular architecture — use only the components you need. Better multi-tenancy support
- **Status**: `OPTIONAL`

### Cilium — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 21K+ stars
- **What**: eBPF-based networking, observability, and security for Kubernetes. Replaces kube-proxy
- **Why**: Network security for agent sandboxes — enforce network policies at the kernel level via eBPF. Prevent sandbox containers from accessing other pods or external services they shouldn't. Built-in observability (Hubble) shows all network flows. CNCF graduated
- **Alternatives**: Calico
- **Status**: `PLANNED` — 3K+ users (security hardening)

### Linkerd — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 11K+ stars
- **What**: Ultralight service mesh for Kubernetes. mTLS, traffic management, observability
- **Why**: Automatic mTLS between all services (zero-trust networking). Traffic splitting for canary deployments. Per-route metrics and retries. Lighter than Istio — written in Rust
- **Status**: `OPTIONAL` — evaluate for zero-trust networking

### cert-manager — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 15.5K+ stars
- **What**: Automated TLS certificate management for Kubernetes. Let's Encrypt integration, automatic renewal
- **Why**: Automatic SSL/TLS for all services in k3s. Provisions and renews Let's Encrypt certificates without manual intervention. Required for HTTPS on all endpoints. Works with Traefik ingress
- **Status**: `PLANNED` — 3K+ users

### Kyverno — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 6K+ stars
- **What**: Kubernetes-native policy engine. Validate, mutate, and generate configurations using policies written in YAML
- **Why**: Enforce security policies on sandbox pods — ensure all containers use approved base images, have resource limits set, run as non-root, and have network policies applied. No new language to learn (policies are YAML, not Rego like OPA)
- **Alternatives**: OPA/Gatekeeper
- **Status**: `OPTIONAL`

### Velero — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 10K+ stars
- **What**: Backup and disaster recovery for Kubernetes resources and persistent volumes
- **Why**: Backup all Kubernetes resources and persistent volumes (PostgreSQL data, Redis snapshots). Schedule daily backups to R2/S3. Disaster recovery — restore entire cluster state. Required for production reliability
- **Status**: `PLANNED` — 3K+ users

### OpenCost — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 5K+ stars
- **What**: Real-time Kubernetes cost monitoring. Breaks down costs by namespace, deployment, pod, and label
- **Why**: Track infrastructure costs per customer/team — attribute sandbox compute costs to specific organizations. Monitor cost trends, set budgets, and alert on anomalies. Integrates with Prometheus and Grafana
- **Status**: `OPTIONAL`

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

## 33. Prompt Engineering & LLM Evaluation

### Promptfoo — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 12.8K+ stars
- **What**: LLM evaluation framework. Test prompts against multiple models with assertions, grading, and regression detection
- **Why**: Systematically evaluate and improve agent prompts. Test prompt changes against a suite of coding tasks before deploying. Compare models side-by-side (is DeepSeek V3 still the best default?). CI integration to catch prompt regressions. Essential for maintaining agent quality as we iterate
- **Alternatives**: Braintrust, Humanloop
- **Status**: `PLANNED`

### Langfuse — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 20K+ stars
- **What**: Open source LLM observability — traces, evaluations, prompt management, cost tracking. Self-hostable
- **Why**: Trace every LLM call across the agent pipeline — see the full chain of prompts, model responses, tool calls, and latencies. Track cost per session/user. A/B test prompt versions. Integrates with Vercel AI SDK and LangChain. Self-hosted for data privacy
- **Alternatives**: LangSmith (proprietary), Helicone (simpler)
- **Status**: `PLANNED`

### DeepEval — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 4K+ stars
- **What**: LLM evaluation framework with 14+ metrics (faithfulness, relevancy, hallucination, bias, toxicity)
- **Why**: Automated quality checks on agent output — detect hallucinated code, irrelevant responses, and toxic content. Unit test-style assertions for LLM outputs. Integrates with Pytest/Vitest for CI
- **Status**: `PLANNED`

### NeMo Guardrails — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 5K+ stars
- **What**: NVIDIA's toolkit for adding programmable guardrails to LLM applications. Input/output filtering, topic control, hallucination detection
- **Why**: Safety layer for agent actions — prevent agents from executing dangerous commands (rm -rf /), making unauthorized API calls, or generating harmful code. Define allowed/blocked action patterns in a Colang configuration. Essential for enterprise trust
- **Status**: `PLANNED`

### Instructor — `SHOULD USE` — `PLANNED`
- **Version**: ^1.6.0 (TypeScript)
- **License**: MIT
- **GitHub**: 9K+ stars
- **What**: Structured output extraction from LLMs using Zod/Pydantic schemas. Automatic validation and retry
- **Why**: Extract structured data from LLM responses — agent task plans, code review results, PR metadata. Native Zod integration for TypeScript. Automatic retry on validation failure. Works with any LLM provider. Lighter than LangChain for structured extraction
- **Alternatives**: Outlines, BAML
- **Status**: `PLANNED`

### BAML — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 3K+ stars
- **What**: Domain-specific language for structured LLM output. Compile-time type safety for LLM functions
- **Why**: Alternative to Instructor/Zod for defining structured LLM outputs. Generates type-safe clients from BAML schemas. Better for complex nested outputs and multi-step extraction. Compile-time guarantees reduce runtime errors
- **Status**: `OPTIONAL`

---

## 34. Agent Evaluation & Benchmarking

### SWE-bench — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 2K+ stars
- **What**: Benchmark for evaluating AI coding agents on real-world GitHub issues. 2,294 tasks from 12 popular Python repositories
- **Why**: Measure APEX agent quality objectively — track our SWE-bench score over time as we improve the agent. Compare against competitors (Devin, Cursor, Copilot). Use SWE-bench Lite (300 tasks) for quick evaluation. Target: >40% resolution rate for competitive positioning
- **Status**: `OPTIONAL` — benchmarking initiative

---

## 35. Web Crawling & Data Extraction

### Firecrawl — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 70K+ stars
- **What**: Web crawling and scraping API that returns clean markdown/structured data. Handles JavaScript rendering, anti-bot, and rate limiting
- **Why**: Agent can crawl documentation sites, API references, and Stack Overflow answers to gather context for coding tasks. Returns clean markdown (not raw HTML) — perfect for LLM consumption. Used for: "read the docs for library X", "find examples of Y"
- **Alternatives**: Crawl4AI, Playwright (manual)
- **Status**: `PLANNED`

### Crawl4AI — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 40K+ stars
- **What**: Open source, LLM-friendly web crawler. Returns structured data optimized for RAG pipelines
- **Why**: Self-hosted alternative to Firecrawl. Better for bulk crawling (entire documentation sites for Project Brain indexing). Async, parallel crawling. Outputs markdown, structured JSON, or screenshots
- **Status**: `OPTIONAL`

---

## 36. Secrets Management

### Infisical — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 25K+ stars
- **What**: Open source secrets management platform. Environment variables, API keys, certificates. Self-hostable
- **Why**: Centralized secrets management for all 9 microservices. Replace .env files with encrypted, versioned, audited secrets. Secret rotation, access policies, and audit logs. SDK integrates directly with Node.js. Essential for production security and SOC2 compliance
- **Alternatives**: HashiCorp Vault (heavier), Doppler (proprietary)
- **Status**: `PLANNED`

### External Secrets Operator — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 4.5K+ stars
- **What**: Kubernetes operator that syncs secrets from external providers (Infisical, AWS Secrets Manager, Vault) into k8s Secrets
- **Why**: Bridge between Infisical (or any secrets provider) and Kubernetes. Automatically syncs secrets into k8s pods without baking them into container images. Required for secure k3s deployment at scale
- **Status**: `PLANNED` — 3K+ users (with k3s)

### SOPS — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MPL-2.0
- **GitHub**: 17K+ stars
- **What**: Secrets OPerationS — encrypt/decrypt files using AWS KMS, GCP KMS, Azure Key Vault, or age/PGP
- **Why**: Encrypt secrets in Git — commit encrypted .env files or k8s secrets to the repo safely. Simpler than Infisical for small teams. Works with age for local encryption (no cloud dependency)
- **Status**: `OPTIONAL`

---

## 37. Status Pages & Uptime

### OpenStatus — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 8.3K+ stars
- **What**: Open source status page and monitoring. Beautiful UI, incident management, status subscribers
- **Why**: Public status page for APEX (status.apex.dev). Shows uptime for all services, incident history, and scheduled maintenance. Subscribers get notified of outages. Built with Next.js — fits our stack
- **Alternatives**: Cachet, Statuspage.io (proprietary)
- **Status**: `PLANNED`

### Gatus — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 7K+ stars
- **What**: Health dashboard and automated health checks. Supports HTTP, TCP, DNS, ICMP, and more
- **Why**: Lightweight uptime monitoring with alerting. Define health checks for all endpoints in YAML. Supports conditions (response time < 200ms, status code 200). Alerts via Slack, PagerDuty, email
- **Status**: `OPTIONAL`

### Uptime Kuma — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 84K+ stars
- **What**: Self-hosted uptime monitoring tool with beautiful UI. HTTP, TCP, DNS, Docker, and game server monitoring
- **Why**: Internal uptime monitoring dashboard. Monitor all 9 services, database, Redis, and external dependencies. Beautiful UI for the team. 84K stars — most popular self-hosted monitoring tool. Notification integrations (Slack, Discord, email, PagerDuty)
- **Alternatives**: Gatus (lighter), Checkly (managed)
- **Status**: `PLANNED`

---

## 38. Security Scanning & Compliance

### Trivy — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 32K+ stars
- **What**: Comprehensive security scanner — container images, filesystems, IaC, Kubernetes, SBOM. By Aqua Security
- **Why**: Scan sandbox Docker images for vulnerabilities before deployment. Scan IaC (Dockerfiles, k8s manifests) for misconfigurations. Generate SBOMs for compliance. Runs in CI/CD (GitHub Actions). Single tool for multiple security scan types
- **Alternatives**: Grype + Syft (modular alternative)
- **Status**: `PLANNED` — Sprint 6

### Grype — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 9K+ stars
- **What**: Vulnerability scanner for container images and filesystems. By Anchore
- **Why**: Lightweight alternative to Trivy focused purely on vulnerability scanning. Faster scanning, smaller footprint. Pairs with Syft for SBOM generation
- **Status**: `OPTIONAL`

### Gitleaks — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 24.4K+ stars
- **What**: Secret detection tool for git repositories. Pre-commit hook and CI scanning
- **Why**: Prevent API keys, passwords, and tokens from being committed to the repo. Pre-commit hook catches secrets before they reach GitHub. CI scanning catches anything that slips through. Essential — agent-generated code might accidentally include secrets from sandbox environment
- **Alternatives**: TruffleHog (more features)
- **Status**: `PLANNED` — Sprint 1 (pre-commit)

### TruffleHog — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 24.5K+ stars
- **What**: Secret scanning tool that finds credentials in git history, filesystems, and cloud services. Verifies secrets are live
- **Why**: Deep secret scanning — scans entire git history (not just current state). Verifies if discovered secrets are still active. Scans user repositories before agent processes them (prevent credential exposure). Broader detection than Gitleaks (3000+ detectors)
- **Status**: `PLANNED` — Sprint 6

### Syft — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 6K+ stars
- **What**: SBOM (Software Bill of Materials) generator for container images and filesystems. By Anchore
- **Why**: Generate SBOMs for compliance (SOC2, enterprise customers). Pairs with Grype for vulnerability scanning. Output formats: SPDX, CycloneDX
- **Status**: `OPTIONAL`

### Falco — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 11.7K+ stars
- **What**: Cloud-native runtime security. Detects threats in containers, Kubernetes, and cloud. CNCF graduated project
- **Why**: Runtime security monitoring for agent sandbox containers. Detect suspicious behavior — shell spawning, file access outside /workspace, network connections to unexpected hosts, privilege escalation attempts. Alert and kill containers exhibiting malicious behavior. Critical for running untrusted code
- **Status**: `PLANNED` — Sprint 6

---

## 39. Feature Flags & Experimentation

### GrowthBook — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 6K+ stars
- **What**: Open source feature flags and A/B testing platform. Self-hostable. Bayesian statistics engine
- **Why**: Feature flags for gradual rollouts — new agent capabilities, UI changes, model routing updates. A/B test different prompts, models, or UI layouts. SDK integrates with Next.js and Hono. Self-hosted for data privacy. Targeting by organization, plan tier, or user segment
- **Alternatives**: Unleash, Flagsmith, LaunchDarkly (proprietary)
- **Status**: `PLANNED`

### Unleash — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **GitHub**: 11K+ stars
- **What**: Enterprise feature flag management with SDKs for 30+ languages. Self-hostable
- **Why**: Alternative to GrowthBook with more enterprise features — audit log, change requests, scheduled flags. Larger community and more mature. Better for enterprise customers who need approval workflows for flag changes
- **Status**: `OPTIONAL`

### Flagsmith — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: BSD-3
- **GitHub**: 5K+ stars
- **What**: Feature flags with remote config. Supports segments, multivariate flags, and change history
- **Why**: Simpler alternative to GrowthBook/Unleash. Remote configuration lets us change model routing weights, credit limits, and UI copy without deployments. Good for small teams who need flags without the complexity
- **Status**: `OPTIONAL`

---

## 40. Documentation & API Reference

### Docusaurus — `SHOULD USE` — `PLANNED`
- **Version**: ^3.0.0
- **License**: MIT
- **GitHub**: 61.8K+ stars
- **What**: Documentation framework by Meta. MDX-based, versioned, searchable, i18n support
- **Why**: APEX public documentation site (docs.apex.dev). User guides, API reference, agent capabilities, integration docs. Versioned docs for different APEX releases. Built-in search. MDX for interactive examples. Massive ecosystem (61K+ stars)
- **Alternatives**: Nextra, Mintlify (proprietary), Fumadocs
- **Status**: `PLANNED`

### Scalar — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 8K+ stars
- **What**: Beautiful API documentation from OpenAPI specs. Interactive API playground, code examples in 20+ languages
- **Why**: API reference for the APEX public API (tRPC exports OpenAPI via trpc-openapi). Developers can explore and test API endpoints directly in the browser. Auto-generated from our tRPC router definitions. Modern alternative to Swagger UI
- **Alternatives**: Swagger UI, Redoc
- **Status**: `PLANNED`

### Fumadocs — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 3K+ stars
- **What**: Next.js documentation framework. MDX, full-text search, API reference generation
- **Why**: Alternative to Docusaurus that runs on Next.js — same framework as APEX. Could serve docs from the same deployment. TypeScript-native, Tailwind-styled. Better integration with our existing stack
- **Status**: `OPTIONAL`

---

## 41. Desktop & CLI

### Tauri 2.0 — `CAN USE` — `OPTIONAL`
- **Version**: ^2.0.0
- **License**: MIT / Apache-2.0
- **GitHub**: 88K+ stars
- **What**: Build native desktop apps using web technologies. Rust core, tiny bundles (~600KB), native OS integration
- **Why**: APEX desktop app for offline/local agent execution. Access local filesystem, run Docker containers, use local LLMs — all from a native app. 10x smaller than Electron. Deep OS integration (system tray, native menus, file associations)
- **Alternatives**: Electron (larger, more mature ecosystem)
- **Status**: `OPTIONAL` — future desktop initiative

### Electron — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 115K+ stars
- **What**: Cross-platform desktop apps with web technologies. Used by VS Code, Slack, Discord
- **Why**: Alternative to Tauri with a more mature ecosystem. Larger bundle size but better compatibility. VS Code is built on Electron, proving it works for developer tools at scale
- **Status**: `OPTIONAL`

### Ink 5 — `SHOULD USE` — `PLANNED`
- **Version**: ^5.0.0
- **License**: MIT
- **GitHub**: 27K+ stars
- **What**: React for CLIs — build interactive command-line apps using React components and hooks
- **Why**: Build the APEX CLI tool with React component model. Interactive task creation, real-time agent status, streaming output — all in the terminal. Same mental model as our web frontend. Used by Vercel CLI, Gatsby, Prisma
- **Alternatives**: Blessed (lower-level), Clack (simpler)
- **Status**: `PLANNED`

### Commander.js — `SHOULD USE` — `PLANNED`
- **Version**: ^12.0.0
- **License**: MIT
- **GitHub**: 27K+ stars
- **What**: Complete CLI framework — command parsing, help generation, subcommands, options
- **Why**: Foundation for the APEX CLI (`apex run`, `apex status`, `apex config`). Automatic help text generation, argument validation, subcommand routing. Pairs with Ink for the interactive UI layer
- **Alternatives**: yargs, oclif
- **Status**: `PLANNED`

### oclif — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 9K+ stars
- **What**: CLI framework by Salesforce. Plugin system, auto-docs, testing utilities
- **Why**: Alternative to Commander.js for larger CLIs. Built-in plugin system (users can extend the APEX CLI). Auto-generates man pages and markdown docs. Better for CLIs that need to be extensible
- **Status**: `OPTIONAL`

### VS Code Extension API — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **What**: Build extensions for VS Code — the most popular code editor (75%+ market share among developers)
- **Why**: APEX VS Code extension — trigger agent tasks, view session output, browse diffs, approve PRs — all without leaving the editor. Captures the audience where they already work. Extension marketplace distribution. WebSocket connection to APEX backend
- **Status**: `PLANNED`

### JetBrains Plugin SDK — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: Apache-2.0
- **What**: Build plugins for IntelliJ IDEA, WebStorm, PyCharm, and other JetBrains IDEs
- **Why**: JetBrains IDEs have significant market share (30%+) especially among Java/Kotlin and Python developers. APEX plugin for JetBrains — same functionality as VS Code extension for the other major IDE ecosystem
- **Status**: `OPTIONAL` — after VS Code extension

---

## 42. Analytics & Tracking

### PostHog — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 25K+ stars
- **What**: All-in-one product analytics — event tracking, funnels, feature flags, session replay, A/B testing. Self-hostable
- **Why**: Understand how users use APEX — which features are popular, where users drop off, what task types are most common. Funnels: sign up → first task → first PR → paid plan. Session replay for UX debugging. Self-hosted for data privacy. Replaces 3-4 separate tools
- **Alternatives**: Mixpanel (proprietary), Amplitude (proprietary)
- **Status**: `PLANNED`

### Umami — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 24K+ stars
- **What**: Simple, privacy-focused web analytics. Self-hosted, no cookies, GDPR compliant
- **Why**: Lightweight alternative to PostHog for basic web analytics. No cookie banners needed. Page views, referrers, device stats. Good for the marketing site (apex.dev) where full product analytics isn't needed
- **Alternatives**: Plausible
- **Status**: `OPTIONAL`

### Plausible — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: AGPL-3.0
- **GitHub**: 21K+ stars
- **What**: Privacy-friendly web analytics. Lightweight (<1KB script), no cookies, EU-hosted option
- **Why**: Alternative to Umami. Even lighter script (<1KB vs Umami's ~2KB). EU-hosted cloud option for GDPR. Simple dashboard for marketing metrics
- **Status**: `OPTIONAL`

### OpenPanel — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 3K+ stars
- **What**: Open source alternative to Mixpanel. Event analytics, funnels, retention, user profiles
- **Why**: If PostHog is too heavy, OpenPanel provides focused event analytics. Better funnels and retention analysis than Umami/Plausible. Good middle ground between simple analytics and full PostHog
- **Status**: `OPTIONAL`

### rrweb — `SHOULD USE` — `PLANNED`
- **Version**: ^2.0.0
- **License**: MIT
- **GitHub**: 17K+ stars
- **What**: Record and replay web sessions. Captures DOM mutations, mouse movement, scrolling, and network requests
- **Why**: Session replay for debugging user-reported issues. See exactly what the user saw when they report a bug. Replay agent session UIs to understand UX problems. Integrates with Sentry and PostHog. Smaller and more focused than full PostHog session replay
- **Status**: `PLANNED`

### OpenReplay — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: ELv2
- **GitHub**: 10K+ stars
- **What**: Self-hosted session replay and product analytics. Co-browsing, error tracking, performance monitoring
- **Why**: Full-featured alternative to rrweb + Sentry. Self-hosted session replay with integrated error tracking. Co-browsing feature lets support team see user's screen live. Good for enterprise customers requiring self-hosted analytics
- **Status**: `OPTIONAL`

---

## 43. Mobile & PWA

### React Native + Expo — `CAN USE` — `OPTIONAL`
- **Version**: Expo SDK 52+, React Native 0.76+
- **License**: MIT
- **GitHub**: 120K+ stars (RN) + 36K+ (Expo)
- **What**: Build native mobile apps using React. Expo simplifies development with managed workflow, OTA updates, and build service
- **Why**: APEX mobile app — monitor agent sessions, approve PRs, view notifications on the go. Share React components and business logic with web app. Expo's EAS Build and OTA updates enable rapid iteration. Push notifications for task completion
- **Alternatives**: Flutter (Dart, different ecosystem)
- **Status**: `OPTIONAL` — future mobile initiative

### Serwist — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 1K+ stars
- **What**: Progressive Web App (PWA) toolkit for Next.js. Service workers, caching strategies, offline support. Successor to next-pwa
- **Why**: Make APEX installable as a PWA — works offline, push notifications, app-like experience on mobile. Service worker caches static assets and API responses. Background sync for offline task creation. Faster than building a native mobile app
- **Alternatives**: @vite-pwa/nuxt (Vite-based)
- **Status**: `PLANNED`

### expo-notifications — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **What**: Push notification support for Expo/React Native apps
- **Why**: If we build a native mobile app, push notifications for task completion, PR approvals, credit alerts. Works on both iOS and Android
- **Status**: `OPTIONAL` — with React Native + Expo

---

## 44. Accessibility & i18n

### next-intl — `SHOULD USE` — `PLANNED`
- **Version**: ^3.0.0
- **License**: MIT
- **GitHub**: 3K+ stars
- **What**: Internationalization for Next.js App Router. ICU message format, server components support, type-safe
- **Why**: i18n support for APEX — English first, then Japanese, German, French, Spanish for international markets. Server component support means translations don't bloat client bundle. Type-safe message keys prevent missing translations. Works with App Router
- **Alternatives**: i18next + react-i18next (more general)
- **Status**: `PLANNED`

### i18next — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 8K+ stars
- **What**: Internationalization framework for JavaScript. Framework-agnostic, plugin ecosystem, lazy loading
- **Why**: Alternative to next-intl for i18n. Larger ecosystem and more plugins. Better if we need i18n outside Next.js (CLI, emails, error messages). react-i18next adapter for React components
- **Status**: `OPTIONAL`

### axe-core — `SHOULD USE` — `PLANNED`
- **Version**: Latest
- **License**: MPL-2.0
- **GitHub**: 6K+ stars
- **What**: Accessibility testing engine. WCAG 2.1 compliance checks on rendered HTML
- **Why**: Automated accessibility testing in CI. Ensures APEX UI meets WCAG 2.1 AA standards — keyboard navigation, screen reader support, color contrast, ARIA attributes. Integrates with Playwright for E2E accessibility testing. Required for enterprise/government customers
- **Alternatives**: pa11y
- **Status**: `PLANNED`

### vitest-axe — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **What**: Custom Vitest matchers for axe-core accessibility testing. `expect(element).toHaveNoViolations()`
- **Why**: Unit-level accessibility testing — test individual shadcn components for a11y violations in Vitest. Catches accessibility issues earlier than E2E tests with axe-core + Playwright
- **Status**: `OPTIONAL`

---

## 5a. Image & Media Processing

### Sharp — `SHOULD USE` — `PLANNED`
- **Version**: ^0.33.0
- **License**: Apache-2.0
- **GitHub**: 30K+ stars
- **What**: High-performance Node.js image processing. Resize, crop, convert, optimize images using libvips
- **Why**: Process user avatars, project thumbnails, and agent-captured screenshots. Optimize images before storing in R2/MinIO. Generate responsive image sizes. 10-100x faster than ImageMagick. Used by Next.js Image component under the hood
- **Alternatives**: Jimp (pure JS, slower)
- **Status**: `PLANNED`

### @unpic/react — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 2K+ stars
- **What**: Universal image component for React. Responsive, lazy-loaded, CDN-optimized. Works with any image CDN
- **Why**: Optimized image rendering in APEX UI — user avatars, screenshots, project icons. Automatic srcset generation, lazy loading, blur-up placeholders. Works with Cloudflare Image Resizing or any CDN
- **Status**: `OPTIONAL`

### @react-pdf/renderer — `CAN USE` — `OPTIONAL`
- **Version**: Latest
- **License**: MIT
- **GitHub**: 15K+ stars
- **What**: Generate PDF documents using React components. Server-side or client-side rendering
- **Why**: Generate PDF reports — agent session summaries, billing invoices, audit logs for enterprise customers. React component model makes complex layouts easy. Type-safe with TypeScript
- **Status**: `OPTIONAL` — enterprise reporting

---

## Technology Count Summary

| Classification | Count |
|---------------|-------|
| **MUST USE** | 51 |
| **SHOULD USE** | 84 |
| **CAN USE** | 106 |
| **Total Technologies** | **241** |

| Status | Count |
|--------|-------|
| **IN USE** (already in codebase) | 28 |
| **PLANNED** (scheduled for implementation) | 135 |
| **OPTIONAL** (evaluate when needed) | 78 |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│  Next.js 15 + shadcn/ui + AI Elements + Tailwind v4 + Zustand  │
│  React Query + tRPC Client + Socket.io Client + Framer Motion   │
│  xterm.js + react-markdown + Shiki + Mermaid + assistant-ui     │
│  Sonner + react-hook-form + dnd-kit + TanStack Virtual          │
└────────────────────┬────────────────────────────────────────────┘
                     │ SSE / WebSocket / tRPC
┌────────────────────┴────────────────────────────────────────────┐
│                     API LAYER                                    │
│  Hono + tRPC Server + Clerk Auth + Zod Validation               │
│  Upstash Ratelimit + Stripe Webhooks + Cloudflare CDN/Workers   │
│  GrowthBook (feature flags) + Novu (notifications)              │
└──┬──────────┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │          │
┌──┴──┐  ┌───┴──┐  ┌───┴───┐  ┌──┴──┐  ┌───┴────┐
│Orch.│  │Sand- │  │Model  │  │Proj.│  │MCP     │
│     │  │box   │  │Router │  │Brain│  │Gateway │
│Open │  │Mgr   │  │       │  │     │  │        │
│Hands│  │Docker│  │claude │  │tree-│  │GitHub  │
│Lang │  │+gVis │  │-code- │  │sitter│ │Linear  │
│Graph│  │or    │  │router │  │Cognee│ │Jira    │
│Mastr│  │Wasm  │  │LiteLLM│  │Zoekt│  │Slack   │
│a    │  │time  │  │       │  │LSP  │  │        │
└──┬──┘  └──┬───┘  └──┬────┘  └──┬──┘  └───┬────┘
   │        │         │          │          │
┌──┴────────┴─────────┴──────────┴──────────┴─────────────────────┐
│                     DATA LAYER                                    │
│  PostgreSQL 16 + pgvector │ Redis/Valkey │ MinIO/R2 │ Memgraph  │
│  Drizzle ORM │ BullMQ │ Mem0 │ Letta │ Meilisearch │ Infisical │
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────────┐
│                     LLM PROVIDERS                                │
│  DeepSeek V3/R1 │ Claude Sonnet/Opus │ Gemini Flash │ Ollama   │
│  Qwen2.5-Coder │ Groq │ Cerebras │ OpenRouter │ Mistral       │
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────────┐
│                     AI QUALITY LAYER                              │
│  Promptfoo │ Langfuse │ DeepEval │ NeMo Guardrails │ Instructor│
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────────┐
│                     INFRASTRUCTURE                               │
│  Fly.io │ Hetzner │ Cloudflare │ GitHub Actions │ Docker        │
│  k3s + KEDA + Traefik + Argo CD + Cilium + cert-manager (scale)│
│  OpenTelemetry + Prometheus + Grafana + Sentry + Pino + Loki   │
│  Grafana Tempo + Alertmanager │ Uptime Kuma + OpenStatus        │
│  Trivy + Gitleaks + TruffleHog + Falco (security)              │
│  Velero (backup) │ GrowthBook (flags) │ PostHog (analytics)     │
└─────────────────────────────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────────┐
│                     DEVELOPER EXPERIENCE                         │
│  VS Code Extension │ Ink CLI │ Docusaurus │ Scalar API Docs     │
│  Serwist (PWA) │ next-intl (i18n) │ axe-core (a11y)            │
└─────────────────────────────────────────────────────────────────┘
```

---

> **This document is the single source of truth for all technology decisions in the Prometheus/APEX project.**
> Update it as technologies are evaluated, adopted, or replaced.
