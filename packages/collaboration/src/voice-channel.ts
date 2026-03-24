/**
 * Voice Channel for real-time voice collaboration.
 *
 * Provides voice presence tracking (join/leave/mute/unmute) by publishing
 * events through a pluggable signaling transport (WebSocket / Redis pub-sub).
 *
 * Audio capture uses the browser MediaRecorder API when available, streaming
 * recorded chunks to a configurable transcription endpoint for async processing.
 *
 * WebRTC peer-to-peer audio is NOT implemented — this module focuses on
 * presence signaling and audio-to-transcription, which covers the primary
 * collaboration use-case (voice context for AI agents).
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("collaboration:voice-channel");

// ─── Public types ────────────────────────────────────────────────────────────

export interface RTCIceServerConfig {
  credential?: string;
  urls: string | string[];
  username?: string;
}

export interface VoiceChannelConfig {
  /** Display name of the local participant */
  displayName: string;
  /** ICE/TURN server URLs (reserved for future WebRTC upgrade) */
  iceServers?: RTCIceServerConfig[];
  /** Max participants allowed (default: 10) */
  maxParticipants?: number;
  /** Unique identifier for the voice channel room */
  roomId: string;
  /** Signaling transport for presence events */
  signaling?: SignalingTransport;
  /** Whether to start muted (default: true) */
  startMuted?: boolean;
  /** Optional transcription endpoint to POST audio chunks */
  transcriptionUrl?: string;
  /** Unique identifier for this participant */
  userId: string;
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

/**
 * Pluggable signaling transport abstraction.
 *
 * Implementations may use WebSocket, Redis pub/sub, or any message bus.
 * The VoiceChannel publishes presence events through this interface and
 * listens for remote participant events.
 */
export interface SignalingTransport {
  /** Disconnect from the signaling channel */
  close(): void;
  /** Unsubscribe from messages on a channel */
  off(channel: string, handler: (message: PresenceEvent) => void): void;
  /** Subscribe to messages on a channel */
  on(channel: string, handler: (message: PresenceEvent) => void): void;
  /** Publish a message to a channel */
  publish(channel: string, message: PresenceEvent): void;
}

export interface PresenceEvent {
  displayName: string;
  isMuted: boolean;
  isSpeaking: boolean;
  roomId: string;
  timestamp: number;
  type: "join" | "leave" | "mute" | "unmute" | "speaking" | "silent";
  userId: string;
}

// ─── In-memory signaling transport (for local / single-process dev) ──────────

class InMemorySignalingTransport implements SignalingTransport {
  private readonly handlers = new Map<
    string,
    Set<(message: PresenceEvent) => void>
  >();

  close(): void {
    this.handlers.clear();
  }

  on(channel: string, handler: (message: PresenceEvent) => void): void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)?.add(handler);
  }

  off(channel: string, handler: (message: PresenceEvent) => void): void {
    this.handlers.get(channel)?.delete(handler);
  }

  publish(channel: string, message: PresenceEvent): void {
    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      for (const handler of channelHandlers) {
        try {
          handler(message);
        } catch (err) {
          logger.error({ err }, "Signaling handler error");
        }
      }
    }
  }
}

// ─── VoiceChannel implementation ─────────────────────────────────────────────

export class VoiceChannel {
  private config: VoiceChannelConfig | null = null;
  private state: VoiceChannelState = "disconnected";
  private readonly eventListeners = new Map<
    string,
    Set<VoiceChannelListener<unknown>>
  >();
  private readonly participants = new Map<string, VoiceParticipant>();
  private signaling: SignalingTransport | null = null;
  private signalingHandler: ((message: PresenceEvent) => void) | null = null;

  private localParticipant: VoiceParticipant | null = null;
  private isMuted = true;

  // Audio capture
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private speakingDetectionInterval: ReturnType<typeof setInterval> | null =
    null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(config?: VoiceChannelConfig) {
    if (config) {
      this.config = config;
    }
  }

