/**
 * Voice Interface (P6.5).
 *
 * Server-side voice processing for speech-to-text (Whisper, Deepgram),
 * text-to-speech (Kokoro, ElevenLabs), command parsing, and
 * meeting transcript action item extraction.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("voice:interface");

// ── Regex patterns (top-level for performance) ──

/** Matches "we need to ..." action items. */
const WE_NEED_TO_PATTERN = /we\s+need\s+to\s+([^.!?\n]+)/gi;

/** Matches explicit "action item: ..." declarations. */
const ACTION_ITEM_PATTERN = /action\s+item\s*:\s*([^.!?\n]+)/gi;

/** Matches "TODO: ..." items. */
const TODO_PATTERN = /TODO\s*:\s*([^.!?\n]+)/gi;

/** Matches "[name] will ..." assignments. */
const PERSON_WILL_PATTERN = /(\w+)\s+will\s+([^.!?\n]+)/gi;

/** Matches "[name] should ..." assignments. */
const PERSON_SHOULD_PATTERN = /(\w+)\s+should\s+([^.!?\n]+)/gi;

/** Matches "by [date]" deadline modifiers. */
const _BY_DATE_PATTERN =
  /by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+week|end\s+of\s+(?:day|week|month|sprint)|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i;

/** Matches "submit" or "create task" or "add feature" voice commands. */
const SUBMIT_TASK_PATTERN =
  /\b(?:submit|create\s+(?:a\s+)?task|add\s+(?:a\s+)?(?:feature|bug|issue|ticket)|file\s+(?:a\s+)?(?:bug|issue|ticket))\b/i;

/** Matches approval commands. */
const APPROVE_PATTERN =
  /\b(?:approve|approved|looks\s+good|lgtm|ship\s+it|go\s+ahead|merge\s+it)\b/i;

/** Matches rejection commands. */
const REJECT_PATTERN =
  /\b(?:reject|rejected|decline|denied|block|do\s+not\s+merge|needs?\s+changes?)\b/i;

/** Matches redirect commands. */
const REDIRECT_PATTERN =
  /\b(?:redirect|reassign|transfer|change\s+(?:to|agent)|switch\s+(?:to|agent)|forward\s+to)\b/i;

