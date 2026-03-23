import type { WebsocketProvider } from "y-websocket";

export interface AwarenessUser {
  /** Optional avatar URL */
  avatar?: string;
  color: string;
  name: string;
}

export interface AwarenessCursorState {
  cursor?: {
    anchor: number;
    head: number;
  };
  /** Timestamp of last activity */
  lastActive: number;
  selection?: {
    anchor: number;
    head: number;
  };
  user: AwarenessUser;
}

/** Default color palette for user cursors */
const CURSOR_COLORS = [
  "#f87171", // red
  "#fb923c", // orange
  "#facc15", // yellow
  "#4ade80", // green
  "#22d3ee", // cyan
  "#818cf8", // indigo
  "#c084fc", // purple
  "#f472b6", // pink
  "#2dd4bf", // teal
  "#a3e635", // lime
] as const;

/**
 * Assigns a deterministic color to a user based on their client ID.
 */
export function getUserColor(clientId: number): string {
  const idx = clientId % CURSOR_COLORS.length;
  return CURSOR_COLORS[idx] as string;
}

/**
 * Sets the local user's awareness information.
 */
export function setLocalUser(
  provider: WebsocketProvider,
  user: AwarenessUser
): void {
  provider.awareness.setLocalStateField("user", {
    name: user.name,
    color: user.color,
    avatar: user.avatar,
  });
}

/**
 * Update local user's active timestamp (call periodically to indicate presence).
 */
export function updateActivity(provider: WebsocketProvider): void {
  provider.awareness.setLocalStateField("lastActive", Date.now());
}

export interface RemoteUser {
  clientId: number;
  cursor?: { anchor: number; head: number };
  lastActive?: number;
  user: AwarenessUser;
}

/**
 * Returns all remote users currently connected (excluding local).
 */
export function getRemoteUsers(provider: WebsocketProvider): RemoteUser[] {
  const localId = provider.awareness.clientID;
  const states = provider.awareness.getStates();
  const users: RemoteUser[] = [];

  for (const [clientId, state] of states) {
    if (clientId === localId) {
      continue;
    }
    const userData = state as Record<string, unknown>;
    const user = userData.user as AwarenessUser | undefined;
    if (!user) {
      continue;
    }

    users.push({
      clientId,
      user,
      cursor: userData.cursor as { anchor: number; head: number } | undefined,
      lastActive: userData.lastActive as number | undefined,
    });
  }

  return users;
}

/**
 * Subscribe to awareness changes (users joining, leaving, cursor moves).
 * Returns an unsubscribe function.
 */
export function onAwarenessChange(
  provider: WebsocketProvider,
  callback: (users: RemoteUser[]) => void
): () => void {
  const handler = () => {
    callback(getRemoteUsers(provider));
  };

  provider.awareness.on("change", handler);
  return () => {
    provider.awareness.off("change", handler);
  };
}
