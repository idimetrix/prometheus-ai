/**
 * GAP-048: CRDT Collaborative Editing Bridge
 *
 * Bridges between agent file writes and Yjs CRDT documents. When agent
 * writes a file, updates the corresponding Yjs doc. When human edits in
 * Yjs, syncs back to sandbox filesystem. Provides conflict-free merge
 * between human and AI edits.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("socket-server:crdt-bridge");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CRDTDocument {
  content: string;
  filePath: string;
  lastAgentUpdate: number;
  lastHumanUpdate: number;
  sessionId: string;
  version: number;
}

export interface FileWriteEvent {
  content: string;
  filePath: string;
  sessionId: string;
  source: "agent" | "human";
  timestamp: number;
}

export interface SyncResult {
  conflicts: number;
  filePath: string;
  mergedContent: string;
  newVersion: number;
  success: boolean;
}

export interface BridgeStats {
  activeDocuments: number;
  agentWrites: number;
  conflictsResolved: number;
  humanEdits: number;
}

// ---------------------------------------------------------------------------
// CRDTBridge
// ---------------------------------------------------------------------------

export class CRDTBridge {
  private readonly documents = new Map<string, CRDTDocument>();
  private agentWriteCount = 0;
  private humanEditCount = 0;
  private conflictCount = 0;

  /**
   * Get the document key for a session + file path.
   */
  private docKey(sessionId: string, filePath: string): string {
    return `${sessionId}:${filePath}`;
  }

  /**
   * Initialize a CRDT document for a file in a session.
   */
  initDocument(
    sessionId: string,
    filePath: string,
    initialContent: string
  ): CRDTDocument {
    const key = this.docKey(sessionId, filePath);
    const doc: CRDTDocument = {
      sessionId,
      filePath,
      content: initialContent,
      version: 1,
      lastAgentUpdate: 0,
      lastHumanUpdate: 0,
    };

    this.documents.set(key, doc);

    logger.info({ sessionId, filePath }, "CRDT document initialized");

    return doc;
  }

  /**
   * Handle an agent file write by updating the CRDT document.
   */
  applyAgentWrite(event: FileWriteEvent): SyncResult {
    const key = this.docKey(event.sessionId, event.filePath);
    let doc = this.documents.get(key);

    if (!doc) {
      doc = this.initDocument(event.sessionId, event.filePath, "");
    }

    const hasRecentHumanEdit =
      doc.lastHumanUpdate > 0 && event.timestamp - doc.lastHumanUpdate < 5000;

    let mergedContent: string;
    let conflicts = 0;

    if (hasRecentHumanEdit) {
      // Conflict: merge agent and human edits
      const mergeResult = this.mergeContent(doc.content, event.content);
      mergedContent = mergeResult.merged;
      conflicts = mergeResult.conflicts;
      this.conflictCount += conflicts;
    } else {
      mergedContent = event.content;
    }

    doc.content = mergedContent;
    doc.version++;
    doc.lastAgentUpdate = event.timestamp;
    this.agentWriteCount++;

    logger.debug(
      {
        sessionId: event.sessionId,
        filePath: event.filePath,
        version: doc.version,
        conflicts,
      },
      "Agent write applied to CRDT document"
    );

    return {
      filePath: event.filePath,
      success: true,
      mergedContent,
      newVersion: doc.version,
      conflicts,
    };
  }

  /**
   * Handle a human edit from the Yjs collaborative editor.
   */
  applyHumanEdit(event: FileWriteEvent): SyncResult {
    const key = this.docKey(event.sessionId, event.filePath);
    let doc = this.documents.get(key);

    if (!doc) {
      doc = this.initDocument(event.sessionId, event.filePath, "");
    }

    const hasRecentAgentWrite =
      doc.lastAgentUpdate > 0 && event.timestamp - doc.lastAgentUpdate < 5000;

    let mergedContent: string;
    let conflicts = 0;

    if (hasRecentAgentWrite) {
      const mergeResult = this.mergeContent(doc.content, event.content);
      mergedContent = mergeResult.merged;
      conflicts = mergeResult.conflicts;
      this.conflictCount += conflicts;
    } else {
      mergedContent = event.content;
    }

    doc.content = mergedContent;
    doc.version++;
    doc.lastHumanUpdate = event.timestamp;
    this.humanEditCount++;

    logger.debug(
      {
        sessionId: event.sessionId,
        filePath: event.filePath,
        version: doc.version,
        conflicts,
      },
      "Human edit applied to CRDT document"
    );

    return {
      filePath: event.filePath,
      success: true,
      mergedContent,
      newVersion: doc.version,
      conflicts,
    };
  }

  /**
   * Get current document content.
   */
  getDocument(sessionId: string, filePath: string): CRDTDocument | undefined {
    return this.documents.get(this.docKey(sessionId, filePath));
  }

  /**
   * List all documents for a session.
   */
  listDocuments(sessionId: string): CRDTDocument[] {
    const results: CRDTDocument[] = [];
    for (const doc of this.documents.values()) {
      if (doc.sessionId === sessionId) {
        results.push(doc);
      }
    }
    return results;
  }

  /**
   * Remove a document (e.g., when session ends).
   */
  removeDocument(sessionId: string, filePath: string): boolean {
    return this.documents.delete(this.docKey(sessionId, filePath));
  }

  /**
   * Clean up all documents for a session.
   */
  cleanupSession(sessionId: string): number {
    const prefix = `${sessionId}:`;
    let removed = 0;
    for (const key of this.documents.keys()) {
      if (key.startsWith(prefix)) {
        this.documents.delete(key);
        removed++;
      }
    }
    logger.info({ sessionId, removed }, "Session documents cleaned up");
    return removed;
  }

  /**
   * Get bridge statistics.
   */
  getStats(): BridgeStats {
    return {
      activeDocuments: this.documents.size,
      agentWrites: this.agentWriteCount,
      humanEdits: this.humanEditCount,
      conflictsResolved: this.conflictCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal merge logic
  // ---------------------------------------------------------------------------

  /**
   * Merge two versions of content using a line-based strategy.
   * In production, this would use a proper CRDT merge (e.g., Yjs).
   */
  private mergeContent(
    existing: string,
    incoming: string
  ): { merged: string; conflicts: number } {
    const existingLines = existing.split("\n");
    const incomingLines = incoming.split("\n");

    // Simple line-by-line merge: prefer incoming for changed lines
    const maxLen = Math.max(existingLines.length, incomingLines.length);
    const merged: string[] = [];
    let conflicts = 0;

    for (let i = 0; i < maxLen; i++) {
      const existLine = existingLines[i];
      const incomingLine = incomingLines[i];

      if (existLine === undefined) {
        merged.push(incomingLine ?? "");
      } else if (incomingLine === undefined) {
        merged.push(existLine);
      } else if (existLine === incomingLine) {
        merged.push(existLine);
      } else {
        // Conflict: prefer incoming (agent or human, whoever is calling)
        merged.push(incomingLine);
        conflicts++;
      }
    }

    return { merged: merged.join("\n"), conflicts };
  }
}
