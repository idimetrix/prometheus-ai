"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventLog } from "./event-log";
import {
  type PlaybackSpeed,
  ReplayEngine,
  type ReplayEvent,
} from "./replay-engine";
import { ReplayTimeline } from "./replay-timeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplayViewerProps {
  events: ReplayEvent[];
  sessionId: string;
}

type ActiveTab = "code" | "terminal" | "chat" | "changes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function chatBubbleClass(role: string): string {
  if (role === "agent") {
    return "mr-8 border-zinc-800 bg-zinc-900/50";
  }
  if (role === "system") {
    return "border-blue-500/20 bg-blue-500/5";
  }
  return "ml-8 border-violet-500/20 bg-violet-500/10";
}

function chatRoleBadgeClass(role: string): string {
  if (role === "agent") {
    return "bg-green-500/20 text-green-300";
  }
  if (role === "system") {
    return "bg-blue-500/20 text-blue-300";
  }
  return "bg-violet-500/20 text-violet-300";
}

function terminalLineClass(line: string): string {
  if (line.startsWith("[ERROR]") || line.startsWith("Error")) {
    return "text-red-400";
  }
  if (line.startsWith("[WARN]")) {
    return "text-yellow-400";
  }
  return "text-zinc-300";
}

function fileStatusClass(status: string): string {
  if (status === "created") {
    return "text-green-400";
  }
  if (status === "deleted") {
    return "text-red-400";
  }
  return "text-yellow-400";
}

function fileStatusLabel(status: string): string {
  if (status === "created") {
    return "+";
  }
  if (status === "deleted") {
    return "D";
  }
  return "M";
}

function diffLineClass(line: string): string {
  if (line.startsWith("+")) {
    return "bg-green-500/10 text-green-400";
  }
  if (line.startsWith("-")) {
    return "bg-red-500/10 text-red-400";
  }
  if (line.startsWith("@@")) {
    return "text-violet-400";
  }
  return "text-zinc-500";
}

// ---------------------------------------------------------------------------
// Keyboard handler (extracted to reduce cognitive complexity)
// ---------------------------------------------------------------------------

const REPLAY_SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8];

