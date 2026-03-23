/**
 * Cursor position within a file.
 */
export interface CursorPosition {
  /** Column number (1-based) */
  column: number;
  /** Absolute file path */
  filePath: string;
  /** Line number (1-based) */
  line: number;
}

/**
 * A user's cursor presence state.
 */
export interface CursorPresenceState {
  /** Hex color for the cursor highlight */
  color: string;
  /** Whether this cursor belongs to an AI agent */
  isAgent: boolean;
  /** Timestamp of last position update */
  lastUpdated: number;
  /** Current cursor position, or null if not in a file */
  position: CursorPosition | null;
  /** Unique identifier for the user or agent */
  userId: string;
  /** Display name of the user or agent */
  userName: string;
}

/** AI agent cursor colors (distinct blue/purple tones) */
const AGENT_COLORS = [
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#2dd4bf", // teal
  "#f0abfc", // fuchsia
] as const;

/** Human user cursor colors (warm tones) */
const USER_COLORS = [
  "#f87171", // red
  "#fb923c", // orange
  "#facc15", // yellow
  "#4ade80", // green
  "#818cf8", // indigo
  "#f472b6", // pink
] as const;

/**
 * Tracks cursor positions for multiple users (humans and AI agents)
 * in a collaborative editing session.
 */
export class CursorPresence {
  private listeners: Array<(cursors: CursorPresenceState[]) => void> = [];
  private readonly cursors = new Map<string, CursorPresenceState>();
  private agentColorIndex = 0;
  private userColorIndex = 0;

  /**
   * Set or update a user's cursor position.
   */
  setPosition(
    userId: string,
    userName: string,
    position: CursorPosition | null,
    isAgent = false
  ): void {
    const existing = this.cursors.get(userId);
    const color = existing?.color ?? this.assignColor(isAgent);

    this.cursors.set(userId, {
      userId,
      userName,
      color,
      position,
      isAgent,
      lastUpdated: Date.now(),
    });

    this.notifyListeners();
  }

  /**
   * Remove a user's cursor (e.g., when they disconnect).
   */
  remove(userId: string): void {
    if (this.cursors.delete(userId)) {
      this.notifyListeners();
    }
  }

  /**
   * Get all active cursor states.
   */
  getAll(): CursorPresenceState[] {
    return Array.from(this.cursors.values());
  }

  /**
   * Get cursors for a specific file.
   */
  getByFile(filePath: string): CursorPresenceState[] {
    return this.getAll().filter(
      (cursor) => cursor.position?.filePath === filePath
    );
  }

  /**
   * Get only AI agent cursors.
   */
  getAgentCursors(): CursorPresenceState[] {
    return this.getAll().filter((cursor) => cursor.isAgent);
  }

  /**
   * Get only human user cursors.
   */
  getUserCursors(): CursorPresenceState[] {
    return this.getAll().filter((cursor) => !cursor.isAgent);
  }

  /**
   * Remove cursors that haven't been updated within the given timeout (ms).
   * Default timeout: 60 seconds.
   */
  pruneStale(timeoutMs = 60_000): void {
    const cutoff = Date.now() - timeoutMs;
    let changed = false;

    for (const [userId, state] of this.cursors) {
      if (state.lastUpdated < cutoff) {
        this.cursors.delete(userId);
        changed = true;
      }
    }

    if (changed) {
      this.notifyListeners();
    }
  }

  /**
   * Subscribe to cursor changes. Returns an unsubscribe function.
   */
  onChange(callback: (cursors: CursorPresenceState[]) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /**
   * Clear all cursor state and listeners.
   */
  dispose(): void {
    this.cursors.clear();
    this.listeners = [];
  }

  private assignColor(isAgent: boolean): string {
    if (isAgent) {
      const color = AGENT_COLORS[
        this.agentColorIndex % AGENT_COLORS.length
      ] as string;
      this.agentColorIndex++;
      return color;
    }
    const color = USER_COLORS[
      this.userColorIndex % USER_COLORS.length
    ] as string;
    this.userColorIndex++;
    return color;
  }

  private notifyListeners(): void {
    const cursors = this.getAll();
    for (const listener of this.listeners) {
      listener(cursors);
    }
  }
}
