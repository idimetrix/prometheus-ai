/**
 * Integration test setup — shared utilities for tests that verify
 * cross-service communication patterns without requiring live services.
 *
 * Uses mock infrastructure (in-memory queues, mock Redis, mock DB)
 * to test service integration contracts.
 */

import {
  createMockContext as _createMockContext,
  createMockEventPublisher as _createMockEventPublisher,
  createMockRedis as _createMockRedis,
  createTestOrg,
  createTestProject,
  createTestSession,
  createTestTask,
  createTestUser,
} from "@prometheus/test-utils";
import { vi } from "vitest";

export const createMockContext = _createMockContext;
export const createMockEventPublisher = _createMockEventPublisher;
export const createMockRedis = _createMockRedis;
export {
  createTestOrg,
  createTestProject,
  createTestSession,
  createTestTask,
  createTestUser,
};

// ---------------------------------------------------------------------------
// Shared mock logger used across all integration tests
// ---------------------------------------------------------------------------
function createMockLogger(): Record<string, unknown> {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op mock
  const noop = () => {};
  const logger: Record<string, unknown> = {
    info: noop,
    error: noop,
    warn: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  };
  logger.child = () => logger;
  return logger;
}

export const mockLogger = createMockLogger();

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/**
 * Creates a complete test context with org, user, project, session, and task.
 * All IDs are consistent so tests can reference across boundaries.
 */
export function createIntegrationFixtures(overrides?: {
  orgPlan?: string;
  agentRole?: string;
  taskMode?: string;
}) {
  const org = createTestOrg({ plan: overrides?.orgPlan ?? "pro" });
  const user = createTestUser({ orgId: org.id });
  const project = createTestProject({ orgId: org.id });
  const session = createTestSession({
    projectId: project.id,
    userId: user.id,
    mode: overrides?.taskMode ?? "task",
  });
  const task = createTestTask({
    sessionId: session.id,
    projectId: project.id,
    agentRole: overrides?.agentRole ?? "backend_coder",
  });

  return { org, user, project, session, task };
}

/**
 * Creates an in-memory BullMQ-like job queue for testing producer/consumer patterns.
 */
export function createMockJobQueue() {
  const jobs = new Map<
    string,
    {
      id: string;
      name: string;
      data: Record<string, unknown>;
      opts: Record<string, unknown>;
      state: "waiting" | "active" | "completed" | "failed";
      result?: unknown;
      failReason?: string;
      attempts: number;
    }
  >();

  const processHandlers: Array<
    (job: { id: string; data: Record<string, unknown> }) => Promise<unknown>
  > = [];

  return {
    add: vi.fn(
      (
        name: string,
        data: Record<string, unknown>,
        opts: Record<string, unknown> = {}
      ) => {
        const id = (opts.jobId as string) ?? `job_${Date.now()}_${jobs.size}`;
        const job = {
          id,
          name,
          data,
          opts,
          state: "waiting" as const,
          attempts: 0,
        };
        jobs.set(id, job);
        return Promise.resolve({ id, name, data });
      }
    ),

    getJob: vi.fn((id: string) => {
      const job = jobs.get(id);
      if (!job) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        ...job,
        getState: vi.fn(() => Promise.resolve(job.state)),
        remove: vi.fn(() => {
          jobs.delete(id);
          return Promise.resolve();
        }),
        moveToCompleted: vi.fn((result: unknown) => {
          job.state = "completed";
          job.result = result;
          return Promise.resolve();
        }),
        moveToFailed: vi.fn((err: Error) => {
          job.state = "failed";
          job.failReason = err.message;
          job.attempts++;
          return Promise.resolve();
        }),
        retry: vi.fn(() => {
          job.state = "waiting";
          return Promise.resolve();
        }),
      });
    }),

    getWaitingCount: vi.fn(() =>
      Promise.resolve(
        [...jobs.values()].filter((j) => j.state === "waiting").length
      )
    ),

    getActiveCount: vi.fn(() =>
      Promise.resolve(
        [...jobs.values()].filter((j) => j.state === "active").length
      )
    ),

    getCompletedCount: vi.fn(() =>
      Promise.resolve(
        [...jobs.values()].filter((j) => j.state === "completed").length
      )
    ),

    getFailedCount: vi.fn(() =>
      Promise.resolve(
        [...jobs.values()].filter((j) => j.state === "failed").length
      )
    ),

    /**
     * Simulate a worker picking up and processing the next waiting job.
     */
    async processNext() {
      const waiting = [...jobs.values()].find((j) => j.state === "waiting");
      if (!waiting) {
        return null;
      }

      waiting.state = "active";
      waiting.attempts++;

      for (const handler of processHandlers) {
        try {
          const result = await handler({
            id: waiting.id,
            data: waiting.data,
          });
          waiting.state = "completed";
          waiting.result = result;
        } catch (error) {
          waiting.state = "failed";
          waiting.failReason =
            error instanceof Error ? error.message : String(error);
        }
      }

      return waiting;
    },

    /**
     * Register a processor function (like BullMQ worker.process).
     */
    onProcess(
      handler: (job: {
        id: string;
        data: Record<string, unknown>;
      }) => Promise<unknown>
    ) {
      processHandlers.push(handler);
    },

    /** Direct access to jobs for assertions */
    get _jobs() {
      return jobs;
    },

    /** Reset all jobs */
    _reset() {
      jobs.clear();
      processHandlers.length = 0;
    },
  };
}

export type MockJobQueue = ReturnType<typeof createMockJobQueue>;

/**
 * Creates a mock HTTP service client for testing inter-service HTTP calls.
 */
export function createMockServiceClient(serviceName: string) {
  const responses = new Map<string, { status: number; body: unknown }>();

  return {
    /**
     * Register a mock response for a specific path.
     */
    onRequest(
      method: string,
      path: string,
      response: { status: number; body: unknown }
    ) {
      responses.set(`${method}:${path}`, response);
    },

    /**
     * Simulate an HTTP request to the service.
     */
    request(
      method: string,
      path: string,
      _body?: unknown
    ): Promise<{ status: number; body: unknown }> {
      const key = `${method}:${path}`;
      const mockResponse = responses.get(key);

      if (!mockResponse) {
        return Promise.resolve({
          status: 404,
          body: {
            error: `No mock response for ${method} ${path} on ${serviceName}`,
          },
        });
      }

      return Promise.resolve(mockResponse);
    },

    /** Reset all mock responses */
    _reset() {
      responses.clear();
    },
  };
}