function createKeyboardHandler(
  engine: ReplayEngine,
  forceUpdate: React.Dispatch<React.SetStateAction<number>>
) {
  return (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (e.key) {
      case " ":
        e.preventDefault();
        if (engine.isPlaying) {
          engine.pause();
        } else {
          engine.play();
        }
        forceUpdate((n) => n + 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        engine.seekToEvent(
          Math.min(engine.events.length - 1, engine.currentIndex + 1)
        );
        forceUpdate((n) => n + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        engine.seekToEvent(Math.max(0, engine.currentIndex - 1));
        forceUpdate((n) => n + 1);
        break;
      case "+":
      case "=":
        handleSpeedIncrease(engine, forceUpdate);
        break;
      case "-":
      case "_":
        handleSpeedDecrease(engine, forceUpdate);
        break;
      default:
        break;
    }
  };
}

function handleSpeedIncrease(
  engine: ReplayEngine,
  forceUpdate: React.Dispatch<React.SetStateAction<number>>
) {
  const idx = REPLAY_SPEEDS.indexOf(engine.speed);
  if (idx < REPLAY_SPEEDS.length - 1) {
    const nextSpeed = REPLAY_SPEEDS[idx + 1];
    if (nextSpeed) {
      engine.setSpeed(nextSpeed);
    }
    forceUpdate((n) => n + 1);
  }
}

function handleSpeedDecrease(
  engine: ReplayEngine,
  forceUpdate: React.Dispatch<React.SetStateAction<number>>
) {
  const idx = REPLAY_SPEEDS.indexOf(engine.speed);
  if (idx > 0) {
    const prevSpeed = REPLAY_SPEEDS[idx - 1];
    if (prevSpeed) {
      engine.setSpeed(prevSpeed);
    }
    forceUpdate((n) => n + 1);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReplayViewer({ events, sessionId }: ReplayViewerProps) {
  const engineRef = useRef<ReplayEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, forceUpdate] = useState(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");
  const [showEventLog, setShowEventLog] = useState(true);

  // Initialize engine
  if (!engineRef.current) {
    engineRef.current = new ReplayEngine();
  }
  const engine = engineRef.current;

  // Load events on mount or when events change
  useEffect(() => {
    engine.load(events);
    return () => {
      engine.destroy();
    };
  }, [events, engine]);

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = engine.subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, [engine]);

  const state = engine.state;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyboardShortcut = createKeyboardHandler(engine, forceUpdate);

    const el = containerRef.current;
    if (el) {
      el.addEventListener("keydown", handleKeyboardShortcut);
      return () => el.removeEventListener("keydown", handleKeyboardShortcut);
    }
  }, [engine]);

  const handlePlayPause = useCallback(() => {
    if (engine.isPlaying) {
      engine.pause();
    } else {
      engine.play();
    }
    forceUpdate((n) => n + 1);
  }, [engine]);

  const handleSeek = useCallback(
    (index: number) => {
      engine.seekToEvent(index);
      forceUpdate((n) => n + 1);
    },
    [engine]
  );

  const handleSpeedChange = useCallback(
    (speed: PlaybackSpeed) => {
      engine.setSpeed(speed);
      forceUpdate((n) => n + 1);
    },
    [engine]
  );

  // Derive file changes as a list
  const fileChanges = useMemo(() => {
    return Array.from(state.files.entries()).map(([_path, fileState]) => ({
      ...fileState,
    }));
  }, [state.files]);

  const TAB_CONFIG: Array<{ id: ActiveTab; label: string; count: number }> = [
    { id: "chat", label: "Chat", count: state.chat.length },
    { id: "terminal", label: "Terminal", count: state.terminalLines.length },
    { id: "code", label: "Code", count: fileChanges.length },
    { id: "changes", label: "Changes", count: fileChanges.length },
  ];

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-600">
        No events to replay
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col bg-zinc-950"
      ref={containerRef}
      tabIndex={0}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-zinc-200">
            Session Replay
          </span>
          <span className="font-mono text-xs text-zinc-500">{sessionId}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`rounded px-2 py-1 text-[10px] transition-colors ${
              showEventLog
                ? "bg-violet-500/20 text-violet-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setShowEventLog((v) => !v)}
            type="button"
          >
            Event Log
          </button>
          <span className="text-[10px] text-zinc-600">
            Space=Play/Pause | Arrows=Step | +/-=Speed
          </span>
        </div>
      </div>

      {/* Timeline */}
      <ReplayTimeline
        events={events}
        isPlaying={engine.isPlaying}
        onPlayPause={handlePlayPause}
        onSeek={handleSeek}
        onSpeedChange={handleSpeedChange}
        speed={engine.speed}
        state={state}
      />

      {/* Main content area */}
      <div className="flex min-h-0 flex-1">
        {/* Left: Tabbed content panels */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex border-zinc-800 border-b">
            {TAB_CONFIG.map((tab) => (
              <button
                className={`px-4 py-2 text-xs transition-colors ${
                  activeTab === tab.id
                    ? "border-violet-500 border-b-2 text-violet-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto p-4">
            {activeTab === "chat" && (
              <div className="space-y-3">
                {state.chat.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
                    No chat messages at this point
                  </div>
                ) : (
                  state.chat.map((msg) => (
                    <div
                      className={`rounded-lg border p-3 ${chatBubbleClass(msg.role)}`}
                      key={msg.id}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${chatRoleBadgeClass(msg.role)}`}
                        >
                          {msg.role}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {formatTimestamp(msg.timestamp)}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-300 leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "terminal" && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs">
                {state.terminalLines.length === 0 ? (
                  <div className="text-zinc-600">No terminal output yet</div>
                ) : (
                  <div className="space-y-0.5">
                    {Array.from(state.terminalLines.entries()).map(
                      ([idx, line]) => (
                        <div
                          className={terminalLineClass(line)}
                          key={`terminal-${idx}`}
                        >
                          {line}
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === "code" && (
              <div className="space-y-3">
                {fileChanges.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
                    No file changes at this point
                  </div>
                ) : (
                  fileChanges.map((file) => (
                    <div
                      className="rounded-lg border border-zinc-800 bg-zinc-950"
                      key={file.path}
                    >
                      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-1.5">
                        <span
                          className={`font-medium text-[10px] ${fileStatusClass(file.status)}`}
                        >
                          {fileStatusLabel(file.status)}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {file.path}
                        </span>
                      </div>
                      <pre className="overflow-auto p-3 text-[11px] text-zinc-400 leading-relaxed">
                        {file.content || "(empty)"}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "changes" && (
              <div className="space-y-3">
                {fileChanges.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
                    No diffs at this point
                  </div>
                ) : (
                  fileChanges.map((file) => (
                    <div
                      className="rounded-lg border border-zinc-800 bg-zinc-950"
                      key={file.path}
                    >
                      <div className="border-zinc-800 border-b px-3 py-1.5">
                        <span className="font-mono text-[10px] text-zinc-400">
                          {file.path}
                        </span>
                      </div>
                      <pre className="overflow-auto p-3 text-[11px] leading-relaxed">
                        {Array.from(file.content.split("\n").entries()).map(
                          ([lineIdx, line]) => (
                            <div
                              className={diffLineClass(line)}
                              key={`${file.path}-${lineIdx}`}
                            >
                              {line}
                            </div>
                          )
                        )}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Event log sidebar */}
        {showEventLog && (
          <div className="w-80 shrink-0 border-zinc-800 border-l">
            <EventLog
              currentIndex={state.currentIndex}
              events={events}
              onSelectEvent={handleSeek}
            />
          </div>
        )}
      </div>
    </div>
  );
}
