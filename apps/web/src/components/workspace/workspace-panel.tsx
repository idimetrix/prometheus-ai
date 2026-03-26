"use client";

import type { ReactNode } from "react";
import { useState } from "react";

interface WorkspacePanelProps {
  children: ReactNode;
  isLoading?: boolean;
  onClose?: () => void;
  onCollapse?: () => void;
  onMaximize?: () => void;
  title: string;
}

export function WorkspacePanel({
  title,
  children,
  isLoading,
  onClose,
  onCollapse,
  onMaximize,
}: WorkspacePanelProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMaximize = () => {
    setIsMaximized((prev) => !prev);
    onMaximize?.();
  };

  return (
    <div
      className={`flex h-full flex-col overflow-hidden border border-zinc-800 bg-zinc-900/50 ${
        isMaximized ? "fixed inset-0 z-50" : "rounded-lg"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b bg-zinc-900/80 px-3 py-1.5">
        <span className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          {title}
        </span>
        <div className="flex items-center gap-1">
          {onCollapse && (
            <button
              className="rounded p-0.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              onClick={onCollapse}
              title="Collapse panel"
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M19.5 12h-15"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          {onMaximize && (
            <button
              className="rounded p-0.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              onClick={handleMaximize}
              title={isMaximized ? "Restore panel" : "Maximize panel"}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                {isMaximized ? (
                  <path
                    d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </button>
          )}
          {onClose && (
            <button
              className="rounded p-0.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
              onClick={onClose}
              title="Close panel"
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M6 18 18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
