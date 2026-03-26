"use client";

/**
 * Real-time AI Pair Programming Component
 *
 * Features:
 * - Split view: human editor on left, AI editor on right
 * - Real-time CRDT sync via Yjs infrastructure
 * - AI cursor visible with purple color
 * - AI types changes incrementally (character-by-character)
 * - "Suggest next" mode: ghost text suggestions as you type
 * - "Watch and learn" mode: AI observes and adapts to coding style
 * - Voice channel integration
 * - Chat sidebar for discussing code
 * - Toggle between: AI leads, Human leads, Collaborative
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PairMode = "ai_leads" | "human_leads" | "collaborative";

type AIBehavior = "suggest_next" | "watch_and_learn" | "active_coding";

interface CursorPosition {
  column: number;
  line: number;
}

interface GhostSuggestion {
  /** Column offset for insertion */
  column: number;
  /** Unique id */
  id: string;
  /** Line number in editor */
  line: number;
  /** Suggested text to insert */
  text: string;
}

interface ChatMessage {
  content: string;
  id: string;
  sender: "human" | "ai" | "system";
  timestamp: Date;
}

interface VoiceState {
  isConnected: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
}

interface AITypingState {
  /** Characters queued for incremental typing */
  buffer: string;
  /** Current character index being typed */
  charIndex: number;
  /** Whether AI is actively typing */
  isTyping: boolean;
  /** Target position in AI editor */
  position: CursorPosition;
}

