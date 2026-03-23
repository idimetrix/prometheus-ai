import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockPublish = vi.fn();
const mockSubscribe = vi.fn();
const mockOn = vi.fn();

vi.mock("@prometheus/queue", () => ({
  createRedisConnection: () => ({
    publish: mockPublish,
    subscribe: mockSubscribe,
    on: mockOn,
    duplicate: () => ({
      publish: mockPublish,
      subscribe: mockSubscribe,
      on: mockOn,
    }),
    psubscribe: vi.fn(),
  }),
}));

vi.mock("@prometheus/auth", () => ({
  getAuthContext: vi.fn().mockResolvedValue({
    userId: "user-1",
    orgId: "org-1",
    orgRole: "admin",
  }),
}));

vi.mock("@prometheus/db", () => ({
  db: {
    query: { agents: { findMany: vi.fn() }, tasks: { findMany: vi.fn() } },
  },
  agents: {},
  tasks: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  inArray: vi.fn(),
}));

import { setupNotificationNamespace } from "../namespaces/notifications";
import { setupSessionNamespace } from "../namespaces/sessions";

// ---------- Helpers: mock Socket.io ----------

function createMockSocket(userId = "user-1", orgId: string | null = "org-1") {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    id: `socket-${Math.random().toString(36).slice(2)}`,
    data: { userId, orgId, orgRole: "admin" },
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    _handlers: handlers,
    _trigger(event: string, ...args: unknown[]) {
      const handler = handlers.get(event);
      if (handler) {
        handler(...args);
      }
    },
  };
}

function createMockNamespace() {
  const connectionHandlers: Array<
    (socket: ReturnType<typeof createMockSocket>) => void
  > = [];
  return {
    on: vi.fn(
      (
        event: string,
        handler: (socket: ReturnType<typeof createMockSocket>) => void
      ) => {
        if (event === "connection") {
          connectionHandlers.push(handler);
        }
      }
    ),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    _connectionHandlers: connectionHandlers,
    _connect(socket: ReturnType<typeof createMockSocket>) {
      for (const handler of connectionHandlers) {
        handler(socket);
      }
    },
  };
}

// ---------- Sessions Namespace ----------

