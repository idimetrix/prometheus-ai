"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type VoiceInputState = "idle" | "listening" | "processing" | "error";

interface VoiceInputProps {
  className?: string;
  errorMessage?: string;
  onResult?: (transcript: string) => void;
  onStateChange?: (state: VoiceInputState) => void;
  state?: VoiceInputState;
}

/* -------------------------------------------------------------------------- */
/*  Waveform visualization                                                     */
/* -------------------------------------------------------------------------- */

function Waveform({ active }: { active: boolean }) {
  const bars = 12;

  return (
    <div className="flex h-8 items-center gap-0.5">
      {Array.from({ length: bars }, (_, i) => `bar-${i}`).map((id, i) => (
        <div
          className={`w-1 rounded-full transition-all ${
            active ? "bg-blue-400" : "bg-zinc-700"
          }`}
          key={id}
          style={{
            animationDelay: active ? `${i * 80}ms` : "0ms",
            animationDuration: active ? "600ms" : "0ms",
            animationIterationCount: "infinite",
            animationName: active ? "voiceWave" : "none",
            animationTimingFunction: "ease-in-out",
            height: active ? `${8 + Math.sin(i * 0.8) * 12}px` : "4px",
          }}
        />
      ))}
      <style>{`
        @keyframes voiceWave {
          0%, 100% { height: 4px; }
          50% { height: 20px; }
        }
      `}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function VoiceInput({
  state = "idle",
  onResult,
  onStateChange,
  errorMessage,
  className = "",
}: VoiceInputProps) {
  const [transcript, setTranscript] = useState("");
  const [internalState, setInternalState] = useState<VoiceInputState>(state);
  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    setInternalState(state);
  }, [state]);

  const startListening = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const win = window as unknown as Record<string, unknown>;
    const SpeechRecognitionCtor =
      (win.SpeechRecognition as (new () => unknown) | undefined) ??
      (win.webkitSpeechRecognition as (new () => unknown) | undefined);

    if (!SpeechRecognitionCtor) {
      setInternalState("error");
      onStateChange?.("error");
      return;
    }

    const recognition = new SpeechRecognitionCtor() as {
      continuous: boolean;
      interimResults: boolean;
      onend: (() => void) | null;
      onerror: (() => void) | null;
      onresult:
        | ((event: {
            results: Iterable<Array<{ transcript: string }>>;
          }) => void)
        | null;
      start(): void;
      stop(): void;
    };

    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let text = "";
      for (const result of event.results) {
        text += result[0]?.transcript ?? "";
      }
      setTranscript(text);
    };

    recognition.onend = () => {
      setInternalState("processing");
      onStateChange?.("processing");
      if (transcript) {
        onResult?.(transcript);
      }
      setTimeout(() => {
        setInternalState("idle");
        onStateChange?.("idle");
      }, 500);
    };

    recognition.onerror = () => {
      setInternalState("error");
      onStateChange?.("error");
    };

    recognition.start();
    recognitionRef.current = recognition;
    setInternalState("listening");
    onStateChange?.("listening");
    setTranscript("");
  }, [onResult, onStateChange, transcript]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current as { stop(): void } | null;
    recognition?.stop();
    recognitionRef.current = null;
  }, []);

  const handleToggle = useCallback(() => {
    if (internalState === "listening") {
      stopListening();
    } else if (internalState === "idle" || internalState === "error") {
      startListening();
    }
  }, [internalState, startListening, stopListening]);

  const stateStyles: Record<VoiceInputState, string> = {
    error: "border-red-800 bg-red-950/20",
    idle: "border-zinc-700 bg-zinc-900/60",
    listening: "border-blue-700 bg-blue-950/20",
    processing: "border-yellow-800 bg-yellow-950/20",
  };

  const buttonStyles: Record<VoiceInputState, string> = {
    error: "bg-red-600 hover:bg-red-500",
    idle: "bg-zinc-700 hover:bg-zinc-600",
    listening: "bg-red-600 hover:bg-red-500 animate-pulse",
    processing: "bg-yellow-600 cursor-wait",
  };

  return (
    <div
      className={`rounded-lg border p-4 ${stateStyles[internalState]} ${className}`}
    >
      <div className="flex items-center gap-3">
        {/* Microphone button */}
        <button
          aria-label={
            internalState === "listening" ? "Stop recording" : "Start recording"
          }
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${buttonStyles[internalState]}`}
          disabled={internalState === "processing"}
          onClick={handleToggle}
          type="button"
        >
          {internalState === "listening" ? "||" : "mic"}
        </button>

        {/* Waveform */}
        <Waveform active={internalState === "listening"} />

        {/* Status */}
        <div className="min-w-0 flex-1">
          {internalState === "idle" && (
            <span className="text-xs text-zinc-500">
              Click to start voice input
            </span>
          )}
          {internalState === "listening" && (
            <span className="text-blue-400 text-xs">Listening...</span>
          )}
          {internalState === "processing" && (
            <span className="text-xs text-yellow-400">Processing...</span>
          )}
          {internalState === "error" && (
            <span className="text-red-400 text-xs">
              {errorMessage ?? "Voice input not available"}
            </span>
          )}
          {transcript && (
            <p className="mt-1 truncate text-sm text-zinc-300">{transcript}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export type { VoiceInputProps, VoiceInputState };