  /**
   * Join the voice channel. Begins publishing presence events through the
   * signaling transport and optionally starts capturing audio.
   */
  join(config?: VoiceChannelConfig): boolean {
    if (config) {
      this.config = config;
    }

    if (!this.config) {
      logger.warn(
        "Cannot join voice channel — call join() with a VoiceChannelConfig"
      );
      return false;
    }

    if (this.state === "connected") {
      logger.warn("Already connected to voice channel");
      return true;
    }

    this.setState("connecting");

    const cfg = this.config;
    const startMuted = cfg.startMuted ?? true;
    this.isMuted = startMuted;

    // Initialize signaling transport
    this.signaling = cfg.signaling ?? new InMemorySignalingTransport();

    // Create local participant
    this.localParticipant = {
      id: cfg.userId,
      displayName: cfg.displayName,
      isMuted: startMuted,
      isSpeaking: false,
      joinedAt: new Date(),
    };
    this.participants.set(cfg.userId, this.localParticipant);

    // Listen for remote presence events
    const channelName = `voice:${cfg.roomId}`;
    this.signalingHandler = (event: PresenceEvent) => {
      this.handleRemoteEvent(event);
    };
    this.signaling.on(channelName, this.signalingHandler);

    // Publish join event
    this.publishPresence("join");
    this.setState("connected");

    this.emit("participantJoined", { ...this.localParticipant });
    logger.info(
      { roomId: cfg.roomId, userId: cfg.userId },
      "Joined voice channel"
    );

    // Attempt to capture audio (browser-only, fails gracefully on server)
    this.startAudioCapture().catch((err) => {
      logger.warn({ err }, "Audio capture unavailable");
    });

    return true;
  }

  /**
   * Leave the voice channel and clean up all resources.
   */
  leave(): void {
    if (this.state === "disconnected") {
      return;
    }

    if (!this.config) {
      return;
    }

    // Publish leave event before tearing down
    this.publishPresence("leave");

    if (this.localParticipant) {
      const leavingParticipant = { ...this.localParticipant };
      this.participants.delete(this.config.userId);
      this.emit("participantLeft", leavingParticipant);
    }

    this.stopAudioCapture();
    this.cleanupSignaling();

    this.localParticipant = null;
    this.setState("disconnected");
    logger.info({ roomId: this.config.roomId }, "Left voice channel");
  }

  /**
   * Mute the local participant's microphone and publish a mute event.
   */
  mute(): void {
    if (this.state !== "connected" || !this.localParticipant) {
      logger.warn("Cannot mute — not connected to a voice channel");
      return;
    }

    if (this.isMuted) {
      return;
    }

    this.isMuted = true;
    this.localParticipant.isMuted = true;
    this.localParticipant.isSpeaking = false;

    // Disable audio tracks
    if (this.mediaStream) {
      for (const track of this.mediaStream.getAudioTracks()) {
        track.enabled = false;
      }
    }

    this.publishPresence("mute");
    this.emit("participantMuted", { ...this.localParticipant });
    logger.debug("Muted local microphone");
  }

  /**
   * Unmute the local participant's microphone and publish an unmute event.
   */
  unmute(): void {
    if (this.state !== "connected" || !this.localParticipant) {
      logger.warn("Cannot unmute — not connected to a voice channel");
      return;
    }

    if (!this.isMuted) {
      return;
    }

    this.isMuted = false;
    this.localParticipant.isMuted = false;

    // Re-enable audio tracks
    if (this.mediaStream) {
      for (const track of this.mediaStream.getAudioTracks()) {
        track.enabled = true;
      }
    }

    this.publishPresence("unmute");
    this.emit("participantMuted", { ...this.localParticipant });
    logger.debug("Unmuted local microphone");
  }

  /**
   * Get the list of participants currently in the voice channel.
   */
  getParticipants(): VoiceParticipant[] {
    return Array.from(this.participants.values()).map((p) => ({ ...p }));
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
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners
      .get(event)
      ?.add(listener as VoiceChannelListener<unknown>);
  }

  /**
   * Remove an event listener.
   */
  off<K extends keyof VoiceChannelEventMap>(
    event: K,
    listener: VoiceChannelListener<VoiceChannelEventMap[K]>
  ): void {
    this.eventListeners
      .get(event)
      ?.delete(listener as VoiceChannelListener<unknown>);
  }

  // ─── Private helpers ─────────────────────────────────────────────

  private setState(newState: VoiceChannelState): void {
    this.state = newState;
    this.emit("stateChange", newState);
  }

  private publishPresence(type: PresenceEvent["type"]): void {
    if (!(this.signaling && this.config && this.localParticipant)) {
      return;
    }

    const event: PresenceEvent = {
      type,
      roomId: this.config.roomId,
      userId: this.config.userId,
      displayName: this.localParticipant.displayName,
      isMuted: this.localParticipant.isMuted,
      isSpeaking: this.localParticipant.isSpeaking,
      timestamp: Date.now(),
    };

    this.signaling.publish(`voice:${this.config.roomId}`, event);
  }

