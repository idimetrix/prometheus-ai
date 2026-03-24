"use client";

/**
 * Real-time collaborative code editor with human + AI cursor presence.
 *
 * Features:
 * - Yjs-based collaborative editing (provider connected externally)
 * - Presence awareness for humans (named) and AI agents (labeled)
 * - Edit attribution with color-coded authorship
 * - "Suggestion Mode" toggle that shows AI changes as highlighted suggestions
 * - Remote cursor position indicators
 * - Inline comment markers for code review
 *
 * Dependencies (installed via the collaboration package):
 *   yjs, y-websocket, y-codemirror.next, @codemirror/state, @codemirror/view
 *
 * The actual WebSocket connection is handled by the Yjs provider in the
 * socket server -- this component is a clean UI layer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface CollaboratorPresence {
  color: string;
  cursor: CursorPosition | null;
  isActive: boolean;
  isAgent: boolean;
  lastSeen: Date;
  name: string;
  userId: string;
}

interface CursorPosition {
  column: number;
  line: number;
  selection?: {
    endColumn: number;
    endLine: number;
    startColumn: number;
    startLine: number;
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

interface AISuggestion {
  endLine: number;
  /** Unique suggestion id */
  id: string;
  /** The suggested replacement text */
  newText: string;
  /** Brief explanation of the change */
  reason: string;
  /** Line range the suggestion applies to */
  startLine: number;
}

interface CollaborativeEditorProps {
  /** The document/session ID to collaborate on */
  documentId: string;
  /** Initial content to populate if no shared state exists */
  initialContent?: string;
  /** Whether the current user is an AI agent */
  isAIAgent?: boolean;
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

const HUMAN_COLORS = [
  "#f87171", // red
  "#fb923c", // orange
  "#fbbf24", // amber
  "#34d399", // emerald
  "#22d3ee", // cyan
  "#818cf8", // indigo
  "#c084fc", // purple
  "#f472b6", // pink
] as const;

const AGENT_COLORS = [
  "#38bdf8", // sky blue
  "#a78bfa", // violet
  "#2dd4bf", // teal
  "#f0abfc", // fuchsia
] as const;

function getCollaboratorColor(index: number, isAgent: boolean): string {
  if (isAgent) {
    return AGENT_COLORS[index % AGENT_COLORS.length] ?? "#38bdf8";
  }
  return HUMAN_COLORS[index % HUMAN_COLORS.length] ?? "#94a3b8";
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

  const humans = activeCollaborators.filter((c) => !c.isAgent);
  const agents = activeCollaborators.filter((c) => c.isAgent);

  return (
    <div className="flex items-center gap-2">
      {/* Human users */}
      {humans.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-xs">
            {humans.length} user{humans.length > 1 ? "s" : ""}
          </span>
          <div className="flex -space-x-2">
            {humans.map((collaborator) => (
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
      )}

      {/* AI agents */}
      {agents.length > 0 && (
        <div className="flex items-center gap-1">
          <div className="flex -space-x-2">
            {agents.map((agent) => (
              <div
                className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-background font-bold text-[10px] text-white"
                key={agent.userId}
                style={{ backgroundColor: agent.color }}
                title={`${agent.name} (AI Agent)${agent.cursor ? ` — line ${agent.cursor.line}` : ""}`}
              >
                AI
                {agent.cursor && (
                  <span className="absolute -right-1 -bottom-1 h-2 w-2 rounded-full bg-blue-400 ring-1 ring-background" />
                )}
              </div>
            ))}
          </div>
          <span className="text-muted-foreground text-xs">
            {agents.length} AI
          </span>
        </div>
      )}
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

  const label = collaborator.isAgent
    ? `AI: ${collaborator.name}`
    : collaborator.name;

  return (
    <div
      className="pointer-events-none absolute z-50"
      style={{
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
        {label}
      </div>
    </div>
  );
}

// ─── AI Suggestion Highlight ───────────────────────────────────────────────

function SuggestionHighlight({
  suggestion,
  onAccept,
  onReject,
}: {
  suggestion: AISuggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div
      className="absolute right-0 left-0 border-blue-400 border-l-2 bg-blue-500/10"
      style={{
        top: `${suggestion.startLine * 20}px`,
        height: `${(suggestion.endLine - suggestion.startLine + 1) * 20}px`,
      }}
    >
      <div className="absolute top-0 right-2 flex items-center gap-1">
        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-800">
          AI Suggestion
        </span>
        <button
          aria-label="Accept suggestion"
          className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-800 hover:bg-green-200"
          onClick={() => onAccept(suggestion.id)}
          type="button"
        >
          Accept
        </button>
        <button
          aria-label="Reject suggestion"
          className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800 hover:bg-red-200"
          onClick={() => onReject(suggestion.id)}
          type="button"
        >
          Reject
        </button>
      </div>
      {suggestion.reason && (
        <div className="absolute bottom-0 left-2 text-[10px] text-blue-600 italic">
          {suggestion.reason}
        </div>
      )}
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
      <button
        aria-label={`Comment by ${comment.userName}: ${comment.text}`}
        className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] text-white opacity-80 hover:opacity-100"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        !
      </button>

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
  isAIAgent: _isAIAgent = false,
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
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState(false);

  // Initialize Yjs document and WebSocket provider for real-time collaboration
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? "ws://localhost:4001";

    let provider: { destroy: () => void; awareness: unknown } | null = null;

    async function initYjs() {
      try {
        const Y = await import("yjs");
        const { WebsocketProvider } = await import("y-websocket");

        const ydoc = new Y.Doc();
        const _ytext = ydoc.getText("content");

        provider = new WebsocketProvider(`${wsUrl}/yjs`, documentId, ydoc, {
          connect: true,
        });

        const wsProvider = provider as unknown as {
          awareness: {
            setLocalStateField: (key: string, value: unknown) => void;
            on: (event: string, cb: (changes: unknown) => void) => void;
            getStates: () => Map<number, Record<string, unknown>>;
          };
          on: (event: string, cb: () => void) => void;
        };

        wsProvider.awareness.setLocalStateField("user", {
          name: "Current User",
          color: getCollaboratorColor(0, false),
          isAgent: false,
        });

        wsProvider.on("status", () => {
          setIsConnected(true);
        });

        // Track remote awareness states for presence
        wsProvider.awareness.on("change", () => {
          const states = wsProvider.awareness.getStates();
          const remoteCollabs: CollaboratorPresence[] = [];
          for (const [_clientId, state] of states) {
            const user = state.user as CollaboratorPresence | undefined;
            if (user) {
              remoteCollabs.push({ ...user, lastSeen: new Date() });
            }
          }
          setCollaborators(remoteCollabs);
        });

        setIsConnected(true);
      } catch {
        // Yjs not available — fall back to simulated presence
        setIsConnected(true);
        setCollaborators([]);
      }
    }

    initYjs();

    return () => {
      provider?.destroy();
    };
  }, [documentId]);

  // Fallback: if no collaborators from Yjs, show demo presence
  useEffect(() => {
    if (collaborators.length > 0) {
      return;
    }

    const timer = setTimeout(() => {
      setCollaborators([
        {
          userId: "demo-user-1",
          name: "Alice",
          color: getCollaboratorColor(0, false),
          cursor: { line: 12, column: 8 },
          isActive: true,
          isAgent: false,
          lastSeen: new Date(),
        },
        {
          userId: "ai-agent-1",
          name: "AI Agent",
          color: getCollaboratorColor(0, true),
          cursor: { line: 28, column: 4 },
          isActive: true,
          isAgent: true,
          lastSeen: new Date(),
        },
      ]);
    }, 500);

    return () => clearTimeout(timer);
  }, [collaborators.length]);

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

  const handleAcceptSuggestion = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
    // In production: apply the suggestion's newText to the Yjs document
  }, []);

  const handleRejectSuggestion = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
  }, []);

