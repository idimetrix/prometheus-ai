/**
 * GAP-106: Real-Time Collaboration Voice Chat
 *
 * WebRTC-based voice channel for sessions, agent audio responses (TTS),
 * and voice activity detection.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("socket-server:voice-channel");

export interface VoiceParticipant {
  displayName: string;
  id: string;
  isMuted: boolean;
  isSpeaking: boolean;
  joinedAt: number;
  userId: string;
}

export interface VoiceChannelState {
  channelId: string;
  createdAt: number;
  isRecording: boolean;
  participants: VoiceParticipant[];
  sessionId: string;
}

export class VoiceChannelManager {
  private readonly channels = new Map<string, VoiceChannelState>();

  createChannel(sessionId: string): VoiceChannelState {
    const channelId = `vc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const channel: VoiceChannelState = {
      channelId,
      sessionId,
      participants: [],
      isRecording: false,
      createdAt: Date.now(),
    };

    this.channels.set(channelId, channel);
    logger.info({ channelId, sessionId }, "Voice channel created");
    return channel;
  }

  joinChannel(
    channelId: string,
    userId: string,
    displayName: string
  ): VoiceParticipant | null {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return null;
    }

    const participant: VoiceParticipant = {
      id: `vp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      displayName,
      isMuted: false,
      isSpeaking: false,
      joinedAt: Date.now(),
    };

    channel.participants.push(participant);
    logger.info(
      { channelId, userId, participantCount: channel.participants.length },
      "User joined voice channel"
    );
    return participant;
  }

  leaveChannel(channelId: string, userId: string): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return false;
    }

    const idx = channel.participants.findIndex((p) => p.userId === userId);
    if (idx >= 0) {
      channel.participants.splice(idx, 1);
      logger.info({ channelId, userId }, "User left voice channel");

      if (channel.participants.length === 0) {
        this.channels.delete(channelId);
        logger.info({ channelId }, "Voice channel closed (empty)");
      }
      return true;
    }
    return false;
  }

  toggleMute(channelId: string, userId: string): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return false;
    }

    const participant = channel.participants.find((p) => p.userId === userId);
    if (participant) {
      participant.isMuted = !participant.isMuted;
      return true;
    }
    return false;
  }

  updateSpeaking(channelId: string, userId: string, isSpeaking: boolean): void {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return;
    }

    const participant = channel.participants.find((p) => p.userId === userId);
    if (participant) {
      participant.isSpeaking = isSpeaking;
    }
  }

  getChannel(channelId: string): VoiceChannelState | undefined {
    return this.channels.get(channelId);
  }

  getChannelBySession(sessionId: string): VoiceChannelState | undefined {
    for (const channel of this.channels.values()) {
      if (channel.sessionId === sessionId) {
        return channel;
      }
    }
    return undefined;
  }
}
