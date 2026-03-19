"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

// --- Types ---

interface CollaboratorInfo {
  color: string;
  name: string;
  userId: string;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface CollaborativeEditorProps {
  /** Content to initialize the document with (used when no shared state exists) */
  content: string;
  /** Language/file extension for syntax highlighting */
  language: string;
  /** Called when document content changes */
  onChange?: (content: string) => void;
  /** Called when save is triggered */
  onSave?: (content: string) => void;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Unique room identifier for the collaborative session */
  roomId: string;
  /** Current user's color (optional, auto-assigned if not provided) */
  userColor?: string;
  /** Current user's unique identifier */
  userId: string;
  /** Current user's display name */
  userName: string;
  /** WebSocket server URL (defaults to ws://localhost:4001/yjs) */
  wsUrl?: string;
}

// Dynamically import CodeMirrorEditor to avoid SSR issues
const CodeMirrorEditor = dynamic(
  () =>
    import("./panels/codemirror-editor").then((mod) => ({
      default: mod.CodeMirrorEditor,
    })),
  { ssr: false, loading: () => <div className="h-full bg-zinc-950" /> }
);

// --- Collaborator Colors ---

const COLLAB_COLORS = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#34d399",
  "#22d3ee",
  "#818cf8",
  "#c084fc",
  "#f472b6",
] as const;

function getColorForUser(userId: string): string {
  let hash = 0;
  for (const char of userId) {
    hash = Math.trunc(hash * 31 + char.charCodeAt(0));
  }
  return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length] ?? "#94a3b8";
}

