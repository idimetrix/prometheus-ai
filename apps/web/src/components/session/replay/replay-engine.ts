/**
 * ReplayEngine - Manages playback state for session replay.
 *
 * Fetches session events, processes them sequentially, and reconstructs
 * file state, terminal output, and chat at any point in time.
 */

export type ReplayEventType =
  | "message"
  | "file_change"
  | "tool_call"
  | "terminal_output"
  | "agent_output"
  | "reasoning"
  | "approval"
  | "error"
  | "plan_update"
  | "task_status"
  | "checkpoint";

export interface ReplayEvent {
  agentRole?: string | null;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  type: ReplayEventType;
}

export type PlaybackSpeed = 1 | 2 | 4 | 8;

export interface FileState {
  content: string;
  path: string;
  status: "created" | "modified" | "deleted";
}

export interface ReplayState {
  chat: Array<{
    content: string;
    id: string;
    role: "user" | "agent" | "system";
    timestamp: string;
  }>;
  currentEvent: ReplayEvent | null;
  currentIndex: number;
  currentTimeMs: number;
  files: Map<string, FileState>;
  terminalLines: string[];
  totalDurationMs: number;
}

type PlaybackListener = (state: ReplayState) => void;

const AVAILABLE_SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8];

export class ReplayEngine {
  private _currentIndex = 0;
  private _events: ReplayEvent[] = [];
  private _isPaused = false;
  private _isPlaying = false;
  private readonly _listeners: Set<PlaybackListener> = new Set();
  private _speed: PlaybackSpeed = 1;
  private _state: ReplayState = {
    currentEvent: null,
    currentIndex: 0,
    currentTimeMs: 0,
    totalDurationMs: 0,
    files: new Map(),
    terminalLines: [],
    chat: [],
  };
  private _timer: ReturnType<typeof setTimeout> | null = null;

  get currentIndex(): number {
    return this._currentIndex;
  }

