import { generateId } from "@prometheus/utils";

/**
 * In-memory store used by the mock Redis to simulate basic key/value and hash operations.
 */
interface MockRedisStore {
  hashes: Map<string, Map<string, string>>;
  kv: Map<string, string>;
  subscribers: Map<string, Array<(channel: string, message: string) => void>>;
}

/**
 * Creates a mock Redis client that mirrors the subset of ioredis commands
 * used throughout the Prometheus codebase. All data is held in memory
 * and discarded when the mock is garbage-collected.
 */
export function createMockRedis() {
  const store: MockRedisStore = {
    kv: new Map(),
    hashes: new Map(),
    subscribers: new Map(),
  };

  const mock = {
    // ---------- Key/Value ----------
    get(key: string): Promise<string | null> {
      return Promise.resolve(store.kv.get(key) ?? null);
    },

    set(key: string, value: string, ..._args: unknown[]): Promise<"OK"> {
      store.kv.set(key, value);
      return Promise.resolve("OK" as const);
    },

    del(...keys: string[]): Promise<number> {
      let removed = 0;
      for (const key of keys) {
        if (store.kv.delete(key)) {
          removed++;
        }
        if (store.hashes.delete(key)) {
          removed++;
        }
      }
      return Promise.resolve(removed);
    },

    keys(pattern: string): Promise<string[]> {
      const regex = new RegExp(
        `^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`
      );
      return Promise.resolve([...store.kv.keys()].filter((k) => regex.test(k)));
    },

    mget(...keys: string[]): Promise<(string | null)[]> {
      const flatKeys = keys.flat() as string[];
      return Promise.resolve(flatKeys.map((k) => store.kv.get(k) ?? null));
    },

    incr(key: string): Promise<number> {
      const current = Number.parseInt(store.kv.get(key) ?? "0", 10);
      const next = current + 1;
      store.kv.set(key, String(next));
      return Promise.resolve(next);
    },

    expire(_key: string, _seconds: number): Promise<number> {
      return Promise.resolve(1);
    },

    ttl(_key: string): Promise<number> {
      return Promise.resolve(-1);
    },

    // ---------- Hashes ----------
    hset(key: string, field: string, value: string): Promise<number> {
      if (!store.hashes.has(key)) {
        store.hashes.set(key, new Map());
      }
      const hash = store.hashes.get(key) as Map<string, string>;
      const isNew = !hash.has(field);
      hash.set(field, value);
      return Promise.resolve(isNew ? 1 : 0);
    },

    hget(key: string, field: string): Promise<string | null> {
      return Promise.resolve(store.hashes.get(key)?.get(field) ?? null);
    },

    hgetall(key: string): Promise<Record<string, string>> {
      const hash = store.hashes.get(key);
      if (!hash) {
        return Promise.resolve({});
      }
      return Promise.resolve(Object.fromEntries(hash.entries()));
    },

    hsetnx(key: string, field: string, value: string): Promise<number> {
      if (!store.hashes.has(key)) {
        store.hashes.set(key, new Map());
      }
      const hash = store.hashes.get(key) as Map<string, string>;
      if (hash.has(field)) {
        return Promise.resolve(0);
      }
      hash.set(field, value);
      return Promise.resolve(1);
    },

    hdel(key: string, ...fields: string[]): Promise<number> {
      const hash = store.hashes.get(key);
      if (!hash) {
        return Promise.resolve(0);
      }
      let removed = 0;
      for (const f of fields) {
        if (hash.delete(f)) {
          removed++;
        }
      }
      return Promise.resolve(removed);
    },

    // ---------- Pub/Sub ----------
    publish(channel: string, message: string): Promise<number> {
      const handlers = store.subscribers.get(channel) ?? [];
      for (const handler of handlers) {
        handler(channel, message);
      }
      return Promise.resolve(handlers.length);
    },

    subscribe(
      channel: string,
      handler?: (channel: string, message: string) => void
    ): Promise<void> {
      if (!store.subscribers.has(channel)) {
        store.subscribers.set(channel, []);
      }
      if (handler) {
        store.subscribers.get(channel)?.push(handler);
      }
      return Promise.resolve();
    },

    unsubscribe(channel: string): Promise<void> {
      store.subscribers.delete(channel);
      return Promise.resolve();
    },

    // ---------- Streams (minimal) ----------
    xadd(_stream: string, ..._args: unknown[]): Promise<string> {
      return Promise.resolve(`${Date.now()}-0`);
    },

    xread(..._args: unknown[]): Promise<unknown[] | null> {
      return Promise.resolve(null);
    },

    // ---------- Pipeline ----------
    pipeline() {
      const commands: Array<{
        method: string;
        args: unknown[];
      }> = [];

      const pipe = {
        get(key: string) {
          commands.push({ method: "get", args: [key] });
          return pipe;
        },
        set(key: string, value: string, ...rest: unknown[]) {
          commands.push({ method: "set", args: [key, value, ...rest] });
          return pipe;
        },
        del(...keys: string[]) {
          commands.push({ method: "del", args: keys });
          return pipe;
        },
        hset(key: string, field: string, value: string) {
          commands.push({ method: "hset", args: [key, field, value] });
          return pipe;
        },
        hget(key: string, field: string) {
          commands.push({ method: "hget", args: [key, field] });
          return pipe;
        },
        incr(key: string) {
          commands.push({ method: "incr", args: [key] });
          return pipe;
        },
        expire(key: string, seconds: number) {
          commands.push({ method: "expire", args: [key, seconds] });
          return pipe;
        },
        async exec(): Promise<[Error | null, unknown][]> {
          const results: [Error | null, unknown][] = [];
          for (const cmd of commands) {
            try {
              const fn = mock[cmd.method as keyof typeof mock] as (
                ...a: unknown[]
              ) => Promise<unknown>;
              const result = await fn(...cmd.args);
              results.push([null, result]);
            } catch (error) {
              results.push([error as Error, null]);
            }
          }
          return results;
        },
      };
      return pipe;
    },

    // ---------- Connection lifecycle ----------
    disconnect(): Promise<void> {
      store.kv.clear();
      store.hashes.clear();
      store.subscribers.clear();
      return Promise.resolve();
    },

    quit(): Promise<void> {
      store.kv.clear();
      store.hashes.clear();
      store.subscribers.clear();
      return Promise.resolve();
    },

    // ---------- Testing helpers ----------
    /** Direct access to the in-memory store for assertions */
    _store: store,

    /** Reset all data without destroying the mock */
    _reset() {
      store.kv.clear();
      store.hashes.clear();
      store.subscribers.clear();
    },
  };

  return mock;
}

