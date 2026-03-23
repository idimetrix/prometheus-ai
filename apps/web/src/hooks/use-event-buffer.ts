"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BufferedEvent {
  data: Record<string, unknown>;
  id: string;
  sequence: number;
  timestamp: string;
  type: string;
}

interface EventBufferReturn {
  /** All events in order */
  events: BufferedEvent[];
  /** Whether a replay (gap-fill) is in progress */
  isReplaying: boolean;
  /** Last known sequence number */
  lastSequence: number;
  /** Push a new event into the buffer (deduplicates by sequence) */
  push: (event: BufferedEvent) => void;
  /** Reset the buffer */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BUFFER_SIZE = 1000;
const REPLAY_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Event buffer hook with sequence number tracking, deduplication,
 * and gap-fill replay support.
 *
 * On reconnect, fetch missed events via
 * `GET /events/:sessionId?after=sequenceNum`.
 */
export function useEventBuffer(sessionId: string): EventBufferReturn {
  const [events, setEvents] = useState<BufferedEvent[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const lastSequence = useRef(0);
  const seenSequences = useRef(new Set<number>());
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gapDetected = useRef(false);

  const push = useCallback((event: BufferedEvent) => {
    // Deduplicate by sequence number
    if (event.sequence > 0 && seenSequences.current.has(event.sequence)) {
      return;
    }

    if (event.sequence > 0) {
      seenSequences.current.add(event.sequence);

      // Detect gap
      if (
        lastSequence.current > 0 &&
        event.sequence > lastSequence.current + 1
      ) {
        gapDetected.current = true;
      }

      if (event.sequence > lastSequence.current) {
        lastSequence.current = event.sequence;
      }

      // Keep seen set bounded
      if (seenSequences.current.size > 3000) {
        const sorted = Array.from(seenSequences.current).sort((a, b) => a - b);
        seenSequences.current = new Set(sorted.slice(-1500));
      }
    }

    setEvents((prev) => {
      const next = [...prev, event];
      // Sort by sequence if available
      next.sort((a, b) => a.sequence - b.sequence);
      // Trim to max size
      return next.slice(-MAX_BUFFER_SIZE);
    });
  }, []);

  // Gap-fill replay logic
  useEffect(() => {
    if (!(gapDetected.current && sessionId)) {
      return;
    }

    // Debounce to avoid multiple fetches during burst reconnect
    if (replayTimer.current) {
      clearTimeout(replayTimer.current);
    }

    replayTimer.current = setTimeout(() => {
      gapDetected.current = false;
      setIsReplaying(true);

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const afterSeq = lastSequence.current;

      fetch(`${apiUrl}/api/events/${sessionId}?after=${afterSeq}`)
        .then(async (res) => {
          if (!res.ok) {
            return;
          }
          const data = (await res.json()) as { events?: BufferedEvent[] };
          if (data.events) {
            for (const event of data.events) {
              push(event);
            }
          }
        })
        .catch(() => {
          /* replay fetch failed silently */
        })
        .finally(() => {
          setIsReplaying(false);
        });
    }, REPLAY_DEBOUNCE_MS);

    return () => {
      if (replayTimer.current) {
        clearTimeout(replayTimer.current);
      }
    };
  }, [sessionId, push]);

  const reset = useCallback(() => {
    setEvents([]);
    lastSequence.current = 0;
    seenSequences.current.clear();
    gapDetected.current = false;
    setIsReplaying(false);
  }, []);

  return {
    events,
    isReplaying,
    lastSequence: lastSequence.current,
    push,
    reset,
  };
}
