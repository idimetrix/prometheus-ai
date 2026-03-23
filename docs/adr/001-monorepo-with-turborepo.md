# ADR-001: Monorepo with Turborepo

## Status

Accepted

## Context

Prometheus is an AI-powered engineering platform composed of 9 services and 15 shared packages. During early development, several architectural options were considered for repository structure:

1. **Polyrepo** -- each service in its own repository with separate CI/CD pipelines. This maximizes isolation but makes cross-cutting changes (schema updates, shared types, utility refactors) extremely painful. Keeping versions in sync across repos requires a dedicated dependency management strategy.

2. **Monorepo with Nx** -- Nx offers powerful computation caching and task orchestration. However, its plugin-heavy approach and opinionated project structure add configuration overhead, and the team had more experience with lighter-weight alternatives.

3. **Monorepo with Turborepo + pnpm workspaces** -- Turborepo provides incremental builds, remote caching, and parallel task execution with minimal configuration. Combined with pnpm workspaces for dependency management, it keeps the setup lean while enabling strong cross-package type safety.

Key requirements driving the decision:

- **Shared types and schemas** -- tRPC routers, Drizzle schema definitions, Zod validators, and utility functions must be consumed by multiple services without publishing to a registry.
- **Atomic cross-service changes** -- a database schema change often requires simultaneous updates to the API, orchestrator, and web frontend.
- **Fast CI** -- with 9 services, build times must scale sub-linearly. Only affected packages should rebuild on a given change.
- **Developer experience** -- a single `pnpm dev` command should start the entire platform locally.

## Decision

Use a Turborepo monorepo with pnpm workspaces.

- All 9 services live under `apps/`.
- All 15 shared packages live under `packages/`.
- Infrastructure configuration (Docker, Kubernetes, deployment scripts) lives under `infra/`.
- Turborepo handles task orchestration (`build`, `dev`, `typecheck`, `test`, `lint`) with dependency-aware caching.
- pnpm workspaces manages inter-package dependencies via `workspace:*` protocol, ensuring local packages are always resolved from source rather than a registry.
- Biome + Ultracite provides unified formatting and linting across the entire repo from a single root configuration.

## Consequences

### Positive

- **Single source of truth** -- all types, schemas, and utilities are shared directly. A change to `@prometheus/db` is immediately visible to every consumer without publishing or versioning.
- **Atomic commits** -- cross-cutting changes (e.g., adding a new DB column, updating the tRPC router, and reflecting it in the UI) happen in a single commit with full type safety.
- **Fast incremental builds** -- Turborepo's content-hash-based caching means unchanged packages are not rebuilt. Remote caching via Vercel further speeds up CI.
- **Simplified onboarding** -- new contributors clone one repo, run `pnpm install && pnpm dev`, and have the entire platform running locally.
- **Consistent tooling** -- one Biome config, one TypeScript config hierarchy, one set of Git hooks (Lefthook) applies uniformly.

### Negative

- **Repository size** -- the repo will grow as more services and packages are added. Git operations (clone, status) may slow down over time, though pnpm's hard-linking and Turborepo's pruning mitigate this.
- **CI complexity** -- while Turborepo handles caching well, the CI pipeline must be configured to correctly detect affected packages. Misconfigured cache keys can cause stale builds.
- **Blast radius** -- a broken commit on `main` can block all services. This is mitigated by branch protection rules, required CI checks, and the Lefthook pre-push typecheck hook.
- **pnpm learning curve** -- pnpm's strict dependency resolution (no phantom dependencies) occasionally requires explicit `dependencies` entries that npm/yarn would auto-resolve. This is a net positive for correctness but adds initial friction.
