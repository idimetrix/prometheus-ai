import type { SkillPack } from "./ecommerce";

/**
 * Real-time Skill Pack
 *
 * Patterns for WebSocket communication, event streaming, presence tracking,
 * live notifications, and collaborative editing.
 */

export const REAL_TIME_SKILL_PACK: SkillPack = {
  id: "skill-pack-real-time",
  name: "Real-time & Collaboration",
  description:
    "WebSocket patterns, event streaming, presence tracking, live notifications, and collaborative editing",
  category: "skill-pack",
  tags: [
    "websocket",
    "real-time",
    "streaming",
    "presence",
    "notifications",
    "collaboration",
  ],

  patterns: [
    {
      name: "WebSocket Gateway",
      description:
        "Scalable WebSocket server with namespaces, rooms, authentication, and heartbeat",
      context:
        "Clients need persistent bidirectional connections for real-time updates",
      implementation: `
- Use Socket.IO or ws library with namespace-based routing
- Namespaces: /sessions, /notifications, /presence, /collaboration
- Rooms: per-project, per-session, per-org for targeted broadcasts
- Auth: validate JWT on connection handshake, reject invalid tokens
- Heartbeat: ping/pong every 25s, disconnect after 3 missed pongs
- Reconnection: client auto-reconnects with exponential backoff (1s, 2s, 4s, max 30s)
- Message format: { event: string, data: unknown, timestamp: number, id: string }
- Scaling: Redis adapter for multi-instance pub/sub (sticky sessions or Redis Streams)
- Connection tracking: store active connections in Redis for presence and metrics
- Rate limiting: max 100 messages/sec per connection to prevent abuse
`,
    },
    {
      name: "Event Streaming",
      description:
        "Server-Sent Events (SSE) for unidirectional real-time data streaming",
      context:
        "Stream updates from server to client without requiring bidirectional communication",
      implementation: `
- SSE endpoint: GET /api/events/:channel with text/event-stream Content-Type
- Event format: id, event (type), data (JSON), retry (reconnect interval)
- Last-Event-ID header: client sends on reconnect to resume from last event
- EventLog table: id, channel, eventType, data, createdAt (for replay on reconnect)
- Channels: user-specific, org-wide, project-specific, global announcements
- Backend: Redis Pub/Sub or NATS for cross-instance event distribution
- Keep-alive: send comment lines (: keepalive) every 15s to prevent proxy timeouts
- Cleanup: remove old events from EventLog after 24h retention
- Fallback: poll /api/events/latest if SSE is not supported (long-polling)
`,
    },
    {
      name: "Presence System",
      description:
        "Track who is online, what they are viewing, and cursor/selection positions",
      context:
        "Users need to see who else is active and what they are working on",
      implementation: `
- Presence data: userId, status (online|away|busy|offline), currentPage, lastSeenAt
- Storage: Redis with TTL keys — presence:{userId} expires after 60s
- Heartbeat: client sends presence update every 30s, server extends TTL
- Offline detection: when TTL expires, broadcast offline event to relevant rooms
- Awareness: per-room presence — "3 people viewing this project"
- Cursor tracking: broadcast cursor position via WebSocket (throttle to 50ms)
- Selection tracking: share selected text/code ranges for pair programming
- Status inference: active (recent input), away (no input for 5 min), offline (disconnected)
- Privacy: respect user preference to appear offline
- Scalability: aggregate presence across instances via Redis
`,
    },
    {
      name: "Live Notifications",
      description:
        "Real-time notification delivery with persistence and read tracking",
      context: "Users need instant alerts about events relevant to them",
      implementation: `
- Notification table: id, userId, type, title, body, data (jsonb), readAt, createdAt
- Delivery: push via WebSocket immediately, persist to DB for history
- Types: mention, assignment, status_change, comment, deploy, error, system
- Preferences: NotificationPreference table — per-type opt-in/out for web, email, push
- Batching: group rapid-fire notifications (e.g., "5 new comments" instead of 5 separate)
- Badge count: maintain unread count in Redis, push updates on change
- Mark as read: individual or bulk (mark all as read)
- Notification center: paginated list sorted by createdAt desc
- Priority: urgent notifications bypass do-not-disturb settings
- Analytics: track notification open rates and engagement
`,
    },
    {
      name: "Collaborative Editing",
      description: "Conflict-free collaborative editing using CRDTs or OT",
      context: "Multiple users edit the same document or code simultaneously",
      implementation: `
- Use Yjs (CRDT-based) for conflict-free concurrent editing
- Document types: rich text, code, markdown, JSON
- Yjs provider: y-websocket for real-time sync, y-indexeddb for offline persistence
- Awareness protocol: show cursor positions, selections, and user labels
- Document table: id, projectId, type, yjsState (binary), version, updatedAt
- Snapshots: periodic snapshots of document state for undo/history
- Conflict resolution: CRDTs handle conflicts automatically — no manual merge needed
- Permissions: read-only viewers see changes in real-time but cannot edit
- Version history: store incremental updates, allow viewing/restoring past versions
- Performance: binary encoding (Yjs update format) for minimal network overhead
`,
    },
  ],

  agentHints: {
    architect:
      "Design with WebSocket gateway for bidirectional and SSE for unidirectional streaming. Redis pub/sub for multi-instance scaling. Yjs CRDTs for collaborative editing. Presence via Redis TTL keys.",
    frontend_coder:
      "Socket.IO client with auto-reconnect. Optimistic UI updates with server reconciliation. Yjs + y-websocket for collaborative editing. Presence indicators with avatar stacks.",
    backend_coder:
      "Socket.IO with Redis adapter for scaling. JWT auth on WebSocket handshake. Rate limit messages per connection. Event log for SSE replay. Presence TTL keys in Redis.",
    test_engineer:
      "Test reconnection behavior. Test presence detection accuracy. Test concurrent editing with multiple clients. Test notification delivery ordering. Test rate limiting.",
    security_auditor:
      "Verify WebSocket auth on every connection. Check rate limiting to prevent DoS. Validate room authorization (users can only join their own rooms). Audit message payload validation.",
  },
};
