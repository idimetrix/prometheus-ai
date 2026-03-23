# @prometheus/cli

Command-line interface for the Prometheus AI Engineering Platform.

## Installation

```bash
npm install -g @prometheus/cli
```

Or use without installing:

```bash
npx @prometheus/cli <command>
```

## Authentication

Log in with your API token:

```bash
prometheus init
```

This will prompt for your API URL and token, storing them in `~/.prometheus/config.json`.

You can also set configuration via environment variables:

```bash
export PROMETHEUS_API_URL=http://localhost:4000
export PROMETHEUS_API_TOKEN=pk_live_...
export PROMETHEUS_PROJECT_ID=proj_...
```

## Commands

### `prometheus task <description>`

Submit a task to Prometheus AI agents.

```bash
prometheus task "Add user avatar upload to the settings page"
prometheus task "Fix the failing login test" --project proj_abc123
prometheus task "Refactor the auth module" --mode plan
```

**Options:**
- `-p, --project <id>` — Target project ID (or set `PROMETHEUS_PROJECT_ID`)
- `-m, --mode <mode>` — Execution mode: `task` (default), `plan`, `ask`, or `fleet`

### `prometheus chat`

Start an interactive chat session with Prometheus agents.

```bash
prometheus chat
prometheus chat --project proj_abc123
```

### `prometheus status`

View current session and task status.

```bash
prometheus status
```

### `prometheus plan`

Generate an implementation plan without executing it.

```bash
prometheus plan "Migrate the database to use connection pooling"
```

### `prometheus fleet`

Manage and monitor the AI agent fleet.

```bash
prometheus fleet           # List active agents
prometheus fleet status    # Detailed fleet status
```

### `prometheus review`

Request an AI code review.

```bash
prometheus review          # Review staged changes
prometheus review --diff   # Review current diff
```

### `prometheus search`

Search across your codebase with AI-powered semantic search.

```bash
prometheus search "authentication middleware"
```

### `prometheus init`

Initialize Prometheus in the current project.

```bash
prometheus init
```

This creates a `.prometheus.json` config file and links the project to the platform.

## Configuration

Configuration is read from (in order of precedence):

1. Environment variables (`PROMETHEUS_API_URL`, `PROMETHEUS_API_TOKEN`, `PROMETHEUS_PROJECT_ID`)
2. Project config (`.prometheus.json` in the current directory)
3. Global config (`~/.prometheus/config.json`)

### Manual configuration

```bash
# Set API URL
export PROMETHEUS_API_URL=https://api.prometheus.example.com

# Set API token
export PROMETHEUS_API_TOKEN=pk_live_abc123...
```

## Common Workflows

### Submit a task and watch progress

```bash
prometheus task "Implement the user profile page" --project proj_abc
prometheus status
```

### Plan before executing

```bash
prometheus plan "Add rate limiting to the API"
# Review the plan, then execute
prometheus task "Add rate limiting to the API" --mode task
```

### Fleet mode for large tasks

```bash
prometheus task "Migrate all API endpoints to v2 schema" --mode fleet
prometheus fleet status
```
