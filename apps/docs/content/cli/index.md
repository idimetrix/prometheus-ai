---
title: CLI Reference
description: Prometheus command-line interface
order: 7
---

## Installation

Install the Prometheus CLI globally:

```bash
npm install -g @prometheus/cli
```

Or use it via npx:

```bash
npx @prometheus/cli <command>
```

## Configuration

### Login

Authenticate with your Prometheus account:

```bash
prometheus login
```

This opens a browser window for authentication and stores the session token locally.

### Set Project

Link the current directory to a Prometheus project:

```bash
prometheus init
```

This creates a `.prometheus.json` config file in your project root.

### Configuration File

The `.prometheus.json` file stores project settings:

```json
{
  "projectId": "proj_abc123",
  "orgId": "org_xyz789",
  "defaultMode": "task",
  "apiUrl": "https://api.prometheus.dev"
}
```

## Commands

### `prometheus task <prompt>`

Submit a coding task to Prometheus.

```bash
prometheus task "Add user authentication with Clerk"
prometheus task "Fix the failing test in src/utils.test.ts"
prometheus task "Refactor the payment module to use Stripe"
```

**Options:**
- `--mode, -m` — Execution mode: `task`, `ask`, `plan`, `watch`, `fleet` (default: `task`)
- `--wait, -w` — Wait for the session to complete (default: false)
- `--stream, -s` — Stream session output to the terminal (default: true)

### `prometheus ask <question>`

Ask a question about your codebase.

```bash
prometheus ask "How does the auth middleware work?"
prometheus ask "What database tables are used by the billing module?"
```

### `prometheus plan <prompt>`

Generate an implementation plan without executing it.

```bash
prometheus plan "Add multi-language support to the frontend"
```

### `prometheus watch`

Monitor CI/CD and auto-fix failures.

```bash
prometheus watch
prometheus watch --branch main
```

**Options:**
- `--branch, -b` — Branch to watch (default: current branch)
- `--auto-fix` — Automatically create fix commits (default: false)

### `prometheus status`

Check the status of running sessions.

```bash
prometheus status
prometheus status <session-id>
```

### `prometheus history`

View session history for the current project.

```bash
prometheus history
prometheus history --limit 20
```

**Options:**
- `--limit, -l` — Number of sessions to show (default: 10)
- `--mode` — Filter by mode

### `prometheus config`

View or update CLI configuration.

```bash
prometheus config                    # Show current config
prometheus config set apiUrl https://api.custom.com
prometheus config get defaultMode
```

### `prometheus logout`

Remove stored authentication credentials.

```bash
prometheus logout
```

## Common Workflows

### Fix a bug and commit

```bash
prometheus task "Fix the null pointer exception in UserService.getProfile" --wait
git add -A && git commit -m "fix: resolve null pointer in UserService"
```

### Plan before implementing

```bash
prometheus plan "Add WebSocket support for real-time notifications"
# Review the plan, then execute
prometheus task "Add WebSocket support for real-time notifications"
```

### Investigate a codebase

```bash
prometheus ask "What is the request lifecycle from API to database?"
prometheus ask "Which services depend on the billing package?"
```

### Watch CI in a loop

```bash
prometheus watch --auto-fix
```

This monitors your CI pipeline and automatically creates fix commits when builds fail.
