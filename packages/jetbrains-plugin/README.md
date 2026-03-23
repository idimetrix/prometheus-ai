# @prometheus/jetbrains-plugin

Prometheus AI plugin for JetBrains IDEs (IntelliJ IDEA, WebStorm, PyCharm, GoLand, etc.).

## Features

- **Tool Window** -- Sidebar panel for submitting tasks, viewing agent output, and managing sessions.
- **Settings Panel** -- Configure API URL, API key, preferred model, and streaming under `Settings > Tools > Prometheus AI`.
- **Actions** -- Submit tasks and start sessions from the `Tools > Prometheus AI` menu.
- **SSE Streaming** -- Real-time agent event stream via OkHttp SSE client.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| JDK | 17+ |
| IntelliJ IDEA | 2024.1+ (Community or Ultimate) |
| Kotlin | 1.9+ (bundled with Gradle plugin) |
| Gradle | 8+ (uses Gradle wrapper) |

## Quick Start

```bash
# Build the plugin distribution (.zip)
./gradlew buildPlugin

# Run a sandboxed IDE with the plugin installed
./gradlew runIde

# Run tests
./gradlew test

# Verify the plugin descriptor
./gradlew verifyPlugin
```

The built plugin ZIP is output to `build/distributions/`.

## Architecture

```
src/main/kotlin/dev/prometheus/
  PrometheusPlugin.kt       -- Startup activity (project-level bootstrap)
  PrometheusSettings.kt     -- Persistent settings + Settings UI configurable
  PrometheusClient.kt       -- OkHttp client mirroring the shared TS API client
  PrometheusToolWindow.kt   -- Tool window factory + chat/task panel
  actions/
    SubmitTaskAction.kt      -- Menu action: submit a task
    StartSessionAction.kt   -- Menu action: start a session

src/main/resources/META-INF/
  plugin.xml                 -- IntelliJ plugin descriptor
```

### Shared API Client

The HTTP API surface is defined once in the shared TypeScript module at
`packages/vscode-extension/src/shared/api-client.ts` and mirrored in Kotlin
by `PrometheusClient.kt`. Both expose the same five operations:

| Operation | Endpoint |
|-----------|----------|
| `createSession` | `POST /api/sessions` |
| `submitTask` | `POST /api/tasks` |
| `getTaskStatus` | `GET /api/tasks/:id` |
| `cancelTask` | `DELETE /api/tasks/:id` |
| `streamEvents` | `GET /api/sessions/:id/events` (SSE) |

### Dependencies

- **OkHttp 4** -- HTTP + SSE client
- **Gson** -- JSON serialization
- **IntelliJ Platform SDK 2024.1** -- IDE integration

## Configuration

After installing the plugin, go to **Settings > Tools > Prometheus AI** and set:

| Field | Default | Description |
|-------|---------|-------------|
| API URL | `http://localhost:4000` | Prometheus API server address |
| API Key | *(empty)* | Bearer token for authentication |
| Preferred Model | `auto` | Model selection preference |
| Stream Responses | `true` | Enable SSE event streaming |

## Development Notes

- The plugin targets IntelliJ platform builds 241 through 243 (2024.1 -- 2024.3).
- Kotlin source lives under the standard Gradle `src/main/kotlin` layout.
- The Gradle IntelliJ Plugin (`org.jetbrains.intellij` 1.17.2) handles SDK downloads and sandboxed IDE launches.
- This package is excluded from pnpm workspace TypeScript tooling (no `tsconfig.json`).

## Feature Parity Targets

Tracking VS Code extension feature parity:

- [x] Agent chat panel (basic)
- [x] Task submission
- [x] Session management (start / connect / disconnect)
- [x] Settings UI
- [ ] Agent fleet status view
- [ ] Code actions and quick fixes
- [ ] Auto PR generation
- [ ] AI-assisted code review
- [ ] Editor annotations and inlays
- [ ] Status bar widget