describe("setupSessionNamespace", () => {
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(() => {
    vi.clearAllMocks();
    ns = createMockNamespace();
    setupSessionNamespace(ns as never);
  });

  it("registers a connection handler", () => {
    expect(ns.on).toHaveBeenCalledWith("connection", expect.any(Function));
  });

  it("registers event handlers on socket connection", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    const registeredEvents = [...socket._handlers.keys()];
    expect(registeredEvents).toContain("join_session");
    expect(registeredEvents).toContain("leave_session");
    expect(registeredEvents).toContain("send_message");
    expect(registeredEvents).toContain("disconnect");
  });

  it("join_session joins the socket to the correct room", async () => {
    const socket = createMockSocket();
    ns._connect(socket);
    await socket._trigger("join_session", { sessionId: "sess-1" });
    expect(socket.join).toHaveBeenCalledWith("session:sess-1");
  });

  it("join_session emits session_joined acknowledgment", async () => {
    const socket = createMockSocket();
    ns._connect(socket);
    await socket._trigger("join_session", { sessionId: "sess-1" });
    expect(socket.emit).toHaveBeenCalledWith(
      "session_joined",
      expect.objectContaining({ sessionId: "sess-1" })
    );
  });

  it("join_session notifies others in the session", async () => {
    const socket = createMockSocket();
    ns._connect(socket);
    await socket._trigger("join_session", { sessionId: "sess-1" });
    expect(socket.to).toHaveBeenCalledWith("session:sess-1");
  });

  it("leave_session leaves the room", async () => {
    const socket = createMockSocket();
    ns._connect(socket);
    await socket._trigger("leave_session", { sessionId: "sess-1" });
    expect(socket.leave).toHaveBeenCalledWith("session:sess-1");
  });

  it("send_message publishes to Redis commands channel", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("send_message", {
      sessionId: "sess-1",
      content: "Hello agent",
    });
    expect(mockPublish).toHaveBeenCalledWith(
      "session:sess-1:commands",
      expect.any(String)
    );
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("user_message");
    expect(payload.content).toBe("Hello agent");
    expect(payload.userId).toBe("user-1");
  });

  it("send_message broadcasts to session room", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("send_message", {
      sessionId: "sess-1",
      content: "Hi",
    });
    expect(socket.to).toHaveBeenCalledWith("session:sess-1");
  });

  it("terminal_command publishes command to Redis", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("terminal_command", {
      sessionId: "sess-1",
      command: "npm test",
    });
    expect(mockPublish).toHaveBeenCalledWith(
      "session:sess-1:commands",
      expect.any(String)
    );
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("terminal_command");
    expect(payload.command).toBe("npm test");
  });

  it("takeover publishes takeover command and emits to room", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("takeover", { sessionId: "sess-1" });
    expect(mockPublish).toHaveBeenCalled();
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("takeover");
  });

  it("release publishes release command", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("release", { sessionId: "sess-1" });
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("release");
  });

  it("approve_plan publishes approval to Redis", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("approve_plan", {
      sessionId: "sess-1",
      stepId: "step-1",
      approved: true,
    });
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("approve_plan");
    expect(payload.approved).toBe(true);
    expect(payload.stepId).toBe("step-1");
  });

  it("checkpoint_response publishes to Redis", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("checkpoint_response", {
      sessionId: "sess-1",
      checkpointId: "cp-1",
      action: "approve",
    });
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("checkpoint_response");
    expect(payload.action).toBe("approve");
    expect(payload.checkpointId).toBe("cp-1");
  });

  it("agent:human-input-response publishes to Redis", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("agent:human-input-response", {
      sessionId: "sess-1",
      requestId: "req-1",
      action: "respond",
      message: "Yes, proceed",
    });
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("human_input_response");
    expect(payload.requestId).toBe("req-1");
    expect(payload.action).toBe("respond");
    expect(payload.message).toBe("Yes, proceed");
  });

  it("pause_session publishes pause command", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("pause_session", { sessionId: "sess-1" });
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("pause");
  });

  it("resume_session publishes resume command", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("resume_session", { sessionId: "sess-1" });
    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] ?? "{}");
    expect(payload.type).toBe("resume");
  });

  it("typing emits to session room", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    socket._trigger("typing", { sessionId: "sess-1", isTyping: true });
    expect(socket.to).toHaveBeenCalledWith("session:sess-1");
  });

  it("disconnect handler is registered", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    expect(socket._handlers.has("disconnect")).toBe(true);
  });
});

// ---------- Notifications Namespace ----------

describe("setupNotificationNamespace", () => {
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(() => {
    vi.clearAllMocks();
    ns = createMockNamespace();
    setupNotificationNamespace(ns as never);
  });

  it("registers a connection handler", () => {
    expect(ns.on).toHaveBeenCalledWith("connection", expect.any(Function));
  });

  it("joins user notification room on connection", () => {
    const socket = createMockSocket("user-42", "org-7");
    ns._connect(socket);
    expect(socket.join).toHaveBeenCalledWith("user:user-42:notifications");
  });

  it("joins org notification room when orgId is present", () => {
    const socket = createMockSocket("user-42", "org-7");
    ns._connect(socket);
    expect(socket.join).toHaveBeenCalledWith("org:org-7:notifications");
  });

  it("does not join org room when orgId is null", () => {
    const socket = createMockSocket("user-42", null);
    ns._connect(socket);
    expect(socket.join).toHaveBeenCalledTimes(1);
    expect(socket.join).toHaveBeenCalledWith("user:user-42:notifications");
  });

  it("mark_read broadcasts to user room", () => {
    const socket = createMockSocket("user-1");
    ns._connect(socket);
    socket._trigger("mark_read", { notificationId: "notif-1" });
    expect(socket.to).toHaveBeenCalledWith("user:user-1:notifications");
  });

  it("mark_all_read broadcasts to user room", () => {
    const socket = createMockSocket("user-1");
    ns._connect(socket);
    socket._trigger("mark_all_read");
    expect(socket.to).toHaveBeenCalledWith("user:user-1:notifications");
  });

  it("dismiss broadcasts to user room", () => {
    const socket = createMockSocket("user-1");
    ns._connect(socket);
    socket._trigger("dismiss", { notificationId: "notif-2" });
    expect(socket.to).toHaveBeenCalledWith("user:user-1:notifications");
  });

  it("registers disconnect handler", () => {
    const socket = createMockSocket();
    ns._connect(socket);
    expect(socket._handlers.has("disconnect")).toBe(true);
  });
});
