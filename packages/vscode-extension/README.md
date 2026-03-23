# Prometheus AI — VS Code Extension

AI-powered engineering assistant that brings the full Prometheus agent fleet into your editor.

## Features

- **Agent Chat Panel** — Conversational interface to interact with Prometheus AI agents directly from the sidebar.
- **Task Submission** — Submit engineering tasks (`prometheus.assignTask`) and track progress in real time.
- **Session Management** — Start, stop, and monitor agent sessions without leaving VS Code.
- **Agent Status View** — See which agents are active, idle, or processing across your fleet.
- **Code Actions** — Context-aware quick fixes and refactoring suggestions powered by AI.
- **Auto PR Generation** — Generate pull requests from completed agent tasks with one click.
- **PR Review** — AI-assisted code review annotations inline in diff views.
- **Status Bar** — Live connection status and active session indicator in the VS Code status bar.
- **Dashboard Webview** — Overview of project metrics, recent tasks, and agent activity.

## Screenshots

> **Chat Panel** — The sidebar chat panel shows agent responses, code suggestions, and approval checkpoints.

> **Agent Status** — The tree view lists all active agents with their current state and assigned tasks.

> **Status Bar** — A compact status bar item shows connection health and the active session name.

## Installation

### From Marketplace

Search for **Prometheus AI** in the VS Code Extensions panel or install from the command line:

```bash
code --install-extension prometheus.prometheus-vscode
```

### From Source

```bash
cd packages/vscode-extension
pnpm install
pnpm build
# Then press F5 in VS Code to launch the Extension Development Host
```

## Configuration

Open **Settings** (`Ctrl+,`) and search for "Prometheus" or edit `settings.json` directly:

| Setting | Default | Description |
|---------|---------|-------------|
| `prometheus.apiUrl` | `http://localhost:4000` | URL of the Prometheus API server |
| `prometheus.socketUrl` | `ws://localhost:4001` | URL of the Prometheus WebSocket server |
| `prometheus.apiToken` | `""` | API authentication token |

## Keyboard Shortcuts

| Shortcut | Command | Condition |
|----------|---------|-----------|
| `Ctrl+Shift+P` / `Cmd+Shift+P` | Open Chat | Session active |

All commands are also available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `Prometheus: Start Session`
- `Prometheus: Open Chat`
- `Prometheus: Assign Task`
- `Prometheus: Submit Task`
- `Prometheus: Show Dashboard`
- `Prometheus: Approve Checkpoint`
- `Prometheus: View Agent Status`
- `Prometheus: Stop Session`
- `Prometheus: Configure API Settings`

## Requirements

- VS Code 1.95.0 or later
- A running Prometheus API server (local or remote)
- An API token (generate one from the Prometheus web dashboard under Settings > API Keys)