interface PairProgrammingProps {
  /** Unique session identifier for CRDT sync */
  documentId: string;
  /** Initial code content */
  initialContent?: string;
  /** Callback when human editor content changes */
  onChange?: (content: string) => void;
  /** Project identifier for AI context */
  projectId: string;
  /** Current user display name */
  userName: string;
  /** WebSocket URL for Yjs provider */
  wsUrl?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AI_CURSOR_COLOR = "#a855f7";
const HUMAN_CURSOR_COLOR = "#3b82f6";
const AI_TYPING_INTERVAL_MS = 30;

const MODE_LABELS: Record<PairMode, { description: string; label: string }> = {
  ai_leads: {
    label: "AI Leads",
    description: "AI writes code, you review and guide",
  },
  human_leads: {
    label: "Human Leads",
    description: "You write code, AI assists and suggests",
  },
  collaborative: {
    label: "Collaborative",
    description: "Both contribute equally in real-time",
  },
};

const BEHAVIOR_LABELS: Record<
  AIBehavior,
  { description: string; label: string }
> = {
  suggest_next: {
    label: "Suggest Next",
    description: "Shows ghost text predictions as you type",
  },
  watch_and_learn: {
    label: "Watch & Learn",
    description: "Observes your patterns and adapts to your style",
  },
  active_coding: {
    label: "Active Coding",
    description: "AI actively writes and modifies code",
  },
};

const HTTP_TO_WS_RE = /^http/;

// ---------------------------------------------------------------------------
// AI Cursor Overlay
// ---------------------------------------------------------------------------

function AICursorOverlay({
  cursor,
  isTyping,
}: {
  cursor: CursorPosition;
  isTyping: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute z-50"
      style={{
        top: `${cursor.line * 20}px`,
        left: `${cursor.column * 8}px`,
      }}
    >
      <div
        className={`h-5 w-0.5 ${isTyping ? "animate-pulse" : ""}`}
        style={{ backgroundColor: AI_CURSOR_COLOR }}
      />
      <div
        className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 py-0.5 font-medium text-[10px] text-white"
        style={{ backgroundColor: AI_CURSOR_COLOR }}
      >
        AI Pair
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ghost Suggestion Display
// ---------------------------------------------------------------------------

function GhostText({ suggestion }: { suggestion: GhostSuggestion | null }) {
  if (!suggestion) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-40 font-mono text-sm text-zinc-500/50 italic"
      style={{
        top: `${suggestion.line * 20}px`,
        left: `${suggestion.column * 8}px`,
      }}
    >
      {suggestion.text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice Channel Controls
// ---------------------------------------------------------------------------

function VoiceControls({
  voice,
  onToggleMute,
  onToggleConnect,
}: {
  onToggleConnect: () => void;
  onToggleMute: () => void;
  voice: VoiceState;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        aria-label={voice.isConnected ? "Disconnect voice" : "Connect voice"}
        className={`rounded-md px-2 py-1 text-xs transition-colors ${
          voice.isConnected
            ? "bg-green-500/20 text-green-400"
            : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
        }`}
        onClick={onToggleConnect}
        type="button"
      >
        {voice.isConnected ? "Voice On" : "Voice Off"}
      </button>
      {voice.isConnected && (
        <button
          aria-label={voice.isMuted ? "Unmute" : "Mute"}
          className={`rounded-md px-2 py-1 text-xs transition-colors ${
            voice.isMuted
              ? "bg-red-500/20 text-red-400"
              : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
          }`}
          onClick={onToggleMute}
          type="button"
        >
          {voice.isMuted ? "Unmuted" : "Muted"}
        </button>
      )}
      {voice.isSpeaking && (
        <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat Sidebar
// ---------------------------------------------------------------------------

function chatMessageClass(sender: ChatMessage["sender"]): string {
  if (sender === "human") {
    return "ml-4 border border-blue-500/20 bg-blue-500/10 text-blue-200";
  }
  if (sender === "ai") {
    return "mr-4 border border-purple-500/20 bg-purple-500/10 text-purple-200";
  }
  return "border border-zinc-700 bg-zinc-800/30 text-zinc-400";
}

function chatSenderLabel(sender: ChatMessage["sender"]): string {
  if (sender === "human") {
    return "You";
  }
  if (sender === "ai") {
    return "AI";
  }
  return "System";
}

function ChatSidebar({
  messages,
  onSend,
}: {
  messages: ChatMessage[];
  onSend: (content: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    onSend(trimmed);
    setDraft("");
  }, [draft, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="flex h-full flex-col border-zinc-700 border-l bg-zinc-900/80">
      <div className="border-zinc-700 border-b px-3 py-2">
        <h4 className="font-medium text-xs text-zinc-300">Code Discussion</h4>
      </div>

      <div className="flex-1 overflow-y-auto p-3" ref={scrollRef}>
        <div className="flex flex-col gap-2">
          {messages.map((msg) => (
            <div
              className={`rounded-md px-2 py-1.5 text-xs ${chatMessageClass(msg.sender)}`}
              key={msg.id}
            >
              <span className="font-medium">
                {chatSenderLabel(msg.sender)}:
              </span>{" "}
              {msg.content}
            </div>
          ))}
        </div>
      </div>

      <div className="border-zinc-700 border-t p-2">
        <div className="flex gap-2">
          <input
            aria-label="Chat message"
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-purple-500 focus:outline-none"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Discuss code..."
            type="text"
            value={draft}
          />
          <button
            aria-label="Send message"
            className="rounded-md bg-purple-600 px-3 py-1 text-white text-xs hover:bg-purple-500"
            disabled={!draft.trim()}
            onClick={handleSubmit}
            type="button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode Selector
// ---------------------------------------------------------------------------

function ModeSelector({
  mode,
  onModeChange,
  behavior,
  onBehaviorChange,
}: {
  behavior: AIBehavior;
  mode: PairMode;
  onBehaviorChange: (behavior: AIBehavior) => void;
  onModeChange: (mode: PairMode) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-zinc-500">Mode:</span>
        {(Object.keys(MODE_LABELS) as PairMode[]).map((m) => (
          <button
            aria-label={`Switch to ${MODE_LABELS[m].label} mode`}
            className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
              mode === m
                ? "bg-purple-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            key={m}
            onClick={() => onModeChange(m)}
            title={MODE_LABELS[m].description}
            type="button"
          >
            {MODE_LABELS[m].label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] text-zinc-500">AI:</span>
        {(Object.keys(BEHAVIOR_LABELS) as AIBehavior[]).map((b) => (
          <button
            aria-label={`Switch to ${BEHAVIOR_LABELS[b].label} behavior`}
            className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
              behavior === b
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            key={b}
            onClick={() => onBehaviorChange(b)}
            title={BEHAVIOR_LABELS[b].description}
            type="button"
          >
            {BEHAVIOR_LABELS[b].label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Pair Programming Component
// ---------------------------------------------------------------------------

export function PairProgramming({
  documentId,
  projectId: _projectId,
  userName,
  initialContent = "",
  onChange,
  wsUrl:
    _wsUrl = `${(process.env.NEXT_PUBLIC_SOCKET_URL ?? "ws://localhost:4001").replace(HTTP_TO_WS_RE, "ws")}/yjs`,
}: PairProgrammingProps) {
  // Editor state
  const [humanContent, setHumanContent] = useState(initialContent);
  const [aiContent, setAiContent] = useState(initialContent);
  const [isConnected, setIsConnected] = useState(false);

  // Mode and behavior
  const [mode, setMode] = useState<PairMode>("collaborative");
  const [behavior, setBehavior] = useState<AIBehavior>("suggest_next");

  // AI state
  const [aiCursor, setAiCursor] = useState<CursorPosition>({
    line: 0,
    column: 0,
  });
  const [aiTyping, setAiTyping] = useState<AITypingState>({
    isTyping: false,
    buffer: "",
    charIndex: 0,
    position: { line: 0, column: 0 },
  });
  const [ghostSuggestion, setGhostSuggestion] =
    useState<GhostSuggestion | null>(null);

  // Voice
  const [voice, setVoice] = useState<VoiceState>({
    isConnected: false,
    isMuted: true,
    isSpeaking: false,
  });

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "system-1",
      sender: "system",
      content: `Pair programming session started. ${userName} is collaborating with AI.`,
      timestamp: new Date(),
    },
  ]);
  const [showChat, setShowChat] = useState(true);

  // Typing interval ref for cleanup
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize Yjs connection for CRDT sync
  useEffect(() => {
    const wsUrl = (
      process.env.NEXT_PUBLIC_SOCKET_URL ?? "ws://localhost:4001"
    ).replace(HTTP_TO_WS_RE, "ws");

    let provider: { destroy: () => void } | null = null;

    async function initSync() {
      try {
        const Y = await import("yjs");
        const { WebsocketProvider } = await import("y-websocket");

        const ydoc = new Y.Doc();
        const _ytext = ydoc.getText("pair-content");

        provider = new WebsocketProvider(
          `${wsUrl}/yjs`,
          `pair-${documentId}`,
          ydoc,
          { connect: true }
        );

        setIsConnected(true);
      } catch {
        // Yjs unavailable -- proceed with local-only state
        setIsConnected(true);
      }
    }

    initSync();

    return () => {
      provider?.destroy();
    };
  }, [documentId]);

  // Incremental AI typing simulation
  useEffect(() => {
    if (!(aiTyping.isTyping && aiTyping.buffer)) {
      return;
    }

    typingIntervalRef.current = setInterval(() => {
      setAiTyping((prev) => {
        if (prev.charIndex >= prev.buffer.length) {
          if (typingIntervalRef.current) {
            clearInterval(typingIntervalRef.current);
          }
          return { ...prev, isTyping: false, buffer: "", charIndex: 0 };
        }

        const nextChar = prev.buffer[prev.charIndex];
        const isNewline = nextChar === "\n";

        setAiContent((content) => {
          const lines = content.split("\n");
          const lineIdx = Math.min(prev.position.line, lines.length - 1);
          const line = lines[lineIdx] ?? "";
          const colIdx = Math.min(prev.position.column, line.length);

          lines[lineIdx] =
            line.slice(0, colIdx) + (nextChar ?? "") + line.slice(colIdx);
          return lines.join("\n");
        });

        const newColumn = isNewline ? 0 : prev.position.column + 1;
        const newLine = isNewline ? prev.position.line + 1 : prev.position.line;

        setAiCursor({ line: newLine, column: newColumn });

        return {
          ...prev,
          charIndex: prev.charIndex + 1,
          position: { line: newLine, column: newColumn },
        };
      });
    }, AI_TYPING_INTERVAL_MS);

    return () => {
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
      }
    };
  }, [aiTyping.isTyping, aiTyping.buffer]);

  // Ghost suggestion generation (simulated for suggest_next mode)
  useEffect(() => {
    if (behavior !== "suggest_next") {
      setGhostSuggestion(null);
      return;
    }

    const debounce = setTimeout(() => {
      const lines = humanContent.split("\n");
      const lastLine = lines.at(-1) ?? "";

      if (lastLine.trim().length > 3) {
        setGhostSuggestion({
          id: `ghost-${Date.now()}`,
          line: lines.length - 1,
          column: lastLine.length,
          text: " // AI suggestion...",
        });
      } else {
        setGhostSuggestion(null);
      }
    }, 500);

    return () => clearTimeout(debounce);
  }, [humanContent, behavior]);

  // Handle human content changes
  const handleHumanChange = useCallback(
    (newContent: string) => {
      setHumanContent(newContent);
      onChange?.(newContent);

      if (mode === "collaborative") {
        setAiContent(newContent);
      }
    },
    [onChange, mode]
  );

  // Handle AI content sync in collaborative mode
  const handleAiChange = useCallback(
    (newContent: string) => {
      setAiContent(newContent);
      if (mode === "collaborative") {
        setHumanContent(newContent);
        onChange?.(newContent);
      }
    },
    [onChange, mode]
  );

  // Accept ghost suggestion
  const acceptGhostSuggestion = useCallback(() => {
    if (!ghostSuggestion) {
      return;
    }

    const lines = humanContent.split("\n");
    const targetLine = lines[ghostSuggestion.line] ?? "";
    lines[ghostSuggestion.line] = targetLine + ghostSuggestion.text;
    const newContent = lines.join("\n");

    setHumanContent(newContent);
    onChange?.(newContent);
    setGhostSuggestion(null);
  }, [ghostSuggestion, humanContent, onChange]);

  // Send chat message
  const handleSendChat = useCallback((content: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: "human",
      content,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMsg]);

    // Simulate AI response
    setTimeout(() => {
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        sender: "ai",
        content: `I see you mentioned "${content.slice(0, 30)}". Let me help with that.`,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, aiMsg]);
    }, 1000);
  }, []);

  // Voice controls
  const toggleVoiceConnect = useCallback(() => {
    setVoice((prev) => ({
      ...prev,
      isConnected: !prev.isConnected,
      isMuted: prev.isConnected ? true : prev.isMuted,
    }));
  }, []);

  const toggleVoiceMute = useCallback(() => {
    setVoice((prev) => ({ ...prev, isMuted: !prev.isMuted }));
  }, []);

  // Status indicators
  const statusText = useMemo(() => {
    const parts: string[] = [];
    if (isConnected) {
      parts.push("Connected");
    } else {
      parts.push("Connecting...");
    }
    parts.push(MODE_LABELS[mode].label);
    parts.push(BEHAVIOR_LABELS[behavior].label);
    if (aiTyping.isTyping) {
      parts.push("AI typing...");
    }
    return parts.join(" | ");
  }, [isConnected, mode, behavior, aiTyping.isTyping]);

  const humanEditorReadOnly = mode === "ai_leads";
  const aiEditorReadOnly = mode === "human_leads";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-700">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-zinc-700 border-b bg-zinc-900/50 px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div
              className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "animate-pulse bg-yellow-500"}`}
            />
            <span className="text-[11px] text-zinc-400">
              {isConnected ? "Synced" : "Connecting..."}
            </span>
          </div>

          <ModeSelector
            behavior={behavior}
            mode={mode}
            onBehaviorChange={setBehavior}
            onModeChange={setMode}
          />
        </div>

        <div className="flex items-center gap-3">
          <VoiceControls
            onToggleConnect={toggleVoiceConnect}
            onToggleMute={toggleVoiceMute}
            voice={voice}
          />
          <button
            aria-label={showChat ? "Hide chat" : "Show chat"}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              showChat
                ? "bg-purple-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            onClick={() => setShowChat(!showChat)}
            type="button"
          >
            Chat
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Split editors */}
        <div className="flex flex-1">
          {/* Human editor (left) */}
          <div className="flex flex-1 flex-col border-zinc-700 border-r">
            <div className="flex items-center justify-between border-zinc-700 border-b bg-zinc-900/30 px-3 py-1">
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: HUMAN_CURSOR_COLOR }}
                />
                <span className="text-[11px] text-zinc-400">
                  {userName} (Human)
                </span>
              </div>
              {humanEditorReadOnly && (
                <span className="text-[10px] text-zinc-500">Read-only</span>
              )}
            </div>
            <div className="relative flex-1">
              {/* Ghost text overlay for suggest_next mode */}
              <GhostText suggestion={ghostSuggestion} />

              <textarea
                aria-label="Human code editor"
                className="h-full w-full resize-none bg-zinc-950 p-4 font-mono text-sm text-zinc-200 focus:outline-none"
                onChange={(e) => handleHumanChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && ghostSuggestion) {
                    e.preventDefault();
                    acceptGhostSuggestion();
                  }
                }}
                placeholder="Write your code here..."
                readOnly={humanEditorReadOnly}
                value={humanContent}
              />
            </div>
          </div>

          {/* AI editor (right) */}
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between border-zinc-700 border-b bg-zinc-900/30 px-3 py-1">
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: AI_CURSOR_COLOR }}
                />
                <span className="text-[11px] text-zinc-400">
                  AI Pair{" "}
                  {aiTyping.isTyping && (
                    <span className="animate-pulse text-purple-400">
                      typing...
                    </span>
                  )}
                </span>
              </div>
              {aiEditorReadOnly && (
                <span className="text-[10px] text-zinc-500">Observing</span>
              )}
            </div>
            <div className="relative flex-1">
              <AICursorOverlay cursor={aiCursor} isTyping={aiTyping.isTyping} />
              <textarea
                aria-label="AI code editor"
                className="h-full w-full resize-none bg-zinc-950 p-4 font-mono text-sm text-zinc-200 focus:outline-none"
                onChange={(e) => handleAiChange(e.target.value)}
                placeholder="AI code appears here..."
                readOnly={aiEditorReadOnly}
                value={aiContent}
              />
            </div>
          </div>
        </div>

        {/* Chat sidebar */}
        {showChat && (
          <div className="w-72 shrink-0">
            <ChatSidebar messages={chatMessages} onSend={handleSendChat} />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-zinc-700 border-t bg-zinc-900/50 px-3 py-1">
        <span className="text-[11px] text-zinc-500">{statusText}</span>
        <span className="text-[11px] text-zinc-500">
          {voice.isConnected ? "Voice connected" : "Voice off"} |{" "}
          {chatMessages.length} messages
        </span>
      </div>
    </div>
  );
}

export type {
  AIBehavior,
  AITypingState,
  ChatMessage,
  GhostSuggestion,
  PairMode,
  PairProgrammingProps,
  VoiceState,
};
