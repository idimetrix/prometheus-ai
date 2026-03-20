"use client";

import { type ReactNode, useCallback, useRef } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface TouchGestureProviderProps {
  children: ReactNode;
  className?: string;
  onPullToRefresh?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  pullThreshold?: number;
  swipeThreshold?: number;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function TouchGestureProvider({
  children,
  onSwipeRight,
  onSwipeLeft,
  onPullToRefresh,
  swipeThreshold = 80,
  pullThreshold = 100,
  className = "",
}: TouchGestureProviderProps) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const pullDistanceRef = useRef(0);
  const pullIndicatorRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }
    pullDistanceRef.current = 0;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!(touchStartRef.current && e.touches[0])) {
        return;
      }

      const touch = e.touches[0];
      const deltaY = touch.clientY - touchStartRef.current.y;

      // Pull to refresh (only when at top of scroll)
      if (onPullToRefresh && deltaY > 0) {
        const el = e.currentTarget;
        if (el.scrollTop <= 0) {
          pullDistanceRef.current = Math.min(deltaY, pullThreshold * 1.5);
          if (pullIndicatorRef.current) {
            const progress = Math.min(
              pullDistanceRef.current / pullThreshold,
              1
            );
            pullIndicatorRef.current.style.height = `${pullDistanceRef.current * 0.3}px`;
            pullIndicatorRef.current.style.opacity = `${progress}`;
          }
        }
      }
    },
    [onPullToRefresh, pullThreshold]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) {
        return;
      }

      const touch = e.changedTouches[0];
      if (!touch) {
        touchStartRef.current = null;
        return;
      }

      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      // Horizontal swipes (only if mostly horizontal)
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        if (deltaX > swipeThreshold && onSwipeRight) {
          onSwipeRight();
        } else if (deltaX < -swipeThreshold && onSwipeLeft) {
          onSwipeLeft();
        }
      }

      // Pull to refresh
      if (onPullToRefresh && pullDistanceRef.current >= pullThreshold) {
        onPullToRefresh();
      }

      // Reset pull indicator
      if (pullIndicatorRef.current) {
        pullIndicatorRef.current.style.height = "0px";
        pullIndicatorRef.current.style.opacity = "0";
      }

      touchStartRef.current = null;
      pullDistanceRef.current = 0;
    },
    [swipeThreshold, pullThreshold, onSwipeRight, onSwipeLeft, onPullToRefresh]
  );

  return (
    <div
      className={`relative ${className}`}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
    >
      {/* Pull to refresh indicator */}
      {onPullToRefresh && (
        <div
          className="flex items-center justify-center overflow-hidden text-xs text-zinc-500 transition-opacity"
          ref={pullIndicatorRef}
          style={{ height: 0, opacity: 0 }}
        >
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <span className="ml-2">Pull to refresh</span>
        </div>
      )}
      {children}
    </div>
  );
}

export type { TouchGestureProviderProps };
