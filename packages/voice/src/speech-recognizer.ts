"use client";

/**
 * Events emitted by the SpeechRecognizer.
 */
export interface SpeechRecognizerEvents {
  onEnd?: () => void;
  onError?: (error: SpeechRecognizerError) => void;
  onResult?: (result: SpeechRecognizerResult) => void;
  onStart?: () => void;
}

export interface SpeechRecognizerResult {
  /** Confidence score between 0 and 1 */
  confidence: number;
  /** Whether this is a final (non-interim) result */
  isFinal: boolean;
  /** The recognized transcript text */
  transcript: string;
}

export interface SpeechRecognizerError {
  /** Error code from the Web Speech API */
  code: string;
  /** Human-readable error message */
  message: string;
}

export interface SpeechRecognizerOptions {
  /** Whether to continuously listen (true) or stop after first result (false). Default: true */
  continuous?: boolean;
  /** Whether to return interim results. Default: true */
  interimResults?: boolean;
  /** BCP 47 language tag. Default: "en-US" */
  language?: string;
  /** Maximum number of alternatives per result. Default: 1 */
  maxAlternatives?: number;
}

/**
 * Browser-compatible wrapper around the Web Speech API's SpeechRecognition interface.
 *
 * Provides a clean start/stop/event-based API for voice recognition.
 */
export class SpeechRecognizer {
  private events: SpeechRecognizerEvents = {};
  private recognition: SpeechRecognition | null = null;
  private running = false;

  private readonly options: SpeechRecognizerOptions;

  constructor(options: SpeechRecognizerOptions = {}) {
    this.options = options;
  }

  /**
   * Returns true if the Web Speech API is available in the current environment.
   */
  static isSupported(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  }

  /**
   * Returns whether the recognizer is currently listening.
   */
  get isListening(): boolean {
    return this.running;
  }

  /**
   * Register event handlers.
   */
  on(events: SpeechRecognizerEvents): void {
    this.events = { ...this.events, ...events };
  }

  /**
   * Start listening for speech input.
   * Throws if the Web Speech API is not supported.
   */
  start(): void {
    if (this.running) {
      return;
    }

    if (!SpeechRecognizer.isSupported()) {
      const error: SpeechRecognizerError = {
        code: "not-supported",
        message:
          "Web Speech API is not supported in this browser or environment.",
      };
      this.events.onError?.(error);
      return;
    }

    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      this.events.onError?.({
        code: "not-supported",
        message: "SpeechRecognition constructor not available",
      });
      return;
    }
    this.recognition = new SpeechRecognitionCtor();

    this.recognition.continuous = this.options.continuous ?? true;
    this.recognition.interimResults = this.options.interimResults ?? true;
    this.recognition.lang = this.options.language ?? "en-US";
    this.recognition.maxAlternatives = this.options.maxAlternatives ?? 1;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const speechResult = event.results[i];
        if (!speechResult) {
          continue;
        }
        const alternative = speechResult[0];
        if (!alternative) {
          continue;
        }
        const result: SpeechRecognizerResult = {
          transcript: alternative.transcript,
          confidence: alternative.confidence,
          isFinal: speechResult.isFinal,
        };
        this.events.onResult?.(result);
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const error: SpeechRecognizerError = {
        code: event.error,
        message: event.message || `Speech recognition error: ${event.error}`,
      };
      this.events.onError?.(error);
    };

    this.recognition.onstart = () => {
      this.running = true;
      this.events.onStart?.();
    };

    this.recognition.onend = () => {
      this.running = false;
      this.events.onEnd?.();
    };

    this.recognition.start();
  }

  /**
   * Stop listening for speech input.
   */
  stop(): void {
    if (!(this.running && this.recognition)) {
      return;
    }
    this.recognition.stop();
  }

  /**
   * Abort speech recognition immediately (discards pending results).
   */
  abort(): void {
    if (!this.recognition) {
      return;
    }
    this.recognition.abort();
    this.running = false;
  }

  /**
   * Clean up resources. Call when the recognizer is no longer needed.
   */
  dispose(): void {
    this.abort();
    this.recognition = null;
    this.events = {};
  }
}
