/**
 * WebRTC Voice Channel stub for real-time voice collaboration.
 *
 * This module provides the interface and a stub implementation
 * for WebRTC-based voice channels. When WebRTC is not configured,
 * all methods log a warning and return gracefully.
 */

export interface VoiceChannelConfig {
  /** Display name of the local participant */
  displayName: string;
  /** ICE/TURN server URLs for NAT traversal */
  iceServers: RTCIceServerConfig[];
  /** Optional: max participants allowed (default: 10) */
  maxParticipants?: number;
  /** Unique identifier for the voice channel room */
  roomId: string;
  /** Optional: whether to start muted (default: true) */
  startMuted?: boolean;
}

export interface RTCIceServerConfig {
  credential?: string;
  urls: string | string[];
  username?: string;
}

export interface VoiceParticipant {
  displayName: string;
  id: string;
  isMuted: boolean;
  isSpeaking: boolean;
  joinedAt: Date;
}

export type VoiceChannelState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface VoiceChannelEventMap {
  error: Error;
  participantJoined: VoiceParticipant;
  participantLeft: VoiceParticipant;
  participantMuted: VoiceParticipant;
  participantSpeaking: VoiceParticipant;
  stateChange: VoiceChannelState;
}

export type VoiceChannelListener<T> = (data: T) => void;

export class VoiceChannel {
  private config: VoiceChannelConfig | null = null;
  private state: VoiceChannelState = "disconnected";
  private readonly listeners = new Map<
    string,
    Set<VoiceChannelListener<unknown>>
  >();
  private configured = false;

  constructor(config?: VoiceChannelConfig) {
    if (config) {
      this.config = config;
      this.configured = true;
    }
  }

  /**
   * Join the voice channel. If WebRTC is not configured, logs a
   * warning and returns without establishing a connection.
   */
  join(config?: VoiceChannelConfig): boolean {
    if (config) {
      this.config = config;
      this.configured = true;
    }

    if (!(this.configured && this.config)) {
      console.warn(
        "[VoiceChannel] WebRTC not configured — call join() with a VoiceChannelConfig"
      );
      return false;
    }

    if (this.state === "connected") {
      console.warn("[VoiceChannel] Already connected to voice channel");
      return true;
    }

    console.warn(
      "[VoiceChannel] WebRTC not configured — voice channel join is a no-op stub"
    );
    this.state = "connecting";
    this.emit("stateChange", "connecting");

    // Stub: in a real implementation, this would set up RTCPeerConnection,
    // negotiate SDP, and establish media streams.
    this.state = "connected";
    this.emit("stateChange", "connected");

    return true;
  }

  /**
   * Leave the voice channel and clean up resources.
   */
  leave(): void {
    if (this.state === "disconnected") {
      return;
    }

    if (!this.configured) {
      console.warn(
        "[VoiceChannel] WebRTC not configured — leave is a no-op stub"
      );
      return;
    }

    console.warn(
      "[VoiceChannel] WebRTC not configured — voice channel leave is a no-op stub"
    );
    this.state = "disconnected";
    this.emit("stateChange", "disconnected");
  }

  /**
   * Mute the local participant's microphone.
   */
  mute(): void {
    if (!this.configured) {
      console.warn(
        "[VoiceChannel] WebRTC not configured — mute is a no-op stub"
      );
      return;
    }

    if (this.state !== "connected") {
      console.warn(
        "[VoiceChannel] Cannot mute — not connected to a voice channel"
      );
      return;
    }

    // Stub: in a real implementation, this would disable the audio track
    console.warn("[VoiceChannel] WebRTC not configured — mute is a no-op stub");
  }

  /**
   * Unmute the local participant's microphone.
   */
  unmute(): void {
    if (!this.configured) {
      console.warn(
        "[VoiceChannel] WebRTC not configured — unmute is a no-op stub"
      );
      return;
    }

    if (this.state !== "connected") {
      console.warn(
        "[VoiceChannel] Cannot unmute — not connected to a voice channel"
      );
      return;
    }

    // Stub: in a real implementation, this would enable the audio track
    console.warn(
      "[VoiceChannel] WebRTC not configured — unmute is a no-op stub"
    );
  }

  /**
   * Get the list of participants currently in the voice channel.
   */
  getParticipants(): VoiceParticipant[] {
    if (!this.configured) {
      console.warn(
        "[VoiceChannel] WebRTC not configured — returning empty participants list"
      );
      return [];
    }

    // Stub: in a real implementation, this would return the current participant list
    // from the signaling server / peer connection state
    return [];
  }

  /**
   * Get the current state of the voice channel connection.
   */
  getState(): VoiceChannelState {
    return this.state;
  }

  /**
   * Register an event listener for voice channel events.
   */
  on<K extends keyof VoiceChannelEventMap>(
    event: K,
    listener: VoiceChannelListener<VoiceChannelEventMap[K]>
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener as VoiceChannelListener<unknown>);
  }

  /**
   * Remove an event listener.
   */
  off<K extends keyof VoiceChannelEventMap>(
    event: K,
    listener: VoiceChannelListener<VoiceChannelEventMap[K]>
  ): void {
    this.listeners
      .get(event)
      ?.delete(listener as VoiceChannelListener<unknown>);
  }

  private emit<K extends keyof VoiceChannelEventMap>(
    event: K,
    data: VoiceChannelEventMap[K]
  ): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        listener(data);
      }
    }
  }
}
