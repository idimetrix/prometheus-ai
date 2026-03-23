import type { Extension } from "@codemirror/state";
import { yCollab } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
import { Doc, type Text } from "yjs";

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
