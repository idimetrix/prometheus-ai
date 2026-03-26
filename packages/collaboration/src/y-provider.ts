import type { Extension } from "@codemirror/state";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import { applyUpdate, Doc, encodeStateAsUpdate, type Text } from "yjs";

export interface YProviderOptions {
  /** Room/document identifier */
  roomId: string;
  /** WebSocket server URL (e.g., ws://localhost:4001) */
  serverUrl: string;
  /** Optional auth token */
  token?: string;
  /** User color (hex) for cursors */
  userColor: string;
  /** User display name for awareness */
  userName: string;
}

export interface YProviderInstance {
  /** Disconnect and clean up */
  destroy: () => void;
  /** The Y.js document */
  doc: Doc;
  /** CodeMirror extension for collaborative editing */
  extension: Extension;
  /** The WebSocket provider */
  wsProvider: WebsocketProvider;
  /** The shared text type for the editor */
  yText: Text;
}

/**
 * Creates a Y.js WebSocket provider that connects to the Prometheus socket server
 * and returns a CodeMirror extension for collaborative editing.
 */
export function createYProvider(options: YProviderOptions): YProviderInstance {
  const { serverUrl, roomId, userName, userColor, token } = options;

  const doc = new Doc();
  const yText = doc.getText("codemirror");

  const wsProvider = new WebsocketProvider(serverUrl, roomId, doc, {
    params: token ? { token } : undefined,
    connect: true,
  });

  // Set local awareness state
  wsProvider.awareness.setLocalStateField("user", {
    name: userName,
    color: userColor,
  });

  const extension = yCollab(yText, wsProvider.awareness);

  function destroy(): void {
    wsProvider.awareness.setLocalState(null);
    wsProvider.disconnect();
    wsProvider.destroy();
    doc.destroy();
  }

  return {
    doc,
    wsProvider,
    yText,
    extension,
    destroy,
  };
}

/**
 * Reconnect a provider if the connection was lost.
 */
export function reconnect(provider: YProviderInstance): void {
  provider.wsProvider.connect();
}

/**
 * Check if the provider is currently connected.
 */
export function isConnected(provider: YProviderInstance): boolean {
  return provider.wsProvider.wsconnected;
}

// ---------------------------------------------------------------------------
// Socket.io-based CRDT Provider (CT01)
// ---------------------------------------------------------------------------

export interface SocketYProviderOptions {
  /** Document identifier matching the socket.io collaboration namespace */
  documentId: string;
  /** File path being edited */
  filePath: string;
  /** Socket.io socket instance connected to the /collaboration namespace */
  socket: SocketLike;
  /** User color (hex) for cursors */
  userColor: string;
  /** Unique user identifier */
  userId: string;
  /** User display name for awareness */
  userName: string;
}

/**
 * Minimal socket.io socket interface so we don't depend on the full
 * socket.io-client package in this library package.
 */
export interface SocketLike {
  emit(event: string, ...args: unknown[]): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface SocketYProviderInstance {
  /** Disconnect and clean up */
  destroy: () => void;
  /** The Y.js document */
  doc: Doc;
  /** CodeMirror extension for collaborative editing */
  extension: Extension;
  /** The shared text type for the editor */
  yText: Text;
}

/**
 * Creates a Y.js provider that syncs through the Socket.io collaboration
 * namespace instead of a raw WebSocket. This integrates with the
 * join_document / yjs_update / awareness_update events on the server.
 *
 * Supports:
 * - Document sync on join (full state sent by server to new client)
 * - Incremental updates via Yjs encoding
 * - Multiple concurrent documents per user
 */
export function createSocketYProvider(
  options: SocketYProviderOptions
): SocketYProviderInstance {
  const { socket, documentId, filePath, userName, userColor, userId } = options;

  const doc = new Doc();
  const yText = doc.getText("codemirror");

  // Join the document room on the server
  socket.emit("join_document", { documentId, filePath, userName });

  // --- Handle incoming document state (initial sync for late joiners) ---
  const onDocumentState = (data: unknown) => {
    const payload = data as {
      documentId: string;
      docState: number[] | null;
    };
    if (payload.documentId !== documentId) {
      return;
    }
    if (payload.docState && payload.docState.length > 0) {
      const update = new Uint8Array(payload.docState);
      applyUpdate(doc, update);
    }
  };

  // --- Handle incoming Yjs incremental updates from other editors ---
  const onYjsUpdate = (data: unknown) => {
    const payload = data as {
      documentId: string;
      update: number[];
      userId: string;
    };
    if (payload.documentId !== documentId) {
      return;
    }
    // Don't apply our own updates
    if (payload.userId === userId) {
      return;
    }
    const update = new Uint8Array(payload.update);
    applyUpdate(doc, update);
  };

  // --- Handle incoming awareness updates (cursor positions) ---
  const onAwarenessUpdate = (_data: unknown) => {
    // Awareness is handled via the Yjs awareness protocol when using
    // the y-websocket provider. For socket.io mode, cursor positions
    // are tracked through the awareness_update event on the server
    // and rendered by the UI layer directly. No doc-level action needed.
  };

  socket.on("document_state", onDocumentState);
  socket.on("yjs_update", onYjsUpdate);
  socket.on("awareness_update", onAwarenessUpdate);

  // --- Broadcast local Yjs updates to the server ---
  const updateHandler = (update: Uint8Array, origin: unknown) => {
    // Only broadcast updates that originate locally (not from remote sync)
    if (origin === "remote") {
      return;
    }
    socket.emit("yjs_update", {
      documentId,
      update: Array.from(update),
    });
  };
  doc.on("update", updateHandler);

  // --- Broadcast cursor/selection awareness ---
  function _broadcastCursor(cursor?: { anchor: number; head: number }): void {
    socket.emit("awareness_update", {
      documentId,
      cursor,
    });
  }

  // Create a local Awareness instance for the CodeMirror yCollab binding.
  // Cursor/selection sync is handled separately via socket.io awareness_update.
  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", {
    name: userName,
    color: userColor,
  });
  const extension = yCollab(yText, awareness);

  function destroy(): void {
    // Unsubscribe from doc updates
    doc.off("update", updateHandler);

    // Unsubscribe from socket events
    socket.off("document_state", onDocumentState);
    socket.off("yjs_update", onYjsUpdate);
    socket.off("awareness_update", onAwarenessUpdate);

    // Leave the document room
    socket.emit("leave_document", { documentId });

    doc.destroy();
  }

  return {
    doc,
    yText,
    extension,
    destroy,
  };
}

/**
 * Encode the full Yjs document state as a portable byte array.
 * Useful for persisting or transferring document state.
 */
export function encodeDocState(doc: Doc): Uint8Array {
  return encodeStateAsUpdate(doc);
}

/**
 * Apply a remote Yjs state update to a local document.
 */
export function applyRemoteUpdate(doc: Doc, update: Uint8Array): void {
  applyUpdate(doc, update, "remote");
}
