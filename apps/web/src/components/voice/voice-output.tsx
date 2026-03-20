"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type PlaybackState = "idle" | "playing" | "paused";

interface VoiceOutputProps {
  autoPlay?: boolean;
  className?: string;
  onComplete?: () => void;
  text: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function VoiceOutput({
  text,
  autoPlay = false,
  onComplete,
  className = "",
}: VoiceOutputProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [speed, setSpeed] = useState(1);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    setPlaybackState("idle");
  }, []);

  const play = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      return;
    }

    // Cancel any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;

    utterance.onend = () => {
      setPlaybackState("idle");
      utteranceRef.current = null;
      onComplete?.();
    };

    utterance.onerror = () => {
      setPlaybackState("idle");
      utteranceRef.current = null;
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setPlaybackState("playing");
  }, [text, speed, onComplete]);

  const pause = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.speechSynthesis?.pause();
    setPlaybackState("paused");
  }, []);

  const resume = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.speechSynthesis?.resume();
    setPlaybackState("playing");
  }, []);

  const togglePlayPause = useCallback(() => {
    if (playbackState === "idle") {
      play();
    } else if (playbackState === "playing") {
      pause();
    } else {
      resume();
    }
  }, [playbackState, play, pause, resume]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
      const idx = speeds.indexOf(prev);
      return speeds[(idx + 1) % speeds.length] ?? 1;
    });
  }, []);

  // Auto-play support
  useEffect(() => {
    if (autoPlay && text) {
      play();
    }
    return () => {
      stop();
    };
  }, [autoPlay, text, play, stop]);

  const playbackIcons: Record<PlaybackState, string> = {
    idle: "Play",
    paused: "Resume",
    playing: "Pause",
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 ${className}`}
    >
      {/* Play/Pause */}
      <button
        aria-label={playbackIcons[playbackState]}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white text-xs hover:bg-blue-500"
        onClick={togglePlayPause}
        type="button"
      >
        {playbackState === "playing" ? "||" : ">"}
      </button>

      {/* Progress indicator */}
      <div className="min-w-0 flex-1">
        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full bg-blue-500 transition-all ${
              playbackState === "playing" ? "animate-pulse" : ""
            }`}
            style={{
              width: (() => {
                if (playbackState === "idle") {
                  return "0%";
                }
                if (playbackState === "playing") {
                  return "100%";
                }
                return "50%";
              })(),
            }}
          />
        </div>
        <p className="mt-1 truncate text-xs text-zinc-500">{text}</p>
      </div>

      {/* Speed control */}
      <button
        className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700"
        onClick={cycleSpeed}
        type="button"
      >
        {speed}x
      </button>

      {/* Stop button */}
      {playbackState !== "idle" && (
        <button
          aria-label="Stop"
          className="shrink-0 rounded p-1 text-xs text-zinc-500 hover:text-zinc-300"
          onClick={stop}
          type="button"
        >
          Stop
        </button>
      )}
    </div>
  );
}

export type { PlaybackState, VoiceOutputProps };
