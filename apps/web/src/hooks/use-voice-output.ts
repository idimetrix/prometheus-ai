"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseVoiceOutputOptions {
  enabled?: boolean;
  pitch?: number;
  rate?: number;
  voice?: string;
  volume?: number;
}

const MARKDOWN_PATTERNS: [RegExp, string][] = [
  [/```[\s\S]*?```/g, ""],
  [/`([^`]+)`/g, "$1"],
  [/\*\*([^*]+)\*\*/g, "$1"],
  [/\*([^*]+)\*/g, "$1"],
  [/__([^_]+)__/g, "$1"],
  [/_([^_]+)_/g, "$1"],
  [/~~([^~]+)~~/g, "$1"],
  [/^#{1,6}\s+/gm, ""],
  [/^\s*[-*+]\s+/gm, ""],
  [/^\s*\d+\.\s+/gm, ""],
  [/\[([^\]]+)\]\([^)]+\)/g, "$1"],
  [/!\[([^\]]*)\]\([^)]+\)/g, "$1"],
  [/^\s*>\s+/gm, ""],
  [/^[-*_]{3,}\s*$/gm, ""],
  [/\n{2,}/g, "\n"],
];

function stripMarkdown(text: string): string {
  let result = text;
  for (const [pattern, replacement] of MARKDOWN_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result.trim();
}

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

function splitIntoSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function getSynthesis(): SpeechSynthesis | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.speechSynthesis ?? null;
}

export function useVoiceOutput(options: UseVoiceOutputOptions = {}) {
  const {
    enabled = true,
    rate = 1,
    pitch = 1,
    volume = 1,
    voice: voiceName,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(voiceName ?? "");
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  const mountedRef = useRef(true);

  // Load available voices
  useEffect(() => {
    const synth = getSynthesis();
    if (!synth) {
      return;
    }

    const loadVoices = () => {
      const available = synth.getVoices();
      if (available.length > 0) {
        setVoices(available);
        if (!selectedVoice && available.length > 0 && available[0]) {
          setSelectedVoice(available[0].name);
        }
      }
    };

    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);

    return () => {
      synth.removeEventListener("voiceschanged", loadVoices);
    };
  }, [selectedVoice]);

  // Track mount state for cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const synth = getSynthesis();
      if (synth) {
        synth.cancel();
      }
    };
  }, []);

  const stop = useCallback(() => {
    const synth = getSynthesis();
    if (synth) {
      synth.cancel();
    }
    utterancesRef.current = [];
    if (mountedRef.current) {
      setIsSpeaking(false);
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      const synth = getSynthesis();
      if (!(synth && enabled)) {
        return;
      }

      // Stop any current speech
      synth.cancel();
      utterancesRef.current = [];

      const cleaned = stripMarkdown(text);
      if (!cleaned) {
        return;
      }

      const sentences = splitIntoSentences(cleaned);
      const matchingVoice = voices.find((v) => v.name === selectedVoice);

      const utterances = sentences.map((sentence, index) => {
        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.rate = Math.min(10, Math.max(0.1, rate));
        utterance.pitch = Math.min(2, Math.max(0, pitch));
        utterance.volume = Math.min(1, Math.max(0, volume));

        if (matchingVoice) {
          utterance.voice = matchingVoice;
        }

        if (index === sentences.length - 1) {
          utterance.onend = () => {
            if (mountedRef.current) {
              setIsSpeaking(false);
            }
          };
        }

        utterance.onerror = () => {
          if (mountedRef.current) {
            setIsSpeaking(false);
          }
        };

        return utterance;
      });

      utterancesRef.current = utterances;
      setIsSpeaking(true);

      for (const utterance of utterances) {
        synth.speak(utterance);
      }
    },
    [enabled, rate, pitch, volume, voices, selectedVoice]
  );

  const setVoice = useCallback((name: string) => {
    setSelectedVoice(name);
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    voices,
    selectedVoice,
    setVoice,
  };
}
