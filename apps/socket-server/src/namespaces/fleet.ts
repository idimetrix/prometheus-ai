import type { Namespace } from "socket.io";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { db } from "@prometheus/db";
import { agents, tasks, sessions } from "@prometheus/db";
import { eq, and, inArray } from "drizzle-orm";

const logger = createLogger("socket-server:fleet");

export function setupFleetNamespace(namespace: Namespace) {
  const subscriber = createRedisConnection();
  const publisher = createRedisConnection();

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const orgId = socket.data.orgId as string | null;
    logger.info({ userId, socketId: socket.id }, "Client connected to fleet namespace");

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
          queuedTasks: activeTasks.filter((t: any) => t.status === "queued").length,
          runningTasks: activeTasks.filter((t: any) => t.status === "running").length,
          agents: activeAgents.map((a: any) => ({
            id: a.id,
            role: a.role,
            status: a.status,
            sessionId: a.sessionId,
            tokensIn: a.tokensIn,
            tokensOut: a.tokensOut,
            stepsCompleted: a.stepsCompleted,
            startedAt: a.startedAt.toISOString(),
          })),
          tasks: activeTasks.map((t: any) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            agentRole: t.agentRole,
            priority: t.priority,
          })),
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
        await db.update(agents)
          .set({ status: "terminated", terminatedAt: new Date() })
          .where(eq(agents.id, data.agentId));

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
      logger.info({ userId, agentId: data.agentId, taskId: data.taskId }, "Agent reassignment requested");
      // Publish command to orchestrator
      publisher.publish("fleet:commands", JSON.stringify({
        type: "reassign",
        agentId: data.agentId,
        taskId: data.taskId,
        userId,
        timestamp: new Date().toISOString(),
      }));
    });

    socket.on("disconnect", () => {
      logger.debug({ userId, socketId: socket.id }, "Client disconnected from fleet");
    });
  });

  // Subscribe to fleet events channel
  subscriber.subscribe("fleet:events", (err) => {
    if (err) logger.error({ error: err.message }, "Failed to subscribe to fleet channel");
  });

  subscriber.on("message", (channel: string, message: string) => {
    if (channel === "fleet:events") {
      try {
        const event = JSON.parse(message);
        if (event.orgId) {
          namespace.to(`org:${event.orgId}:fleet`).emit(event.type, event.data ?? event);
        }
      } catch (error) {
        logger.error({ channel, error }, "Failed to parse fleet event");
      }
    }
  });
}