  private handleRemoteEvent(event: PresenceEvent): void {
    // Ignore our own events
    if (this.config && event.userId === this.config.userId) {
      return;
    }

    // Enforce max participants
    if (
      event.type === "join" &&
      this.config?.maxParticipants &&
      this.participants.size >= this.config.maxParticipants
    ) {
      logger.warn(
        { userId: event.userId },
        "Max participants reached, ignoring join"
      );
      return;
    }

    switch (event.type) {
      case "join": {
        const participant: VoiceParticipant = {
          id: event.userId,
          displayName: event.displayName,
          isMuted: event.isMuted,
          isSpeaking: false,
          joinedAt: new Date(event.timestamp),
        };
        this.participants.set(event.userId, participant);
        this.emit("participantJoined", { ...participant });
        break;
      }
      case "leave": {
        const leaving = this.participants.get(event.userId);
        if (leaving) {
          this.participants.delete(event.userId);
          this.emit("participantLeft", { ...leaving });
        }
        break;
      }
      case "mute":
      case "unmute": {
        const existing = this.participants.get(event.userId);
        if (existing) {
          existing.isMuted = event.isMuted;
          this.emit("participantMuted", { ...existing });
        }
        break;
      }
      case "speaking":
      case "silent": {
        const speaker = this.participants.get(event.userId);
        if (speaker) {
          speaker.isSpeaking = event.type === "speaking";
          this.emit("participantSpeaking", { ...speaker });
        }
        break;
      }
      default: {
        logger.debug(
          { type: event.type, userId: event.userId },
          "Unknown presence event type"
        );
        break;
      }
    }
  }

  /**
   * Start capturing audio from the user's microphone using MediaRecorder.
   * Detected speech is streamed to the transcription endpoint (if configured).
   */
  private async startAudioCapture(): Promise<void> {
    // Guard: only works in browser environments with getUserMedia
    if (
      typeof globalThis.navigator === "undefined" ||
      !globalThis.navigator.mediaDevices
    ) {
      logger.debug(
        "MediaDevices API unavailable — audio capture skipped (server environment)"
      );
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      // Honour initial mute state
      if (this.isMuted) {
        for (const track of this.mediaStream.getAudioTracks()) {
          track.enabled = false;
        }
      }

      // Set up speaking detection via Web Audio API
      this.setupSpeakingDetection(this.mediaStream);

      // Set up MediaRecorder for transcription streaming
      if (this.config?.transcriptionUrl) {
        this.setupMediaRecorder(this.mediaStream);
      }
    } catch (err) {
      logger.warn({ err }, "Failed to acquire microphone");
    }
  }

  private setupSpeakingDetection(stream: MediaStream): void {
    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      let wasSpeaking = false;
      const SPEAKING_THRESHOLD = 30;

      this.speakingDetectionInterval = setInterval(() => {
        if (!(this.analyser && this.localParticipant) || this.isMuted) {
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        const average =
          dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
        const isSpeaking = average > SPEAKING_THRESHOLD;

        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          this.localParticipant.isSpeaking = isSpeaking;
          this.publishPresence(isSpeaking ? "speaking" : "silent");
          this.emit("participantSpeaking", { ...this.localParticipant });
        }
      }, 150);
    } catch (err) {
      logger.debug({ err }, "Web Audio API unavailable for speaking detection");
    }
  }

  private setupMediaRecorder(stream: MediaStream): void {
    try {
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        if (this.audioChunks.length > 0 && this.config?.transcriptionUrl) {
          const blob = new Blob(this.audioChunks, { type: "audio/webm" });
          this.sendToTranscription(blob);
          this.audioChunks = [];
        }
      };

      // Record in 5-second intervals
      this.mediaRecorder.start(5000);
    } catch (err) {
      logger.debug({ err }, "MediaRecorder unavailable");
    }
  }

  private async sendToTranscription(audioBlob: Blob): Promise<void> {
    if (!this.config?.transcriptionUrl) {
      return;
    }

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "voice.webm");
      formData.append("roomId", this.config.roomId);
      formData.append("userId", this.config.userId);

      await fetch(this.config.transcriptionUrl, {
        method: "POST",
        body: formData,
      });
    } catch (err) {
      logger.warn({ err }, "Failed to send audio to transcription endpoint");
    }
  }

  private stopAudioCapture(): void {
    if (this.speakingDetectionInterval) {
      clearInterval(this.speakingDetectionInterval);
      this.speakingDetectionInterval = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;

    if (this.audioContext) {
      this.audioContext.close().catch(() => {
        // best-effort cleanup
      });
      this.audioContext = null;
    }
    this.analyser = null;

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    this.audioChunks = [];
  }

  private cleanupSignaling(): void {
    if (this.signaling && this.config && this.signalingHandler) {
      this.signaling.off(`voice:${this.config.roomId}`, this.signalingHandler);
    }
    this.signaling = null;
    this.signalingHandler = null;
  }

  private emit<K extends keyof VoiceChannelEventMap>(
    event: K,
    data: VoiceChannelEventMap[K]
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (err) {
          logger.error({ event, err }, "Voice channel event listener error");
        }
      }
    }
  }
}
