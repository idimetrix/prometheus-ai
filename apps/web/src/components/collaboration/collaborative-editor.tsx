"use client";

/**
 * Collaborative Editor Stub (Phase 9.1)
 *
 * This component demonstrates how Yjs-based collaborative editing
 * would integrate into the Prometheus platform. When fully implemented,
 * it provides:
 *
 * - Real-time collaborative text editing via Yjs CRDT
 * - Presence awareness (who's viewing/editing)
 * - Remote cursor position indicators
 * - Inline comment markers for code review
 *
 * Dependencies to install:
 *   pnpm add yjs y-websocket y-codemirror.next @prometheus/collaboration
 *
 * The @prometheus/collaboration package would provide:
 *   - WebSocket provider configuration
 *   - Awareness protocol helpers
 *   - Permission-based editing controls
 *   - Conflict resolution strategies
 */

import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface CollaboratorPresence {
  color: string;
  cursor: CursorPosition | null;
  isActive: boolean;
  lastSeen: Date;
  name: string;
  userId: string;
}

interface CursorPosition {
  column: number;
  line: number;
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

interface InlineComment {
  createdAt: Date;
  id: string;
  line: number;
  resolved: boolean;
  text: string;
  userId: string;
  userName: string;
}

interface CollaborativeEditorProps {
  /** The document/session ID to collaborate on */
  documentId: string;
  /** Initial content to populate if no shared state exists */
  initialContent?: string;
  /** Called when content changes */
  onChange?: (content: string) => void;
  /** Whether the current user has write permission */
  readOnly?: boolean;
  /** The current user's ID */
  userId: string;
  /** The current user's display name */
  userName: string;
  /** WebSocket server URL for Yjs provider */
  wsUrl?: string;
}

// ─── Collaborator Colors ───────────────────────────────────────────────────

const COLLABORATOR_COLORS = [
  "#f87171", // red
  "#fb923c", // orange
  "#fbbf24", // amber
  "#34d399", // emerald
  "#22d3ee", // cyan
  "#818cf8", // indigo
  "#c084fc", // purple
  "#f472b6", // pink
] as const;

function getCollaboratorColor(index: number): string {
  return COLLABORATOR_COLORS[index % COLLABORATOR_COLORS.length] ?? "#94a3b8";
}

// ─── Presence Awareness Display ────────────────────────────────────────────

function PresenceAvatars({
  collaborators,
}: {
  collaborators: CollaboratorPresence[];
}) {
  const activeCollaborators = collaborators.filter((c) => c.isActive);

  if (activeCollaborators.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-muted-foreground text-xs">
        {activeCollaborators.length} online
      </span>
      <div className="flex -space-x-2">
        {activeCollaborators.map((collaborator) => (
          <div
            className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-background font-medium text-white text-xs"
            key={collaborator.userId}
            style={{ backgroundColor: collaborator.color }}
            title={`${collaborator.name}${collaborator.cursor ? ` (line ${collaborator.cursor.line})` : ""}`}
          >
            {collaborator.name.charAt(0).toUpperCase()}
            {collaborator.cursor && (
              <span className="absolute -right-1 -bottom-1 h-2 w-2 rounded-full bg-green-400 ring-1 ring-background" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Cursor Position Indicator ─────────────────────────────────────────────

function RemoteCursorLabel({
  collaborator,
}: {
  collaborator: CollaboratorPresence;
}) {
  if (!collaborator.cursor) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-50"
      style={{
        // In a real implementation, these would be calculated from
        // the editor's coordinate mapping (e.g., CodeMirror's coordsAtPos)
        top: `${collaborator.cursor.line * 20}px`,
        left: `${collaborator.cursor.column * 8}px`,
      }}
    >
      {/* Cursor line */}
      <div
        className="h-5 w-0.5"
        style={{ backgroundColor: collaborator.color }}
      />
      {/* Name label */}
      <div
        className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 py-0.5 font-medium text-[10px] text-white"
        style={{ backgroundColor: collaborator.color }}
      >
        {collaborator.name}
      </div>
    </div>
  );
}

// ─── Inline Comment Markers ────────────────────────────────────────────────

function CommentMarker({
  comment,
  onResolve,
}: {
  comment: InlineComment;
  onResolve: (commentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group relative">
      {/* Gutter icon */}
      <button
        aria-label={`Comment by ${comment.userName}: ${comment.text}`}
        className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] text-white opacity-80 hover:opacity-100"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        !
      </button>

      {/* Expanded comment bubble */}
      {expanded && (
        <div className="absolute top-0 left-6 z-40 w-64 rounded-md border border-border bg-popover p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="font-medium text-xs">{comment.userName}</span>
            <span className="text-[10px] text-muted-foreground">
              Line {comment.line}
            </span>
          </div>
          <p className="mt-1 text-foreground text-sm">{comment.text}</p>
          {!comment.resolved && (
            <button
              className="mt-2 text-primary text-xs hover:underline"
              onClick={() => onResolve(comment.id)}
              type="button"
            >
              Resolve
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Collaborative Editor Component ───────────────────────────────────

export function CollaborativeEditor({
  documentId,
  userId: _userId,
  userName: _userName,
  initialContent = "",
  readOnly = false,
  onChange,
  wsUrl: _wsUrl = "ws://localhost:4001/yjs",
}: CollaborativeEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>(
    []
  );
  const [comments, setComments] = useState<InlineComment[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  /**
   * TODO: Initialize Yjs document and WebSocket provider
   *
   * Implementation outline:
   *
   * ```typescript
   * import * as Y from "yjs";
   * import { WebsocketProvider } from "y-websocket";
   * import { yCollab } from "y-codemirror.next";
   *
   * const ydoc = new Y.Doc();
   * const ytext = ydoc.getText("content");
   *
   * const provider = new WebsocketProvider(wsUrl, documentId, ydoc, {
   *   connect: true,
   *   params: { userId, token: authToken },
   * });
   *
   * // Awareness for presence
   * provider.awareness.setLocalStateField("user", {
   *   name: userName,
   *   color: getCollaboratorColor(userIndex),
   * });
   *
   * // Integrate with CodeMirror
   * const extensions = [
   *   yCollab(ytext, provider.awareness),
   *   // ... other CodeMirror extensions
   * ];
   * ```
   */

  // Simulated connection status
  useEffect(() => {
    const timer = setTimeout(() => setIsConnected(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Simulated awareness updates
  useEffect(() => {
    // In production, this would come from provider.awareness.on("change", ...)
    setCollaborators([
      {
        userId: "demo-user-1",
        name: "Alice",
        color: getCollaboratorColor(0),
        cursor: { line: 12, column: 8 },
        isActive: true,
        lastSeen: new Date(),
      },
      {
        userId: "demo-user-2",
        name: "Bob",
        color: getCollaboratorColor(1),
        cursor: { line: 45, column: 22 },
        isActive: true,
        lastSeen: new Date(),
      },
    ]);
  }, []);

  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      onChange?.(newContent);
    },
    [onChange]
  );

  const handleResolveComment = useCallback((commentId: string) => {
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c))
    );
  }, []);

  const unresolvedComments = useMemo(
    () => comments.filter((c) => !c.resolved),
    [comments]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-border border-b bg-muted/50 px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            <div
              className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "animate-pulse bg-yellow-500"}`}
            />
            <span className="text-muted-foreground text-xs">
              {isConnected ? "Connected" : "Connecting..."}
            </span>
          </div>

          {/* Document ID */}
          <span className="text-muted-foreground/60 text-xs">{documentId}</span>
        </div>

        {/* Presence avatars */}
        <PresenceAvatars collaborators={collaborators} />
      </div>

      {/* Editor area */}
      <div className="relative flex-1 overflow-auto">
        {/* Remote cursor overlays */}
        {collaborators.map((collaborator) => (
          <RemoteCursorLabel
            collaborator={collaborator}
            key={collaborator.userId}
          />
        ))}

        {/* Comment gutter */}
        {unresolvedComments.length > 0 && (
          <div className="absolute top-0 left-0 h-full w-6">
            {unresolvedComments.map((comment) => (
              <div
                className="absolute left-1"
                key={comment.id}
                style={{ top: `${comment.line * 20}px` }}
              >
                <CommentMarker
                  comment={comment}
                  onResolve={handleResolveComment}
                />
              </div>
            ))}
          </div>
        )}

        {/*
         * Editor placeholder — in production, this would be replaced by
         * a CodeMirror 6 instance with Yjs collaborative extensions:
         *
         * <CodeMirror
         *   value={content}
         *   extensions={[yCollab(ytext, provider.awareness), ...]}
         *   readOnly={readOnly}
         * />
         */}
        <textarea
          aria-label="Collaborative editor content"
          className="h-full min-h-[400px] w-full resize-none bg-background p-4 pl-8 font-mono text-sm focus:outline-none"
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="Start typing or wait for collaborative content to sync..."
          readOnly={readOnly}
          value={content}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-border border-t bg-muted/50 px-3 py-1">
        <span className="text-[11px] text-muted-foreground">
          {readOnly ? "Read-only" : "Editing"} | {unresolvedComments.length}{" "}
          comment{unresolvedComments.length === 1 ? "" : "s"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {collaborators.filter((c) => c.isActive).length + 1} participant
          {collaborators.filter((c) => c.isActive).length > 0 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
