"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal typings for the Web Speech API (SpeechRecognition).
 */
interface SpeechRecognitionResult {
  [index: number]: { transcript: string } | undefined;
}

interface SpeechRecognitionResultList
  extends Iterable<SpeechRecognitionResult> {
  length: number;
  [index: number]: SpeechRecognitionResult | undefined;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance {
  abort(): void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const win = window as unknown as Record<string, unknown>;
  return (
    (win.SpeechRecognition as SpeechRecognitionConstructor | undefined) ??
    (win.webkitSpeechRecognition as SpeechRecognitionConstructor | undefined) ??
    null
  );
}

export type VoiceInputMode = "toggle" | "push-to-talk";

interface UseVoiceInputOptions {
  /** Language for recognition (BCP 47 tag, e.g., "en-US") */
  lang?: string;
  /** Input mode: "toggle" stays on until stopped, "push-to-talk" requires holding a key/button */
  mode?: VoiceInputMode;
  /** Called when recognition ends (natural end or manual stop) */
  onEnd?: (finalTranscript: string) => void;
  /** Called on recognition errors */
  onError?: (error: string) => void;
  /** Called whenever the transcript updates (including interim results) */
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  /** Key code for push-to-talk (default: "Space") */
  pushToTalkKey?: string;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const {
    mode = "toggle",
    lang = "en-US",
    onTranscript,
    onEnd,
    onError,
    pushToTalkKey = "Space",
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptRef = useRef("");

  const isSupported = getSpeechRecognitionCtor() !== null;

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition not supported in this browser");
      onError?.("Speech recognition not supported in this browser");
      return;
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new Ctor();
    recognition.continuous = mode === "toggle";
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";

      for (const result of event.results) {
        const entry = result[0];
        if (!entry) {
          continue;
        }
        // Check if the result is final by looking at result.isFinal
        // The SpeechRecognitionResult has an isFinal property on the result itself
        const resultObj = result as unknown as { isFinal?: boolean };
        if (resultObj.isFinal) {
          finalText += entry.transcript;
        } else {
          interimText += entry.transcript;
        }
      }

      if (finalText) {
        transcriptRef.current = finalText;
        setTranscript(finalText);
        onTranscript?.(finalText, true);
      }

      setInterimTranscript(interimText);
      if (interimText) {
        onTranscript?.(interimText, false);
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === "aborted" || event.error === "no-speech") {
        return;
      }
      setError(event.error);
      onError?.(event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
      onEnd?.(transcriptRef.current);
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
    setError(null);
    setTranscript("");
    setInterimTranscript("");
    transcriptRef.current = "";
  }, [mode, lang, onTranscript, onEnd, onError]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  // Push-to-talk keyboard handler
  useEffect(() => {
    if (mode !== "push-to-talk") {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== pushToTalkKey) {
        return;
      }
      // Don't trigger if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      if (!isListening) {
        start();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pushToTalkKey) {
        return;
      }
      e.preventDefault();
      if (isListening) {
        stop();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [mode, pushToTalkKey, isListening, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return {
    /** Whether the browser supports speech recognition */
    isSupported,
    /** Whether currently listening */
    isListening,
    /** Final confirmed transcript */
    transcript,
    /** In-progress interim transcript */
    interimTranscript,
    /** Combined transcript for display */
    displayTranscript: transcript || interimTranscript,
    /** Last error message */
    error,
    /** Start listening */
    start,
    /** Stop listening */
    stop,
    /** Toggle listening on/off (for toggle mode) */
    toggle,
  };
}
