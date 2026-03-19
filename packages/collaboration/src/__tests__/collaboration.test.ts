import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { getUserColor } from "../awareness";
import { type CursorPosition, CursorPresence } from "../cursor-presence";
import { VoiceChannel, type VoiceChannelConfig } from "../voice-channel";

const HEX_COLOR_RE = /^#[a-f0-9]{6}$/i;

// ---------- awareness.ts ----------

describe("getUserColor", () => {
  it("returns a hex color string", () => {
    const color = getUserColor(0);
    expect(color).toMatch(HEX_COLOR_RE);
  });

  it("wraps around the color palette", () => {
    const color0 = getUserColor(0);
    const color10 = getUserColor(10);
    expect(color0).toBe(color10);
  });

  it("returns different colors for adjacent IDs", () => {
    const color0 = getUserColor(0);
    const color1 = getUserColor(1);
    expect(color0).not.toBe(color1);
  });

  it("handles large client IDs", () => {
    const color = getUserColor(999_999);
    expect(color).toMatch(HEX_COLOR_RE);
  });
});

// ---------- CursorPresence ----------

describe("CursorPresence", () => {
  const pos: CursorPosition = {
    filePath: "/src/index.ts",
    line: 10,
    column: 5,
  };
  const pos2: CursorPosition = { filePath: "/src/app.ts", line: 1, column: 1 };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with no cursors", () => {
    const cp = new CursorPresence();
    expect(cp.getAll()).toEqual([]);
  });

  it("adds a user cursor via setPosition", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    const cursors = cp.getAll();
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.userId).toBe("user-1");
    expect(cursors[0]?.userName).toBe("Alice");
    expect(cursors[0]?.position).toEqual(pos);
    expect(cursors[0]?.isAgent).toBe(false);
  });

  it("adds an agent cursor when isAgent is true", () => {
    const cp = new CursorPresence();
    cp.setPosition("agent-1", "CodeBot", pos, true);
    const cursors = cp.getAll();
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.isAgent).toBe(true);
  });

  it("updates an existing cursor position", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    cp.setPosition("user-1", "Alice", pos2);
    const cursors = cp.getAll();
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.position).toEqual(pos2);
  });

  it("preserves color when updating position for the same user", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    const colorBefore = cp.getAll()[0]?.color;
    cp.setPosition("user-1", "Alice", pos2);
    const colorAfter = cp.getAll()[0]?.color;
    expect(colorBefore).toBe(colorAfter);
  });

  it("removes a cursor by userId", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    cp.setPosition("user-2", "Bob", pos2);
    cp.remove("user-1");
    const cursors = cp.getAll();
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.userId).toBe("user-2");
  });

  it("remove does nothing for unknown userId", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    cp.remove("unknown");
    expect(cp.getAll()).toHaveLength(1);
  });

  it("getByFile returns cursors for a specific file", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    cp.setPosition("user-2", "Bob", pos2);
    cp.setPosition("user-3", "Charlie", { ...pos, line: 20 });
    const cursors = cp.getByFile("/src/index.ts");
    expect(cursors).toHaveLength(2);
  });

  it("getByFile returns empty array when no cursors in file", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    expect(cp.getByFile("/nonexistent.ts")).toEqual([]);
  });

  it("getAgentCursors returns only agent cursors", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos, false);
    cp.setPosition("agent-1", "Bot", pos2, true);
    const agents = cp.getAgentCursors();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.isAgent).toBe(true);
  });

  it("getUserCursors returns only human cursors", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos, false);
    cp.setPosition("agent-1", "Bot", pos2, true);
    const users = cp.getUserCursors();
    expect(users).toHaveLength(1);
    expect(users[0]?.isAgent).toBe(false);
  });

  it("pruneStale removes cursors older than timeout", () => {
    const cp = new CursorPresence();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1000) // setPosition for user-1
      .mockReturnValueOnce(90_000) // setPosition for user-2
      .mockReturnValueOnce(90_000); // pruneStale call
    cp.setPosition("user-1", "Alice", pos);
    cp.setPosition("user-2", "Bob", pos2);
    cp.pruneStale(60_000);
    const cursors = cp.getAll();
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.userId).toBe("user-2");
  });

  it("pruneStale does nothing when all cursors are fresh", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    cp.pruneStale(60_000);
    expect(cp.getAll()).toHaveLength(1);
  });

  it("onChange notifies listeners on setPosition", () => {
    const cp = new CursorPresence();
    const listener = vi.fn();
    cp.onChange(listener);
    cp.setPosition("user-1", "Alice", pos);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ userId: "user-1" })])
    );
  });

  it("onChange notifies listeners on remove", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos);
    const listener = vi.fn();
    cp.onChange(listener);
    cp.remove("user-1");
    expect(listener).toHaveBeenCalledWith([]);
  });

  it("unsubscribe stops notifications", () => {
    const cp = new CursorPresence();
    const listener = vi.fn();
    const unsub = cp.onChange(listener);
    unsub();
    cp.setPosition("user-1", "Alice", pos);
    expect(listener).not.toHaveBeenCalled();
  });

  it("dispose clears all state and listeners", () => {
    const cp = new CursorPresence();
    const listener = vi.fn();
    cp.onChange(listener);
    cp.setPosition("user-1", "Alice", pos);
    listener.mockClear();
    cp.dispose();
    expect(cp.getAll()).toEqual([]);
    // After dispose, adding a position should not trigger old listener
    cp.setPosition("user-2", "Bob", pos);
    expect(listener).not.toHaveBeenCalled();
  });

  it("assigns different colors for agents vs users", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", pos, false);
    cp.setPosition("agent-1", "Bot", pos2, true);
    const userColor = cp.getAll().find((c) => !c.isAgent)?.color;
    const agentColor = cp.getAll().find((c) => c.isAgent)?.color;
    expect(userColor).toBeDefined();
    expect(agentColor).toBeDefined();
    // Agent and user colors come from different palettes, so they should differ
    expect(userColor).not.toBe(agentColor);
  });

  it("handles null position (user not in any file)", () => {
    const cp = new CursorPresence();
    cp.setPosition("user-1", "Alice", null);
    const cursors = cp.getAll();
    expect(cursors[0]?.position).toBeNull();
    expect(cp.getByFile("/any.ts")).toEqual([]);
  });
});