export type MockRedis = ReturnType<typeof createMockRedis>;

/**
 * Creates a minimal mock database object. Individual tests should override
 * specific query/insert/update/delete methods as needed.
 */
function createNoopFn(returnValue: unknown = undefined) {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]) => {
    calls.push(args);
    return typeof returnValue === "function"
      ? (returnValue as (...a: unknown[]) => unknown)(...args)
      : returnValue;
  };
  fn.calls = calls;
  return fn;
}

function createMockDb() {
  return {
    select: createNoopFn(Promise.resolve([])),
    insert: createNoopFn({
      values: createNoopFn({
        returning: createNoopFn(Promise.resolve([])),
        onConflictDoNothing: createNoopFn({
          returning: createNoopFn(Promise.resolve([])),
        }),
        onConflictDoUpdate: createNoopFn({
          returning: createNoopFn(Promise.resolve([])),
        }),
      }),
    }),
    update: createNoopFn({
      set: createNoopFn({
        where: createNoopFn({
          returning: createNoopFn(Promise.resolve([])),
        }),
      }),
    }),
    delete: createNoopFn({
      where: createNoopFn({
        returning: createNoopFn(Promise.resolve([])),
      }),
    }),
    query: new Proxy(
      {},
      {
        get: () =>
          new Proxy(
            {},
            {
              get: () => createNoopFn(Promise.resolve([])),
            }
          ),
      }
    ),
    transaction: createNoopFn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(createMockDb())
    ),
  };
}

/**
 * Creates a mock tRPC context for testing procedures without a real database or Redis.
 */
export function createMockContext(
  overrides?: Partial<{
    db: unknown;
    redis: unknown;
    userId: string;
    orgId: string;
    sessionId: string;
    requestId: string;
  }>
) {
  const defaults = {
    db: createMockDb(),
    redis: createMockRedis(),
    userId: generateId("usr"),
    orgId: generateId("org"),
    sessionId: undefined as string | undefined,
    requestId: generateId("req"),
  };

  return { ...defaults, ...overrides };
}

/**
 * Creates a mock EventPublisher that records all published events
 * for assertion without connecting to Redis.
 */
export function createMockEventPublisher() {
  const publishedEvents: Array<{
    type: string;
    channel: string;
    data: unknown;
  }> = [];

  return {
    publishSessionEvent(
      sessionId: string,
      event: { type: string; data: Record<string, unknown>; timestamp: string }
    ): Promise<void> {
      publishedEvents.push({
        type: "session",
        channel: `session:${sessionId}:events`,
        data: event,
      });
      return Promise.resolve();
    },

    publishFleetEvent(
      orgId: string,
      event: { type: string; data: Record<string, unknown>; timestamp: string }
    ): Promise<void> {
      publishedEvents.push({
        type: "fleet",
        channel: "fleet:events",
        data: { ...event, orgId },
      });
      return Promise.resolve();
    },

    publishNotification(
      userId: string,
      notification: {
        type: string;
        title: string;
        message: string;
        data?: Record<string, unknown>;
      }
    ): Promise<void> {
      publishedEvents.push({
        type: "notification",
        channel: `user:${userId}:notifications`,
        data: notification,
      });
      return Promise.resolve();
    },

    publishQueuePosition(
      sessionId: string,
      position: {
        taskId: string;
        position: number;
        estimatedWaitSeconds: number;
        totalInQueue: number;
      }
    ): Promise<void> {
      publishedEvents.push({
        type: "queue_position",
        channel: `session:${sessionId}:events`,
        data: position,
      });
      return Promise.resolve();
    },

    /** All events published during the test, in order */
    get events() {
      return publishedEvents;
    },

    /** Filter published events by type */
    getEventsByType(type: string) {
      return publishedEvents.filter((e) => e.type === type);
    },

    /** Reset recorded events */
    reset() {
      publishedEvents.length = 0;
    },
  };
}

export type MockEventPublisher = ReturnType<typeof createMockEventPublisher>;
export type MockContext = ReturnType<typeof createMockContext>;