  get events(): ReplayEvent[] {
    return this._events;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get speed(): PlaybackSpeed {
    return this._speed;
  }

  get state(): ReplayState {
    return this._state;
  }

  /**
   * Load events for a session. Accepts pre-fetched events array.
   */
  load(events: ReplayEvent[]): void {
    this.stop();
    this._events = [...events].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    this._currentIndex = 0;
    this._state = this.buildStateAtIndex(0);
    this.notify();
  }

  /**
   * Start or resume playback at the current speed.
   */
  play(): void {
    if (this._events.length === 0) {
      return;
    }

    if (this._currentIndex >= this._events.length - 1) {
      this._currentIndex = 0;
      this._state = this.buildStateAtIndex(0);
    }

    this._isPlaying = true;
    this._isPaused = false;
    this.scheduleNext();
    this.notify();
  }

  /**
   * Pause playback.
   */
  pause(): void {
    this._isPlaying = false;
    this._isPaused = true;
    this.clearTimer();
    this.notify();
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop(): void {
    this._isPlaying = false;
    this._isPaused = false;
    this.clearTimer();
  }

  /**
   * Jump to a specific timestamp (in ms from session start).
   */
  seekTo(timestampMs: number): void {
    if (this._events.length === 0) {
      return;
    }

    const firstEvent = this._events[0];
    if (!firstEvent) {
      return;
    }
    const firstTs = new Date(firstEvent.timestamp).getTime();
    const targetTs = firstTs + timestampMs;

    let targetIndex = 0;
    for (let i = 0; i < this._events.length; i++) {
      const evt = this._events[i];
      if (!evt) {
        continue;
      }
      const evtTs = new Date(evt.timestamp).getTime();
      if (evtTs <= targetTs) {
        targetIndex = i;
      } else {
        break;
      }
    }

    this._currentIndex = targetIndex;
    this._state = this.buildStateAtIndex(targetIndex);
    this.notify();

    if (this._isPlaying) {
      this.clearTimer();
      this.scheduleNext();
    }
  }

  /**
   * Jump to a specific event by index.
   */
  seekToEvent(index: number): void {
    const clamped = Math.max(0, Math.min(index, this._events.length - 1));
    this._currentIndex = clamped;
    this._state = this.buildStateAtIndex(clamped);
    this.notify();

    if (this._isPlaying) {
      this.clearTimer();
      this.scheduleNext();
    }
  }

  /**
   * Change playback speed.
   */
  setSpeed(speed: PlaybackSpeed): void {
    if (!AVAILABLE_SPEEDS.includes(speed)) {
      return;
    }
    this._speed = speed;
    this.notify();

    if (this._isPlaying) {
      this.clearTimer();
      this.scheduleNext();
    }
  }

  /**
   * Reconstruct the full state at a given timestamp.
   */
  getStateAtTime(timestampMs: number): ReplayState {
    if (this._events.length === 0) {
      return this._state;
    }

    const firstEvent = this._events[0];
    if (!firstEvent) {
      return this._state;
    }
    const firstTs = new Date(firstEvent.timestamp).getTime();
    const targetTs = firstTs + timestampMs;

    let targetIndex = 0;
    for (let i = 0; i < this._events.length; i++) {
      const evt = this._events[i];
      if (!evt) {
        continue;
      }
      if (new Date(evt.timestamp).getTime() <= targetTs) {
        targetIndex = i;
      } else {
        break;
      }
    }

    return this.buildStateAtIndex(targetIndex);
  }

  /**
   * Subscribe to state changes.
   */
  subscribe(listener: PlaybackListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.stop();
    this._listeners.clear();
    this._events = [];
  }

  // ---- Private helpers ----

  private buildStateAtIndex(index: number): ReplayState {
    const files = new Map<string, FileState>();
    const terminalLines: string[] = [];
    const chat: ReplayState["chat"] = [];

    const eventsUpTo = this._events.slice(0, index + 1);
    const firstEvt = this._events[0];
    const lastEvt = this._events.at(-1);
    const firstTs = firstEvt ? new Date(firstEvt.timestamp).getTime() : 0;
    const lastTs = lastEvt ? new Date(lastEvt.timestamp).getTime() : 0;

    for (const event of eventsUpTo) {
      this.processEvent(event, files, terminalLines, chat);
    }

    const currentEvent = this._events[index] ?? null;
    const currentTimeMs = currentEvent
      ? new Date(currentEvent.timestamp).getTime() - firstTs
      : 0;

    return {
      currentEvent,
      currentIndex: index,
      currentTimeMs,
      totalDurationMs: lastTs - firstTs,
      files,
      terminalLines,
      chat,
    };
  }

  private processFileChange(
    event: ReplayEvent,
    files: Map<string, FileState>
  ): void {
    const path = String(event.data.filePath ?? event.data.path ?? "");
    if (path) {
      files.set(path, {
        path,
        content: String(event.data.content ?? event.data.diff ?? ""),
        status: (event.data.status as FileState["status"]) ?? "modified",
      });
    }
  }

  private processChatEvent(
    event: ReplayEvent,
    chat: ReplayState["chat"]
  ): void {
    if (event.type === "error") {
      const message = String(event.data.message ?? event.data.error ?? "");
      if (message) {
        chat.push({
          id: event.id,
          role: "system",
          content: `Error: ${message}`,
          timestamp: event.timestamp,
        });
      }
      return;
    }
    if (event.type === "task_status") {
      const status = String(event.data.status ?? "");
      if (status) {
        chat.push({
          id: event.id,
          role: "system",
          content: `Status changed to: ${status}`,
          timestamp: event.timestamp,
        });
      }
      return;
    }
    const content = String(event.data.content ?? event.data.message ?? "");
    if (content) {
      chat.push({
        id: event.id,
        role: event.type === "agent_output" ? "agent" : "user",
        content,
        timestamp: event.timestamp,
      });
    }
  }

  private processEvent(
    event: ReplayEvent,
    files: Map<string, FileState>,
    terminalLines: string[],
    chat: ReplayState["chat"]
  ): void {
    switch (event.type) {
      case "file_change":
        this.processFileChange(event, files);
        break;
      case "terminal_output": {
        const output = String(event.data.content ?? event.data.output ?? "");
        if (output) {
          terminalLines.push(output);
        }
        break;
      }
      case "agent_output":
      case "message":
      case "error":
      case "task_status":
        this.processChatEvent(event, chat);
        break;
      default:
        break;
    }
  }

  private scheduleNext(): void {
    if (!this._isPlaying || this._currentIndex >= this._events.length - 1) {
      if (this._currentIndex >= this._events.length - 1) {
        this._isPlaying = false;
        this._isPaused = false;
        this.notify();
      }
      return;
    }

    const currentEvent = this._events[this._currentIndex];
    const nextEvent = this._events[this._currentIndex + 1];
    if (!(currentEvent && nextEvent)) {
      return;
    }
    const currentTs = new Date(currentEvent.timestamp).getTime();
    const nextTs = new Date(nextEvent.timestamp).getTime();
    const realDelay = nextTs - currentTs;
    const delay = Math.max(50, Math.min(3000, realDelay) / this._speed);

    this._timer = setTimeout(() => {
      this._currentIndex += 1;
      this._state = this.buildStateAtIndex(this._currentIndex);
      this.notify();
      this.scheduleNext();
    }, delay);
  }

  private clearTimer(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private notify(): void {
    for (const listener of this._listeners) {
      listener(this._state);
    }
  }
}
