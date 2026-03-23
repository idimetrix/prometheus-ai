---
title: Agents
description: Overview of the 12 specialist agents that power Prometheus
order: 4
---

## Agent Overview

Prometheus uses 12 specialist agents, each responsible for a distinct phase of the software development lifecycle. The **Orchestrator** coordinates all other agents, selecting the right combination for each task.

## Agent Reference

| Agent | Model | Tools | Use Case |
|-------|-------|-------|----------|
| Orchestrator | Claude Opus | Task routing, plan execution | Coordinates agent workflows and delegates sub-tasks |
| Discovery | Claude Sonnet | Codebase search, file read | Analyzes requirements, gathers context from existing code |
| Architect | Claude Opus | Diagram generation, schema design | Designs system architecture, data models, and API contracts |
| Planner | Claude Sonnet | Task decomposition | Creates ordered implementation plans with dependencies |
| Project Brain | Claude Sonnet | Embeddings, vector search | Maintains project knowledge, indexes codebase for context |
| Frontend Coder | Claude Sonnet | File write, terminal, browser | Implements UI components, pages, and client-side logic |
| Backend Coder | Claude Sonnet | File write, terminal, sandbox | Implements server-side logic, APIs, and database queries |
| Integration Coder | Claude Sonnet | File write, terminal, HTTP | Connects services, configures third-party integrations |
| Test Engineer | Claude Sonnet | File write, terminal, sandbox | Writes unit/integration/e2e tests and validates coverage |
| CI Loop | Claude Haiku | Terminal, git | Runs builds, lints, and tests; auto-fixes failures |
| Security Auditor | Claude Sonnet | File read, search, sandbox | Reviews code for vulnerabilities and security best practices |
| Deploy Engineer | Claude Sonnet | Terminal, file write, HTTP | Handles deployment configuration, infrastructure, and rollouts |

## How Agents Are Selected

When you submit a task, the Orchestrator analyzes the prompt and selects agents based on the work required:

- **Task mode** — Orchestrator picks the relevant agents and runs them in sequence or parallel depending on dependencies.
- **Plan mode** — Discovery and Planner agents generate a plan without executing it.
- **Ask mode** — Discovery and Project Brain retrieve context and answer questions.
- **Watch mode** — CI Loop monitors builds and auto-fixes failures.
- **Fleet mode** — Multiple coding agents run in parallel for large tasks.

## Agent Communication

Agents communicate through a shared context system:

1. **Context passing** — Each agent receives the output of previous agents as input context.
2. **Project Brain** — Stores and retrieves project-specific knowledge that persists across sessions.
3. **Sandbox** — Agents that execute code do so in isolated containers managed by the Sandbox Manager.
4. **Model Router** — Selects the optimal model for each agent invocation based on task complexity and cost.

## Agent Lifecycle

1. **Initialization** — Agent receives task context and available tools.
2. **Planning** — Agent determines the steps needed to complete its sub-task.
3. **Execution** — Agent performs actions using its assigned tools.
4. **Validation** — Agent verifies its work (e.g., running tests, checking types).
5. **Handoff** — Agent returns results to the Orchestrator for the next phase.
