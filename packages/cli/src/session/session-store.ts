import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface SessionMessage {
  content: string;
  role: "user" | "agent" | "system";
  timestamp: string;
}

interface SessionState {
  agentRole: string | null;
  createdAt: string;
  filesChanged: string[];
  messages: SessionMessage[];
  projectPath: string;
  sessionId: string;
  updatedAt: string;
}

/**
 * Persists CLI session state to ~/.prometheus/sessions/ for session
 * restoration and history browsing.
 */
export class CLISessionStore {
  private readonly sessionsDir: string;

  constructor(baseDir?: string) {
    this.sessionsDir = baseDir ?? join(homedir(), ".prometheus", "sessions");
    this.ensureDir();
  }

  /**
   * Save session state to disk.
   */
  saveSession(sessionId: string, state: Omit<SessionState, "sessionId">): void {
    this.ensureDir();
    const filePath = this.sessionPath(sessionId);
    const data: SessionState = {
      sessionId,
      ...state,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load a session from disk by ID.
   */
  loadSession(sessionId: string): SessionState | null {
    const filePath = this.sessionPath(sessionId);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as SessionState;
    } catch {
      return null;
    }
  }

  /**
   * List all saved sessions, sorted by most recent first.
   */
  listSessions(): SessionState[] {
    this.ensureDir();
    const files = readdirSync(this.sessionsDir).filter((f) =>
      f.endsWith(".json")
    );

    const sessions: SessionState[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.sessionsDir, file), "utf-8");
        sessions.push(JSON.parse(raw) as SessionState);
      } catch {
        // Skip malformed session files
      }
    }

    return sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Delete a saved session.
   */
  deleteSession(sessionId: string): boolean {
    const filePath = this.sessionPath(sessionId);
    if (!existsSync(filePath)) {
      return false;
    }
    unlinkSync(filePath);
    return true;
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }
}

export type { SessionMessage, SessionState };
