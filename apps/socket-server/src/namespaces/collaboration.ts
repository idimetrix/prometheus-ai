import { createLogger } from "@prometheus/logger";
import type { Namespace } from "socket.io";

const logger = createLogger("socket-server:collaboration");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CollaborationRole = "viewer" | "contributor" | "owner";

interface Participant {
  avatar?: string;
  joinedAt: string;
  lastActivity: string;
  name: string;
  role: CollaborationRole;
  socketId: string;
  status: "active" | "idle" | "viewing";
  userId: string;
}

interface ControlRequest {
  requestedAt: string;
  userId: string;
  userName: string;
}

interface SessionRoom {
  controller: string | null;
  controlRequests: ControlRequest[];
  participants: Map<string, Participant>;
}

// ---------------------------------------------------------------------------
// CRDT Document Types (CT01)
// ---------------------------------------------------------------------------

interface DocumentEditor {
  /** Cursor position (opaque awareness data from Yjs) */
  cursor?: { anchor: number; head: number };
  /** File path or document identifier */
  filePath: string;
  joinedAt: string;
  lastUpdate: string;
  /** Selection range if any */
  selection?: { anchor: number; head: number };
  socketId: string;
  userColor: string;
  userId: string;
  userName: string;
}

interface DocumentRoom {
  /** Accumulated Yjs document state vector for late joiners */
  docState: Uint8Array | null;
  editors: Map<string, DocumentEditor>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sessionRooms = new Map<string, SessionRoom>();
/** CRDT document rooms keyed by documentId (e.g., "projectId:filePath") */
const documentRooms = new Map<string, DocumentRoom>();

const IDLE_AUTO_RELEASE_MS = 3 * 60 * 1000; // 3 minutes
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrCreateRoom(sessionId: string): SessionRoom {
  let room = sessionRooms.get(sessionId);
  if (!room) {
    room = {
      participants: new Map(),
      controller: null,
      controlRequests: [],
    };
    sessionRooms.set(sessionId, room);
  }
  return room;
}

function getParticipantList(room: SessionRoom): Participant[] {
  return Array.from(room.participants.values());
}

function cleanupEmptyRoom(sessionId: string): void {
  const room = sessionRooms.get(sessionId);
  if (room && room.participants.size === 0) {
    sessionRooms.delete(sessionId);
    const timer = idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(sessionId);
    }
  }
}

// ---------------------------------------------------------------------------
// CRDT Document Room helpers (CT01)
// ---------------------------------------------------------------------------

/** Default user colors for collaborative cursors */
const EDITOR_COLORS = [
  "#f87171",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#22d3ee",
  "#818cf8",
  "#c084fc",
  "#f472b6",
] as const;

function getOrCreateDocRoom(documentId: string): DocumentRoom {
  let room = documentRooms.get(documentId);
  if (!room) {
    room = {
      editors: new Map(),
      docState: null,
    };
    documentRooms.set(documentId, room);
  }
  return room;
}

function getEditorList(room: DocumentRoom): DocumentEditor[] {
  return Array.from(room.editors.values());
}

function assignEditorColor(room: DocumentRoom): string {
  const idx = room.editors.size % EDITOR_COLORS.length;
  return EDITOR_COLORS[idx] as string;
}

function cleanupEmptyDocRoom(documentId: string): void {
  const room = documentRooms.get(documentId);
  if (room && room.editors.size === 0) {
    documentRooms.delete(documentId);
  }
}

/**
 * Returns a summary of all actively edited documents and their editors.
 * Used by the collaboration.activeEditors tRPC endpoint.
 */
export function getActiveEditors(): Array<{
  documentId: string;
  editors: DocumentEditor[];
}> {
  const result: Array<{ documentId: string; editors: DocumentEditor[] }> = [];
  for (const [documentId, room] of documentRooms) {
    if (room.editors.size > 0) {
      result.push({ documentId, editors: getEditorList(room) });
    }
  }
  return result;
}

