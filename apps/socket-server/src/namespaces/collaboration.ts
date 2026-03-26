/**
 * Collaboration namespace — Yjs CRDT document synchronization.
 *
 * Handles Y.js WebSocket provider connections for collaborative editing
 * between human users and AI agents. Each document room maps to a
 * unique file being edited.
 *
 * Features:
 * - Y.js document awareness (cursor positions, user presence)
 * - Room-based document isolation
 * - AI agent cursor tracking (distinct from human cursors)
 * - Document edit history broadcasting
 */
import { createLogger } from "@prometheus/logger";
import type { Namespace } from "socket.io";

const logger = createLogger("socket-server:collaboration");

/** Maximum number of concurrent document rooms per session */
const MAX_ROOMS_PER_SESSION = 20;

/** Track open document rooms per session */
const sessionRoomCounts = new Map<string, number>();

export interface CollaborationUser {
  color: string;
  isAgent: boolean;
  name: string;
  userId: string;
}

export interface CursorUpdate {
  /** Column position (1-based) */
  column: number;
  /** Absolute file path */
  filePath: string;
  /** Line position (1-based) */
  line: number;
  /** Selection anchor, if any */
  selectionAnchor?: { line: number; column: number };
}

export function setupCollaborationNamespace(namespace: Namespace): void {
  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const joinedRooms = new Set<string>();

    logger.info(
      { userId, socketId: socket.id },
      "Client connected to collaboration namespace"
    );

    // ---- Join a collaborative document room ----
    socket.on(
      "collab:join",
      async (data: {
        sessionId: string;
        filePath: string;
        user: CollaborationUser;
      }) => {
        const roomId = `collab:${data.sessionId}:${data.filePath}`;

        // Enforce room limit per session
        const currentCount = sessionRoomCounts.get(data.sessionId) ?? 0;
        if (currentCount >= MAX_ROOMS_PER_SESSION && !joinedRooms.has(roomId)) {
          socket.emit("collab:error", {
            message: `Maximum ${MAX_ROOMS_PER_SESSION} concurrent documents per session`,
          });
          return;
        }

        await socket.join(roomId);
        joinedRooms.add(roomId);
        sessionRoomCounts.set(data.sessionId, currentCount + 1);

        // Announce user joined the document
        socket.to(roomId).emit("collab:user_joined", {
          userId: data.user.userId,
          name: data.user.name,
          color: data.user.color,
          isAgent: data.user.isAgent,
          filePath: data.filePath,
          timestamp: Date.now(),
        });

        // Acknowledge join
        socket.emit("collab:joined", {
          roomId,
          filePath: data.filePath,
          timestamp: Date.now(),
        });

        logger.debug(
          { userId, sessionId: data.sessionId, filePath: data.filePath },
          "Joined collaboration room"
        );
      }
    );

    // ---- Cursor position update ----
    socket.on(
      "collab:cursor",
      (data: {
        sessionId: string;
        filePath: string;
        cursor: CursorUpdate;
        user: CollaborationUser;
      }) => {
        const roomId = `collab:${data.sessionId}:${data.filePath}`;

        // Broadcast cursor to other users in the room
        socket.to(roomId).emit("collab:cursor_update", {
          userId: data.user.userId,
          name: data.user.name,
          color: data.user.color,
          isAgent: data.user.isAgent,
          cursor: data.cursor,
          timestamp: Date.now(),
        });
      }
    );

    // ---- Y.js document update relay ----
    socket.on(
      "collab:doc_update",
      (data: {
        sessionId: string;
        filePath: string;
        /** Base64-encoded Y.js update */
        update: string;
        user: CollaborationUser;
      }) => {
        const roomId = `collab:${data.sessionId}:${data.filePath}`;

        // Relay the Y.js update to all other clients in the room
        socket.to(roomId).emit("collab:doc_update", {
          update: data.update,
          userId: data.user.userId,
          isAgent: data.user.isAgent,
          timestamp: Date.now(),
        });
      }
    );

    // ---- Y.js awareness update relay ----
    socket.on(
      "collab:awareness",
      (data: {
        sessionId: string;
        filePath: string;
        /** Base64-encoded awareness update */
        awarenessUpdate: string;
      }) => {
        const roomId = `collab:${data.sessionId}:${data.filePath}`;

        // Relay awareness to other clients
        socket.to(roomId).emit("collab:awareness_update", {
          awarenessUpdate: data.awarenessUpdate,
          userId,
          timestamp: Date.now(),
        });
      }
    );

    // ---- Leave a document room ----
    socket.on(
      "collab:leave",
      (data: { sessionId: string; filePath: string }) => {
        const roomId = `collab:${data.sessionId}:${data.filePath}`;
        joinedRooms.delete(roomId);
        socket.leave(roomId);

        const currentCount = sessionRoomCounts.get(data.sessionId) ?? 1;
        sessionRoomCounts.set(data.sessionId, Math.max(0, currentCount - 1));

        // Notify others that user left
        namespace.to(roomId).emit("collab:user_left", {
          userId,
          filePath: data.filePath,
          timestamp: Date.now(),
        });

        logger.debug(
          { userId, filePath: data.filePath },
          "Left collaboration room"
        );
      }
    );

    // ---- Disconnect: clean up all rooms ----
    socket.on("disconnect", () => {
      for (const roomId of joinedRooms) {
        namespace.to(roomId).emit("collab:user_left", {
          userId,
          timestamp: Date.now(),
        });
      }
      joinedRooms.clear();

      logger.debug(
        { userId, socketId: socket.id },
        "Client disconnected from collaboration"
      );
    });
  });
}
