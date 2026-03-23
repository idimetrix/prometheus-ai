---
title: API Reference
description: Prometheus API endpoints, authentication, and usage
order: 6
---

## Overview

The Prometheus API is built with **Hono** and **tRPC**. All endpoints use tRPC for type-safe communication between client and server.

**Base URL:** `http://localhost:4000` (development) or `https://api.your-domain.com` (production)

## Authentication

All API requests require authentication. Prometheus supports two methods:

### Clerk JWT (recommended for web clients)

Include the Clerk session token in the `Authorization` header:

```
Authorization: Bearer <clerk-session-token>
```

The web frontend handles this automatically via the Clerk provider.

### API Keys (for programmatic access)

Generate an API key from the dashboard under Settings > API Keys.

```
Authorization: Bearer pk_live_<your-api-key>
```

API keys are scoped to an organization and inherit the permissions of the user who created them.

## tRPC Endpoints

### Projects

#### `project.list`

List all projects for the current organization.

```typescript
// Input
{ limit?: number; cursor?: string }

// Output
{ projects: Project[]; nextCursor?: string }
```

#### `project.get`

Get a project by ID.

```typescript
// Input
{ projectId: string }

// Output
Project
```

#### `project.create`

Create a new project.

```typescript
// Input
{
  name: string;
  description?: string;
  repoUrl?: string;
  techStack?: string[];
}

// Output
Project
```

#### `project.delete`

Delete a project and all associated data.

```typescript
// Input
{ projectId: string }
```

### Sessions

#### `session.create`

Start a new agent session.

```typescript
// Input
{
  projectId: string;
  prompt: string;
  mode: "task" | "ask" | "plan" | "watch" | "fleet";
}

// Output
{ sessionId: string }
```

#### `session.get`

Get session details and status.

```typescript
// Input
{ sessionId: string }

// Output
Session
```

#### `session.list`

List sessions for a project.

```typescript
// Input
{ projectId: string; limit?: number; cursor?: string }

// Output
{ sessions: Session[]; nextCursor?: string }
```

#### `session.cancel`

Cancel a running session.

```typescript
// Input
{ sessionId: string }
```

### Brain (Project Knowledge)

#### `brain.search`

Search the project knowledge base.

```typescript
// Input
{
  projectId: string;
  query: string;
  limit?: number;
}

// Output
{ results: SearchResult[] }
```

#### `brain.index`

Trigger re-indexing of a project's codebase.

```typescript
// Input
{ projectId: string }
```

### Billing

#### `billing.usage`

Get current billing period usage.

```typescript
// Input (none — uses org from auth context)

// Output
{
  creditsUsed: number;
  creditsRemaining: number;
  periodStart: string;
  periodEnd: string;
}
```

#### `billing.plans`

List available subscription plans.

```typescript
// Output
Plan[]
```

## Rate Limits

| Tier | Requests/min | Sessions/hour |
|------|-------------|---------------|
| Free | 30 | 5 |
| Starter | 120 | 20 |
| Pro | 300 | 50 |
| Team | 600 | 100 |
| Enterprise | Custom | Custom |

Rate limit headers are included in every response:

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 298
X-RateLimit-Reset: 1711036800
```

## Error Codes

All errors follow the tRPC error format:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found"
  }
}
```

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `BAD_REQUEST` | 400 | Invalid input or parameters |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Resource already exists or state conflict |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |
| `INSUFFICIENT_CREDITS` | 402 | Not enough credits for the operation |

## Real-Time Events

The Socket Server provides real-time session updates via Server-Sent Events (SSE).

**Endpoint:** `GET /events?sessionId=<id>`

```typescript
const source = new EventSource(
  `http://localhost:4001/events?sessionId=${sessionId}`
);

source.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data.type: "agent_start" | "agent_end" | "tool_call" | "output" | "error" | "complete"
};
```
