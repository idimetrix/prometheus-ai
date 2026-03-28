/**
 * GAP-065: Voice-Driven Development
 *
 * Accepts audio input (WebSocket stream), transcribes using Whisper API,
 * converts transcription to task description, and supports voice commands
 * during session.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:voice-input");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoiceInputConfig {
  language: string;
  sampleRate: number;
  whisperApiUrl: string;
  whisperModel: string;
}

export interface TranscriptionResult {
  confidence: number;
  durationMs: number;
  language: string;
  text: string;
}

export interface VoiceCommand {
  intent?: string;
  text: string;
  type: "task" | "command" | "clarification";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: VoiceInputConfig = {
  whisperApiUrl:
    process.env.WHISPER_API_URL ??
    "https://api.openai.com/v1/audio/transcriptions",
  whisperModel: "whisper-1",
  language: "en",
  sampleRate: 16_000,
};

const COMMAND_PATTERNS: Array<{ pattern: RegExp; intent: string }> = [
  { pattern: /^(stop|cancel|abort)\b/i, intent: "stop" },
  { pattern: /^(undo|revert)\b/i, intent: "undo" },
  { pattern: /^(approve|confirm|yes|go ahead)\b/i, intent: "approve" },
  { pattern: /^(reject|no|deny)\b/i, intent: "reject" },
  { pattern: /^(status|progress)\b/i, intent: "status" },
  { pattern: /^(help|what can you do)\b/i, intent: "help" },
];

// ─── Voice Input Handler ─────────────────────────────────────────────────────

export class VoiceInputHandler {
  private readonly config: VoiceInputConfig;
  private readonly apiKey: string;

  constructor(apiKey: string, config?: Partial<VoiceInputConfig>) {
    this.apiKey = apiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Transcribe audio data using the Whisper API.
   */
  async transcribe(audioData: ArrayBuffer): Promise<TranscriptionResult> {
    const startMs = Date.now();

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([audioData], { type: "audio/wav" }),
      "audio.wav"
    );
    formData.append("model", this.config.whisperModel);
    formData.append("language", this.config.language);
    formData.append("response_format", "verbose_json");

    try {
      const response = await fetch(this.config.whisperApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`Whisper API returned ${response.status}`);
      }

      const data = (await response.json()) as {
        text: string;
        language: string;
        duration: number;
      };

      const result: TranscriptionResult = {
        text: data.text.trim(),
        confidence: 0.9, // Whisper doesn't return confidence directly
        durationMs: Date.now() - startMs,
        language: data.language ?? this.config.language,
      };

      logger.info(
        {
          textLength: result.text.length,
          durationMs: result.durationMs,
          language: result.language,
        },
        "Audio transcribed"
      );

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Transcription failed");
      throw new Error(`Voice transcription failed: ${msg}`);
    }
  }

  /**
   * Parse a transcription into a voice command.
   */
  parseCommand(transcription: string): VoiceCommand {
    const trimmed = transcription.trim();

    // Check for known command patterns
    for (const { pattern, intent } of COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          type: "command",
          text: trimmed,
          intent,
        };
      }
    }

    // Check if it's a clarification (short, question-like)
    if (trimmed.endsWith("?") || trimmed.length < 30) {
      return {
        type: "clarification",
        text: trimmed,
      };
    }

    // Default: treat as a task description
    return {
      type: "task",
      text: trimmed,
    };
  }

  /**
   * Full pipeline: transcribe audio and parse into a command.
   */
  async processAudio(audioData: ArrayBuffer): Promise<VoiceCommand> {
    const transcription = await this.transcribe(audioData);
    return this.parseCommand(transcription.text);
  }
}