// ---------- VoiceChannel ----------

describe("VoiceChannel", () => {
  const config: VoiceChannelConfig = {
    roomId: "room-1",
    displayName: "Alice",
    iceServers: [{ urls: "stun:stun.example.com" }],
  };

  it("starts in disconnected state", () => {
    const vc = new VoiceChannel();
    expect(vc.getState()).toBe("disconnected");
  });

  it("join without config returns false", () => {
    const vc = new VoiceChannel();
    const result = vc.join();
    expect(result).toBe(false);
    expect(vc.getState()).toBe("disconnected");
  });

  it("join with config returns true and transitions to connected", () => {
    const vc = new VoiceChannel();
    const result = vc.join(config);
    expect(result).toBe(true);
    expect(vc.getState()).toBe("connected");
  });

  it("join when already connected returns true", () => {
    const vc = new VoiceChannel(config);
    vc.join();
    const result = vc.join();
    expect(result).toBe(true);
    expect(vc.getState()).toBe("connected");
  });

  it("leave transitions to disconnected", () => {
    const vc = new VoiceChannel(config);
    vc.join();
    vc.leave();
    expect(vc.getState()).toBe("disconnected");
  });

  it("leave when already disconnected is a no-op", () => {
    const vc = new VoiceChannel(config);
    vc.leave();
    expect(vc.getState()).toBe("disconnected");
  });

  it("mute when not connected does nothing", () => {
    const vc = new VoiceChannel(config);
    expect(() => vc.mute()).not.toThrow();
  });

  it("mute when connected does not throw", () => {
    const vc = new VoiceChannel(config);
    vc.join();
    expect(() => vc.mute()).not.toThrow();
  });

  it("unmute when not connected does nothing", () => {
    const vc = new VoiceChannel(config);
    expect(() => vc.unmute()).not.toThrow();
  });

  it("unmute when connected does not throw", () => {
    const vc = new VoiceChannel(config);
    vc.join();
    expect(() => vc.unmute()).not.toThrow();
  });

  it("getParticipants returns empty array for stub", () => {
    const vc = new VoiceChannel(config);
    vc.join();
    expect(vc.getParticipants()).toEqual([]);
  });

  it("getParticipants returns empty when not configured", () => {
    const vc = new VoiceChannel();
    expect(vc.getParticipants()).toEqual([]);
  });

  it("on/off registers and removes listeners", () => {
    const vc = new VoiceChannel(config);
    const listener = vi.fn();
    vc.on("stateChange", listener);
    vc.join();
    // join emits stateChange twice: connecting -> connected
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith("connecting");
    expect(listener).toHaveBeenCalledWith("connected");
  });

  it("off removes a specific listener", () => {
    const vc = new VoiceChannel(config);
    const listener = vi.fn();
    vc.on("stateChange", listener);
    vc.off("stateChange", listener);
    vc.join();
    expect(listener).not.toHaveBeenCalled();
  });

  it("leave emits stateChange disconnected", () => {
    const vc = new VoiceChannel(config);
    vc.join();
    const listener = vi.fn();
    vc.on("stateChange", listener);
    vc.leave();
    expect(listener).toHaveBeenCalledWith("disconnected");
  });

  it("constructor with config marks as configured", () => {
    const vc = new VoiceChannel(config);
    // join without config should still work since constructor configured it
    const result = vc.join();
    expect(result).toBe(true);
  });
});