// --- Connection Status Badge ---

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const colorMap: Record<ConnectionStatus, string> = {
    connecting: "bg-yellow-500 animate-pulse",
    connected: "bg-green-500",
    disconnected: "bg-zinc-500",
    error: "bg-red-500",
  };

  const labelMap: Record<ConnectionStatus, string> = {
    connecting: "Connecting...",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Connection Error",
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2 w-2 rounded-full ${colorMap[status]}`} />
      <span className="text-muted-foreground text-xs">{labelMap[status]}</span>
    </div>
  );
}

// --- Collaborator Avatars ---

function CollaboratorAvatars({
  collaborators,
}: {
  collaborators: CollaboratorInfo[];
}) {
  if (collaborators.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-muted-foreground text-xs">
        {collaborators.length} online
      </span>
      <div className="flex -space-x-2">
        {collaborators.map((collab) => (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background font-medium text-white text-xs"
            key={collab.userId}
            style={{ backgroundColor: collab.color }}
            title={collab.name}
          >
            {collab.name.charAt(0).toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Collaborative Editor with Yjs ---

function useYjsCollaboration(
  roomId: string,
  userId: string,
  userName: string,
  userColor: string,
  wsUrl: string,
  initialContent: string,
  onContentChange?: (content: string) => void
): {
  collaborators: CollaboratorInfo[];
  connectionStatus: ConnectionStatus;
  yjsExtension: unknown | null;
  content: string;
} {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [yjsExtension, setYjsExtension] = useState<unknown | null>(null);
  const [content, setContent] = useState(initialContent);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initYjs(): Promise<void> {
      try {
        // Dynamic imports for Yjs packages (may not be installed)
        const [yMod, yWsMod, yCollabMod] = await Promise.all([
          import("yjs"),
          import("y-websocket"),
          import("y-codemirror.next"),
        ]);

        if (cancelled) {
          return;
        }

        const Y = yMod;
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("content");

        // Set initial content if the document is empty
        if (ytext.length === 0 && initialContent) {
          ytext.insert(0, initialContent);
        }

        const provider = new yWsMod.WebsocketProvider(wsUrl, roomId, ydoc, {
          connect: true,
        });

        // Set up awareness
        provider.awareness.setLocalStateField("user", {
          name: userName,
          color: userColor,
          userId,
        });

        // Track connection status
        provider.on("status", (event: { status: string }) => {
          if (cancelled) {
            return;
          }
          if (event.status === "connected") {
            setConnectionStatus("connected");
          } else if (event.status === "connecting") {
            setConnectionStatus("connecting");
          } else {
            setConnectionStatus("disconnected");
          }
        });

        // Track awareness changes (other users' cursors)
        provider.awareness.on("change", () => {
          if (cancelled) {
            return;
          }

          const states = provider.awareness.getStates();
          const collabs: CollaboratorInfo[] = [];

          states.forEach(
            (
              state: { user?: { name: string; color: string; userId: string } },
              clientId: number
            ) => {
              if (clientId !== ydoc.clientID && state.user) {
                collabs.push({
                  userId: state.user.userId,
                  name: state.user.name,
                  color: state.user.color,
                });
              }
            }
          );

          setCollaborators(collabs);
        });

        // Observe text changes
        ytext.observe(() => {
          if (!cancelled) {
            const newContent = ytext.toString();
            setContent(newContent);
            onContentChange?.(newContent);
          }
        });

        // Create the yCollab extension for CodeMirror
        const collabExtension = yCollabMod.yCollab(ytext, provider.awareness, {
          undoManager: new Y.UndoManager(ytext),
        });
        setYjsExtension(collabExtension);
        setConnectionStatus("connected");

        // Store cleanup function
        cleanupRef.current = () => {
          provider.disconnect();
          ydoc.destroy();
        };
      } catch {
        // Yjs packages not available, fall back to regular editor
        if (!cancelled) {
          setConnectionStatus("error");
          setYjsExtension(null);
        }
      }
    }

    initYjs();

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [
    roomId,
    userId,
    userName,
    userColor,
    wsUrl,
    initialContent,
    onContentChange,
  ]);

  return { collaborators, connectionStatus, yjsExtension, content };
}

// --- Main Component ---

export function CollaborativeEditor({
  roomId,
  userId,
  userName,
  content: initialContent,
  language,
  userColor,
  wsUrl = "ws://localhost:4001/yjs",
  onChange,
  onSave,
  readOnly = false,
}: CollaborativeEditorProps) {
  const resolvedColor = userColor ?? getColorForUser(userId);

  const { collaborators, connectionStatus, yjsExtension, content } =
    useYjsCollaboration(
      roomId,
      userId,
      userName,
      resolvedColor,
      wsUrl,
      initialContent,
      onChange
    );

  const handleChange = useCallback(
    (newContent: string) => {
      onChange?.(newContent);
    },
    [onChange]
  );

  const handleSave = useCallback(
    (saveContent: string) => {
      onSave?.(saveContent);
    },
    [onSave]
  );

  // Determine file extension from language for CodeMirror
  const fileExtension = getExtensionFromLanguage(language);

  // Build extra extensions array (only include yjs extension if available)
  const extraExtensions = yjsExtension
    ? [yjsExtension as import("@codemirror/state").Extension]
    : [];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-border border-b bg-muted/50 px-3 py-1.5">
        <div className="flex items-center gap-3">
          <ConnectionStatusBadge status={connectionStatus} />
          <span className="text-muted-foreground/60 text-xs">{roomId}</span>
          {connectionStatus === "error" && (
            <span className="text-[10px] text-amber-400">
              (Fallback: local editing only)
            </span>
          )}
        </div>
        <CollaboratorAvatars collaborators={collaborators} />
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <CodeMirrorEditor
          extension={fileExtension}
          extraExtensions={extraExtensions}
          onChange={handleChange}
          onSave={handleSave}
          readOnly={readOnly}
          value={connectionStatus === "error" ? initialContent : content}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-border border-t bg-muted/50 px-3 py-1">
        <span className="text-[11px] text-muted-foreground">
          {readOnly ? "Read-only" : "Editing"} | {language}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {collaborators.length + 1} participant
          {collaborators.length > 0 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// --- Helpers ---

function getExtensionFromLanguage(language: string): string {
  const langMap: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    typescriptreact: "tsx",
    javascriptreact: "jsx",
    python: "py",
    json: "json",
    html: "html",
    css: "css",
    markdown: "md",
  };
  return langMap[language.toLowerCase()] ?? language;
}

export type { CollaborativeEditorProps, CollaboratorInfo, ConnectionStatus };