function resetIdleAutoRelease(sessionId: string, namespace: Namespace): void {
  const existingTimer = idleTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const room = sessionRooms.get(sessionId);
  if (!room?.controller) {
    return;
  }

  const timer = setTimeout(() => {
    const currentRoom = sessionRooms.get(sessionId);
    if (currentRoom?.controller) {
      const controllerName =
        currentRoom.participants.get(currentRoom.controller)?.name ?? "Unknown";
      currentRoom.controller = null;

      namespace.to(`collab:${sessionId}`).emit("collab:control_changed", {
        userId: "",
        role: "viewer",
        name: controllerName,
      });

      logger.info(
        { sessionId, user: controllerName },
        "Auto-released control due to idle timeout"
      );
    }
    idleTimers.delete(sessionId);
  }, IDLE_AUTO_RELEASE_MS);

  idleTimers.set(sessionId, timer);
}

// ---------------------------------------------------------------------------
// Namespace setup
// ---------------------------------------------------------------------------

export function setupCollaborationNamespace(namespace: Namespace): void {
  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const userName = (socket.data.userName as string) ?? "Unknown";

    logger.info(
      { userId, socketId: socket.id },
      "Client connected to collaboration namespace"
    );

    // ---- collab:join ----
    socket.on(
      "collab:join",
      async (data: { sessionId: string; name?: string }) => {
        const { sessionId } = data;
        const room = getOrCreateRoom(sessionId);

        await socket.join(`collab:${sessionId}`);

        const participant: Participant = {
          userId,
          socketId: socket.id,
          name: data.name ?? userName,
          role: room.participants.size === 0 ? "owner" : "viewer",
          status: "active",
          joinedAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
        };

        room.participants.set(userId, participant);

        // Send current state to joining user
        socket.emit("collab:participants", {
          participants: getParticipantList(room),
          myRole: participant.role,
          controller: room.controller,
        });

        // Notify others
        socket.to(`collab:${sessionId}`).emit("collab:participant_joined", {
          ...participant,
        });

        logger.info(
          { userId, sessionId, role: participant.role },
          "User joined collaboration session"
        );
      }
    );

    // ---- collab:leave ----
    socket.on("collab:leave", async (data: { sessionId: string }) => {
      const { sessionId } = data;
      const room = sessionRooms.get(sessionId);
      if (!room) {
        return;
      }

      const participant = room.participants.get(userId);
      room.participants.delete(userId);

      // If controller left, release control
      if (room.controller === userId) {
        room.controller = null;
        namespace.to(`collab:${sessionId}`).emit("collab:control_changed", {
          userId: "",
          role: "viewer",
          name: participant?.name ?? "Unknown",
        });
      }

      // Remove control requests from this user
      room.controlRequests = room.controlRequests.filter(
        (r) => r.userId !== userId
      );

      await socket.leave(`collab:${sessionId}`);

      namespace.to(`collab:${sessionId}`).emit("collab:participant_left", {
        userId,
        name: participant?.name ?? "Unknown",
      });

      cleanupEmptyRoom(sessionId);

      logger.info({ userId, sessionId }, "User left collaboration session");
    });

    // ---- collab:message ----
    socket.on(
      "collab:message",
      (data: { sessionId: string; content: string }) => {
        const { sessionId, content } = data;
        const room = sessionRooms.get(sessionId);
        if (!room) {
          return;
        }

        const participant = room.participants.get(userId);
        const message = {
          id: `msg-${userId}-${Date.now()}`,
          sender: "user" as const,
          senderName: participant?.name ?? "Unknown",
          userId,
          content,
          timestamp: new Date().toISOString(),
        };

        // Broadcast to all in the room (including sender)
        namespace.to(`collab:${sessionId}`).emit("collab:new_message", message);
      }
    );

    // ---- collab:request_control ----
    socket.on("collab:request_control", (data: { sessionId: string }) => {
      const { sessionId } = data;
      const room = sessionRooms.get(sessionId);
      if (!room) {
        return;
      }

      const participant = room.participants.get(userId);
      if (!participant) {
        return;
      }

      // Don't allow duplicate requests
      if (room.controlRequests.some((r) => r.userId === userId)) {
        return;
      }

      const request: ControlRequest = {
        userId,
        userName: participant.name,
        requestedAt: new Date().toISOString(),
      };

      room.controlRequests.push(request);

      // Notify the owner
      namespace
        .to(`collab:${sessionId}`)
        .emit("collab:control_request", request);

      logger.info(
        { userId, sessionId },
        "Control requested in collaboration session"
      );
    });

    // ---- collab:grant_control ----
    socket.on(
      "collab:grant_control",
      (data: { sessionId: string; userId: string }) => {
        const { sessionId, userId: targetUserId } = data;
        const room = sessionRooms.get(sessionId);
        if (!room) {
          return;
        }

        // Only owner can grant control
        const requester = room.participants.get(userId);
        if (requester?.role !== "owner") {
          return;
        }

        const target = room.participants.get(targetUserId);
        if (!target) {
          return;
        }

        // Grant control
        room.controller = targetUserId;
        target.role = "contributor";

        // Remove request
        room.controlRequests = room.controlRequests.filter(
          (r) => r.userId !== targetUserId
        );

        namespace.to(`collab:${sessionId}`).emit("collab:control_changed", {
          userId: targetUserId,
          role: "contributor",
          name: target.name,
        });

        namespace
          .to(`collab:${sessionId}`)
          .emit("collab:control_request_resolved", {
            userId: targetUserId,
          });

        resetIdleAutoRelease(sessionId, namespace);

        logger.info(
          { userId, targetUserId, sessionId },
          "Control granted in collaboration session"
        );
      }
    );

    // ---- collab:revoke_control ----
    socket.on(
      "collab:revoke_control",
      (data: { sessionId: string; userId: string }) => {
        const { sessionId, userId: targetUserId } = data;
        const room = sessionRooms.get(sessionId);
        if (!room) {
          return;
        }

        // Owner can revoke, or user can self-revoke
        const requester = room.participants.get(userId);
        if (requester?.role !== "owner" && userId !== targetUserId) {
          return;
        }

        const target = room.participants.get(targetUserId);
        if (!target) {
          return;
        }

        if (room.controller === targetUserId) {
          room.controller = null;
        }
        target.role = "viewer";

        // Also remove pending request if denying
        room.controlRequests = room.controlRequests.filter(
          (r) => r.userId !== targetUserId
        );

        namespace.to(`collab:${sessionId}`).emit("collab:control_changed", {
          userId: targetUserId,
          role: "viewer",
          name: target.name,
        });

        namespace
          .to(`collab:${sessionId}`)
          .emit("collab:control_request_resolved", {
            userId: targetUserId,
          });

        logger.info(
          { userId, targetUserId, sessionId },
          "Control revoked in collaboration session"
        );
      }
    );

    // ---- collab:activity ----
    socket.on(
      "collab:activity",
      (data: { sessionId: string; status: "active" | "idle" | "viewing" }) => {
        const { sessionId, status } = data;
        const room = sessionRooms.get(sessionId);
        if (!room) {
          return;
        }

        const participant = room.participants.get(userId);
        if (participant) {
          participant.status = status;
          participant.lastActivity = new Date().toISOString();

          socket.to(`collab:${sessionId}`).emit("collab:participant_activity", {
            userId,
            status,
          });

          // Reset idle auto-release if this is the controller
          if (room.controller === userId && status === "active") {
            resetIdleAutoRelease(sessionId, namespace);
          }
        }
      }
    );

    // ====================================================================
    // CRDT Collaborative Editing Events (CT01)
    // ====================================================================

    // ---- join_document ----
    // Join a Yjs document room for collaborative editing of a specific file
    socket.on(
      "join_document",
      async (data: {
        documentId: string;
        filePath: string;
        userName?: string;
      }) => {
        const { documentId, filePath } = data;
        const docRoom = getOrCreateDocRoom(documentId);
        const socketRoomKey = `doc:${documentId}`;

        await socket.join(socketRoomKey);

        const editor: DocumentEditor = {
          userId,
          socketId: socket.id,
          userName: data.userName ?? userName,
          filePath,
          userColor: assignEditorColor(docRoom),
          joinedAt: new Date().toISOString(),
          lastUpdate: new Date().toISOString(),
        };

        docRoom.editors.set(userId, editor);

        // Send current document state to the joining client for sync
        socket.emit("document_state", {
          documentId,
          editors: getEditorList(docRoom),
          docState: docRoom.docState ? Array.from(docRoom.docState) : null,
        });

        // Notify other editors in the room
        socket.to(socketRoomKey).emit("editor_joined", {
          documentId,
          editor,
        });

        logger.info(
          { userId, documentId, filePath },
          "User joined document room"
        );
      }
    );

    // ---- yjs_update ----
    // Broadcast Yjs incremental updates to other clients editing the same document
    socket.on(
      "yjs_update",
      (data: { documentId: string; update: number[] }) => {
        const { documentId, update } = data;
        const docRoom = documentRooms.get(documentId);
        if (!docRoom) {
          return;
        }

        const editor = docRoom.editors.get(userId);
        if (!editor) {
          return;
        }

        // Store the latest merged state for late joiners
        const updateBytes = new Uint8Array(update);
        if (docRoom.docState) {
          // Append update to existing state
          const merged = new Uint8Array(
            docRoom.docState.length + updateBytes.length
          );
          merged.set(docRoom.docState, 0);
          merged.set(updateBytes, docRoom.docState.length);
          docRoom.docState = merged;
        } else {
          docRoom.docState = updateBytes;
        }

        editor.lastUpdate = new Date().toISOString();

        // Broadcast to all other clients in the document room
        socket.to(`doc:${documentId}`).emit("yjs_update", {
          documentId,
          update,
          userId,
        });
      }
    );

    // ---- awareness_update ----
    // Broadcast cursor positions and selections to other editors
    socket.on(
      "awareness_update",
      (data: {
        documentId: string;
        cursor?: { anchor: number; head: number };
        selection?: { anchor: number; head: number };
      }) => {
        const { documentId, cursor, selection } = data;
        const docRoom = documentRooms.get(documentId);
        if (!docRoom) {
          return;
        }

        const editor = docRoom.editors.get(userId);
        if (!editor) {
          return;
        }

        // Update local editor state
        editor.cursor = cursor;
        editor.selection = selection;
        editor.lastUpdate = new Date().toISOString();

        // Broadcast awareness to other clients
        socket.to(`doc:${documentId}`).emit("awareness_update", {
          documentId,
          userId,
          userName: editor.userName,
          userColor: editor.userColor,
          cursor,
          selection,
        });
      }
    );

    // ---- leave_document ----
    // Leave a document editing room
    socket.on("leave_document", async (data: { documentId: string }) => {
      const { documentId } = data;
      const docRoom = documentRooms.get(documentId);
      if (!docRoom) {
        return;
      }

      const editor = docRoom.editors.get(userId);
      docRoom.editors.delete(userId);

      await socket.leave(`doc:${documentId}`);

      // Notify remaining editors
      namespace.to(`doc:${documentId}`).emit("editor_left", {
        documentId,
        userId,
        userName: editor?.userName ?? userName,
      });

      cleanupEmptyDocRoom(documentId);

      logger.info({ userId, documentId }, "User left document room");
    });

    // ---- disconnect ----
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: cleanup iterates over multiple room types
    socket.on("disconnect", () => {
      // Clean up from all session rooms
      for (const [sessionId, room] of sessionRooms) {
        if (room.participants.has(userId)) {
          const participant = room.participants.get(userId);
          room.participants.delete(userId);

          if (room.controller === userId) {
            room.controller = null;
            namespace.to(`collab:${sessionId}`).emit("collab:control_changed", {
              userId: "",
              role: "viewer",
              name: participant?.name ?? "Unknown",
            });
          }

          room.controlRequests = room.controlRequests.filter(
            (r) => r.userId !== userId
          );

          namespace.to(`collab:${sessionId}`).emit("collab:participant_left", {
            userId,
            name: participant?.name ?? "Unknown",
          });

          cleanupEmptyRoom(sessionId);
        }
      }

      // Clean up from all document rooms (CRDT CT01)
      for (const [documentId, docRoom] of documentRooms) {
        if (docRoom.editors.has(userId)) {
          const editor = docRoom.editors.get(userId);
          docRoom.editors.delete(userId);

          namespace.to(`doc:${documentId}`).emit("editor_left", {
            documentId,
            userId,
            userName: editor?.userName ?? userName,
          });

          cleanupEmptyDocRoom(documentId);
        }
      }

      logger.debug(
        { userId, socketId: socket.id },
        "Client disconnected from collaboration namespace"
      );
    });
  });
}