/** Matches status query commands. */
const STATUS_PATTERN =
  /\b(?:status|progress|update|how\s+is|what(?:'s|\s+is)\s+the\s+(?:status|progress|state))\b/i;

/** Extracts redirect target from "redirect to [target]" commands. */
const REDIRECT_TARGET_PATTERN =
  /(?:redirect|reassign|transfer|forward)\s+to\s+(\w+)/;

/** Matches priority keywords in action items. */
const HIGH_PRIORITY_PATTERN =
  /\b(?:urgent|critical|asap|immediately|blocker|high\s+priority)\b/i;

/** Matches medium priority keywords. */
const MEDIUM_PRIORITY_PATTERN =
  /\b(?:soon|important|should|medium\s+priority)\b/i;

/** Default STT endpoint for Whisper. */
const WHISPER_URL =
  process.env.WHISPER_URL ?? "http://localhost:8080/v1/audio/transcriptions";

/** Default STT endpoint for Deepgram. */
const DEEPGRAM_URL =
  process.env.DEEPGRAM_URL ?? "https://api.deepgram.com/v1/listen";

/** Default TTS endpoint for Kokoro. */
const KOKORO_URL =
  process.env.KOKORO_URL ?? "http://localhost:8081/v1/audio/speech";

/** Default TTS endpoint for ElevenLabs. */
const ELEVENLABS_BASE_URL =
  process.env.ELEVENLABS_URL ?? "https://api.elevenlabs.io/v1/text-to-speech";

/** Default ElevenLabs voice ID. */
const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";

/** API request timeout in milliseconds. */
const API_TIMEOUT_MS = 60_000;

export interface VoiceConfig {
  language: string;
  sttApiKey?: string;
  sttProvider: "whisper" | "deepgram";
  ttsApiKey?: string;
  ttsProvider: "kokoro" | "elevenlabs" | "none";
}

export interface TranscriptionResult {
  confidence: number;
  durationMs: number;
  language: string;
  text: string;
}

export interface SpeechResult {
  audioBuffer: ArrayBuffer;
  durationMs: number;
}

type CommandType = "submit_task" | "approve" | "reject" | "redirect" | "status";

interface ParsedCommand {
  payload: Record<string, string>;
  type: CommandType;
}

interface ActionItem {
  assignee?: string;
  description: string;
  priority: "high" | "medium" | "low";
}

export class VoiceInterface {
  private readonly config: VoiceConfig;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = {
      sttProvider: config?.sttProvider ?? "whisper",
      ttsProvider: config?.ttsProvider ?? "none",
      language: config?.language ?? "en",
      sttApiKey: config?.sttApiKey,
      ttsApiKey: config?.ttsApiKey,
    };
  }

  /**
   * Transcribe audio to text via the configured STT provider.
   */
  async transcribe(audioBuffer: ArrayBuffer): Promise<TranscriptionResult> {
    const requestId = generateId();
    const start = performance.now();

    logger.info(
      {
        requestId,
        provider: this.config.sttProvider,
        audioSizeBytes: audioBuffer.byteLength,
      },
      "Starting audio transcription"
    );

    let result: TranscriptionResult;

    if (this.config.sttProvider === "deepgram") {
      result = await this.transcribeWithDeepgram(audioBuffer);
    } else {
      result = await this.transcribeWithWhisper(audioBuffer);
    }

    const durationMs = Math.round(performance.now() - start);
    result.durationMs = durationMs;

    logger.info(
      {
        requestId,
        provider: this.config.sttProvider,
        textLength: result.text.length,
        confidence: result.confidence,
        durationMs,
      },
      "Audio transcription complete"
    );

    return result;
  }

  /**
   * Convert text to speech via the configured TTS provider.
   */
  async synthesize(text: string): Promise<SpeechResult> {
    const requestId = generateId();
    const start = performance.now();

    if (this.config.ttsProvider === "none") {
      throw new Error("TTS is disabled (provider set to 'none')");
    }

    logger.info(
      {
        requestId,
        provider: this.config.ttsProvider,
        textLength: text.length,
      },
      "Starting text-to-speech synthesis"
    );

    let result: SpeechResult;

    if (this.config.ttsProvider === "elevenlabs") {
      result = await this.synthesizeWithElevenLabs(text);
    } else {
      result = await this.synthesizeWithKokoro(text);
    }

    const durationMs = Math.round(performance.now() - start);
    result.durationMs = durationMs;

    logger.info(
      {
        requestId,
        provider: this.config.ttsProvider,
        audioSizeBytes: result.audioBuffer.byteLength,
        durationMs,
      },
      "Text-to-speech synthesis complete"
    );

    return result;
  }

  /**
   * Parse a voice command transcript into a structured action.
   */
  parseCommand(text: string): ParsedCommand {
    const normalized = text.trim().toLowerCase();

    // Order matters: check more specific patterns first
    if (SUBMIT_TASK_PATTERN.test(normalized)) {
      // Extract the description after the trigger phrase
      const description = normalized.replace(SUBMIT_TASK_PATTERN, "").trim();
      return {
        type: "submit_task",
        payload: {
          description: description || text.trim(),
          raw: text.trim(),
        },
      };
    }

    if (APPROVE_PATTERN.test(normalized)) {
      return {
        type: "approve",
        payload: { raw: text.trim() },
      };
    }

    if (REJECT_PATTERN.test(normalized)) {
      return {
        type: "reject",
        payload: { raw: text.trim() },
      };
    }

    if (REDIRECT_PATTERN.test(normalized)) {
      // Try to extract target from "redirect to [target]"
      const targetMatch = normalized.match(REDIRECT_TARGET_PATTERN);
      return {
        type: "redirect",
        payload: {
          target: targetMatch?.[1] ?? "",
          raw: text.trim(),
        },
      };
    }

    if (STATUS_PATTERN.test(normalized)) {
      return {
        type: "status",
        payload: { raw: text.trim() },
      };
    }

    // Default to submit_task for unrecognized commands
    return {
      type: "submit_task",
      payload: {
        description: text.trim(),
        raw: text.trim(),
      },
    };
  }

  /**
   * Extract action items from a meeting transcript.
   */
  private extractFromPattern(
    transcript: string,
    pattern: RegExp,
    seen: Set<string>,
    items: ActionItem[],
    options?: { assigneeIndex?: number; descriptionIndex?: number }
  ): void {
    const descIdx = options?.descriptionIndex ?? 1;
    const assigneeIdx = options?.assigneeIndex;

    for (const match of transcript.matchAll(pattern)) {
      const assignee =
        assigneeIdx === undefined ? undefined : (match[assigneeIdx] ?? "");
      if (assignee && this.isCommonWord(assignee)) {
        continue;
      }

      const description = (match[descIdx] ?? "").trim();
      if (!description || seen.has(description.toLowerCase())) {
        continue;
      }

      seen.add(description.toLowerCase());
      items.push({
        description,
        assignee,
        priority: this.inferPriority(description),
      });
    }
  }

  extractActionItems(transcript: string): ActionItem[] {
    const items: ActionItem[] = [];
    const seen = new Set<string>();

    this.extractFromPattern(transcript, WE_NEED_TO_PATTERN, seen, items);
    this.extractFromPattern(transcript, ACTION_ITEM_PATTERN, seen, items);
    this.extractFromPattern(transcript, TODO_PATTERN, seen, items);
    this.extractFromPattern(transcript, PERSON_WILL_PATTERN, seen, items, {
      assigneeIndex: 1,
      descriptionIndex: 2,
    });
    this.extractFromPattern(transcript, PERSON_SHOULD_PATTERN, seen, items, {
      assigneeIndex: 1,
      descriptionIndex: 2,
    });

    logger.info(
      { actionItemCount: items.length },
      "Extracted action items from transcript"
    );

    return items;
  }

  // ── Private STT implementations ──

  private async transcribeWithWhisper(
    audioBuffer: ArrayBuffer
  ): Promise<TranscriptionResult> {
    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
    formData.append("file", audioBlob, "audio.wav");
    formData.append("model", "whisper-1");
    formData.append("language", this.config.language);
    formData.append("response_format", "verbose_json");

    const headers: Record<string, string> = {};
    if (this.config.sttApiKey) {
      headers.Authorization = `Bearer ${this.config.sttApiKey}`;
    }

    const response = await fetch(WHISPER_URL, {
      method: "POST",
      headers,
      body: formData,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Whisper transcription failed (${response.status}): ${errorBody.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as {
      text: string;
      language: string;
      duration: number;
      segments?: Array<{
        avg_logprob: number;
      }>;
    };

    // Compute average confidence from segment log probabilities
    let confidence = 0.85; // Default confidence
    if (data.segments && data.segments.length > 0) {
      let totalLogProb = 0;
      for (const segment of data.segments) {
        totalLogProb += segment.avg_logprob;
      }
      const avgLogProb = totalLogProb / data.segments.length;
      // Convert log probability to a 0-1 confidence score
      confidence = Math.min(1, Math.max(0, Math.exp(avgLogProb)));
    }

    return {
      text: data.text,
      confidence,
      language: data.language || this.config.language,
      durationMs: Math.round((data.duration || 0) * 1000),
    };
  }

  private async transcribeWithDeepgram(
    audioBuffer: ArrayBuffer
  ): Promise<TranscriptionResult> {
    const apiKey = this.config.sttApiKey;
    if (!apiKey) {
      throw new Error("Deepgram API key is required");
    }

    const queryParams = new URLSearchParams({
      model: "nova-2",
      language: this.config.language,
      punctuate: "true",
      smart_format: "true",
    });

    const response = await fetch(`${DEEPGRAM_URL}?${queryParams.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "audio/wav",
      },
      body: audioBuffer,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Deepgram transcription failed (${response.status}): ${errorBody.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as {
      results: {
        channels: Array<{
          alternatives: Array<{
            transcript: string;
            confidence: number;
          }>;
        }>;
      };
      metadata: {
        duration: number;
        language?: string;
      };
    };

    const channel = data.results.channels[0];
    const alternative = channel?.alternatives[0];

    return {
      text: alternative?.transcript ?? "",
      confidence: alternative?.confidence ?? 0,
      language: data.metadata.language ?? this.config.language,
      durationMs: Math.round((data.metadata.duration || 0) * 1000),
    };
  }

  // ── Private TTS implementations ──

  private async synthesizeWithKokoro(text: string): Promise<SpeechResult> {
    const response = await fetch(KOKORO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: text,
        voice: "af_default",
        response_format: "wav",
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Kokoro TTS failed (${response.status}): ${errorBody.slice(0, 200)}`
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return {
      audioBuffer,
      durationMs: 0, // Will be set by the caller
    };
  }

  private async synthesizeWithElevenLabs(text: string): Promise<SpeechResult> {
    const apiKey = this.config.ttsApiKey;
    if (!apiKey) {
      throw new Error("ElevenLabs API key is required");
    }

    const url = `${ELEVENLABS_BASE_URL}/${ELEVENLABS_VOICE_ID}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `ElevenLabs TTS failed (${response.status}): ${errorBody.slice(0, 200)}`
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return {
      audioBuffer,
      durationMs: 0, // Will be set by the caller
    };
  }

  // ── Private helpers ──

  private inferPriority(text: string): "high" | "medium" | "low" {
    if (HIGH_PRIORITY_PATTERN.test(text)) {
      return "high";
    }
    if (MEDIUM_PRIORITY_PATTERN.test(text)) {
      return "medium";
    }
    return "low";
  }

  /** Filter out common English words that are false positives for assignee names. */
  private isCommonWord(word: string): boolean {
    const commonWords = new Set([
      "i",
      "we",
      "you",
      "he",
      "she",
      "it",
      "they",
      "this",
      "that",
      "the",
      "a",
      "an",
      "there",
      "what",
      "which",
      "who",
      "everyone",
      "someone",
      "nobody",
      "anybody",
    ]);
    return commonWords.has(word.toLowerCase());
  }
}
