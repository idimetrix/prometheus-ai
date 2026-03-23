import { agents, db, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { eq, inArray } from "drizzle-orm";
import type { Namespace } from "socket.io";

const logger = createLogger("socket-server:fleet");

export function setupFleetNamespace(namespace: Namespace) {
  const subscriber = createRedisConnection();
  const publisher = createRedisConnection();

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const orgId = socket.data.orgId as string | null;
    logger.info(
      { userId, socketId: socket.id },
      "Client connected to fleet namespace"
    );

    // Join org room for fleet-wide updates
    if (orgId) {
      socket.join(`org:${orgId}:fleet`);
    }

    // Request fleet status
    socket.on("get_status", async () => {
      try {
        const activeAgents = await db.query.agents.findMany({
          where: inArray(agents.status, ["idle", "working"]),
        });

        const activeTasks = await db.query.tasks.findMany({
          where: inArray(tasks.status, ["queued", "running"]),
        });

        socket.emit("fleet_status", {
          activeAgents: activeAgents.length,
          queuedTasks: activeTasks.filter(
            (t: (typeof activeTasks)[number]) => t.status === "queued"
          ).length,
          runningTasks: activeTasks.filter(
            (t: (typeof activeTasks)[number]) => t.status === "running"
          ).length,
          agents: activeAgents.map((a: (typeof activeAgents)[number]) => ({
            id: a.id,
            role: a.role,
            status: a.status,
            sessionId: a.sessionId,
            tokensIn: a.tokensIn,
            tokensOut: a.tokensOut,
            stepsCompleted: a.stepsCompleted,
            startedAt: a.startedAt.toISOString(),
          })),
          tasks: activeTasks.map((t: (typeof activeTasks)[number]) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            agentRole: t.agentRole,
            priority: t.priority,
          })),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, "Failed to get fleet status");
        socket.emit("fleet_status", {
          activeAgents: 0,
          queuedTasks: 0,
          runningTasks: 0,
          agents: [],
          tasks: [],
        });
      }
    });

    // Stop a specific agent
    socket.on("stop_agent", async (data: { agentId: string }) => {
      try {
        await db
          .update(agents)
          .set({ status: "terminated", terminatedAt: new Date() })
          .where(eq(agents.id, data.agentId));

        // Publish command to orchestrator
        publisher.publish(
          "fleet:commands",
          JSON.stringify({
            type: "stop_agent",
            agentId: data.agentId,
            stoppedBy: userId,
            timestamp: new Date().toISOString(),
          })
        );

        // Notify fleet
        if (orgId) {
          namespace.to(`org:${orgId}:fleet`).emit("agent_stopped", {
            agentId: data.agentId,
            stoppedBy: userId,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        logger.error({ agentId: data.agentId, error }, "Failed to stop agent");
      }
    });

    // Reassign agent to different task
    socket.on("reassign_agent", (data: { agentId: string; taskId: string }) => {
      logger.info(
        { userId, agentId: data.agentId, taskId: data.taskId },
        "Agent reassignment requested"
      );
      publisher.publish(
        "fleet:commands",
        JSON.stringify({
          type: "reassign",
          agentId: data.agentId,
          taskId: data.taskId,
          userId,
          timestamp: new Date().toISOString(),
        })
      );

      if (orgId) {
        namespace.to(`org:${orgId}:fleet`).emit("agent_reassigned", {
          agentId: data.agentId,
          taskId: data.taskId,
          userId,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Scale fleet up/down
    socket.on("scale_fleet", (data: { targetCount: number }) => {
      logger.info(
        { userId, targetCount: data.targetCount },
        "Fleet scale requested"
      );
      publisher.publish(
        "fleet:commands",
        JSON.stringify({
          type: "scale",
          targetCount: data.targetCount,
          userId,
          timestamp: new Date().toISOString(),
        })
      );
    });

    // Subscribe to worker events for a specific session (parallel execution)
    socket.on("subscribe_session", (data: { sessionId: string }) => {
      const room = `session:${data.sessionId}:workers`;
      socket.join(room);
      logger.debug(
        { userId, sessionId: data.sessionId },
        "Subscribed to session worker events"
      );
    });

    // Unsubscribe from session worker events
    socket.on("unsubscribe_session", (data: { sessionId: string }) => {
      const room = `session:${data.sessionId}:workers`;
      socket.leave(room);
    });

    socket.on("disconnect", () => {
      logger.debug(
        { userId, socketId: socket.id },
        "Client disconnected from fleet"
      );
    });
  });

  // Subscribe to fleet events channel
  subscriber.subscribe("fleet:events", (err) => {
    if (err) {
      logger.error(
        { error: err.message },
        "Failed to subscribe to fleet channel"
      );
    }
  });

  // Also subscribe to indexing progress events
  subscriber.subscribe("indexing:progress", (err) => {
    if (err) {
      logger.error(
        { error: err.message },
        "Failed to subscribe to indexing progress channel"
      );
    }
  });

  // Subscribe to worker events channel for parallel execution tracking
  subscriber.subscribe("fleet:worker_events", (err) => {
    if (err) {
      logger.error(
        { error: err.message },
        "Failed to subscribe to worker events channel"
      );
    }
  });

  subscriber.on("message", (channel: string, message: string) => {
    const handler = channelHandlers[channel];
    if (handler) {
      handler(namespace, message, channel);
    }
  });
}

function handleFleetEvents(
  namespace: Namespace,
  message: string,
  channel: string
): void {
  try {
    const event = JSON.parse(message);
    if (event.orgId) {
      namespace
        .to(`org:${event.orgId}:fleet`)
        .emit(event.type ?? "fleet_event", event.data ?? event);
    }
  } catch (error) {
    logger.error({ channel, error }, "Failed to parse fleet event");
  }
}

function handleIndexingProgress(
  namespace: Namespace,
  message: string,
  channel: string
): void {
  try {
    const event = JSON.parse(message);
    if (event.orgId) {
      namespace.to(`org:${event.orgId}:fleet`).emit("indexing_progress", event);
    }
  } catch (error) {
    logger.error({ channel, error }, "Failed to parse indexing progress event");
  }
}

function handleWorkerEvents(
  namespace: Namespace,
  message: string,
  channel: string
): void {
  try {
    const event = JSON.parse(message) as {
      sessionId?: string;
      orgId?: string;
      agentId?: string;
      type?: string;
      data?: Record<string, unknown>;
    };

    if (event.sessionId) {
      const room = `session:${event.sessionId}:workers`;
      namespace.to(room).emit(event.type ?? "worker_event", {
        agentId: event.agentId,
        sessionId: event.sessionId,
        ...(event.data ?? event),
        timestamp: new Date().toISOString(),
      });
    }

    if (event.orgId) {
      namespace
        .to(`org:${event.orgId}:fleet`)
        .emit(event.type ?? "worker_event", {
          agentId: event.agentId,
          ...(event.data ?? event),
        });
    }
  } catch (error) {
    logger.error({ channel, error }, "Failed to parse worker event");
  }
}

const channelHandlers: Record<
  string,
  (ns: Namespace, msg: string, ch: string) => void
> = {
  "fleet:events": handleFleetEvents,
  "indexing:progress": handleIndexingProgress,
  "fleet:worker_events": handleWorkerEvents,
};