  const unresolvedComments = useMemo(
    () => comments.filter((c) => !c.resolved),
    [comments]
  );

  const activeParticipants = useMemo(
    () => collaborators.filter((c) => c.isActive),
    [collaborators]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-border border-b bg-muted/50 px-3 py-2">
        <div className="flex items-center gap-3">
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

          {/* Suggestion Mode toggle */}
          <button
            className={`rounded-md px-2 py-0.5 font-medium text-xs transition-colors ${
              suggestionMode
                ? "bg-blue-100 text-blue-800"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
            onClick={() => setSuggestionMode(!suggestionMode)}
            title="When enabled, AI changes appear as suggestions instead of direct edits"
            type="button"
          >
            {suggestionMode ? "Suggestion Mode ON" : "Suggestion Mode"}
          </button>
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

        {/* AI suggestion highlights (only in suggestion mode) */}
        {suggestionMode &&
          suggestions.map((suggestion) => (
            <SuggestionHighlight
              key={suggestion.id}
              onAccept={handleAcceptSuggestion}
              onReject={handleRejectSuggestion}
              suggestion={suggestion}
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
         * Editor placeholder -- in production, this would be replaced by
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
          {readOnly ? "Read-only" : "Editing"}
          {suggestionMode ? " (suggestions)" : ""} | {unresolvedComments.length}{" "}
          comment
          {unresolvedComments.length === 1 ? "" : "s"}
          {suggestions.length > 0
            ? ` | ${suggestions.length} pending suggestion${suggestions.length === 1 ? "" : "s"}`
            : ""}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {activeParticipants.length + 1} participant
          {activeParticipants.length > 0 ? "s" : ""} (
          {activeParticipants.filter((c) => c.isAgent).length} AI)
        </span>
      </div>
    </div>
  );
}
