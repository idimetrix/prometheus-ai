"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface HumanInputModalProps {
  agentRole: string;
  context?: string;
  onClose: () => void;
  onSubmit: (response: {
    action: "approve" | "reject" | "respond";
    message: string;
  }) => void;
  open: boolean;
  question: string;
  sessionId: string;
  suggestedResponses?: string[];
}

const ROLE_COLORS: Record<string, string> = {
  architect: "text-purple-400",
  backend: "text-blue-400",
  critic: "text-orange-400",
  default: "text-zinc-400",
  deployer: "text-green-400",
  frontend: "text-cyan-400",
  planner: "text-yellow-400",
  reviewer: "text-pink-400",
  security: "text-red-400",
  tester: "text-emerald-400",
};

function getRoleColor(role: string): string {
  const lower = role.toLowerCase();
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (lower.includes(key)) {
      return color;
    }
  }
  return ROLE_COLORS.default ?? "text-zinc-400";
}

export function HumanInputModal({
  agentRole,
  context,
  onClose,
  onSubmit,
  open,
  question,
  sessionId: _sessionId,
  suggestedResponses,
}: HumanInputModalProps) {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus the text input when the modal opens
  useEffect(() => {
    if (open) {
      setMessage("");
      setIsSubmitting(false);
      // Delay focus slightly to allow the modal transition
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleAction = useCallback(
    (action: "approve" | "reject" | "respond", text?: string) => {
      if (isSubmitting) {
        return;
      }
      setIsSubmitting(true);
      onSubmit({ action, message: text ?? message });
    },
    [isSubmitting, message, onSubmit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Ctrl/Cmd + Enter
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && message.trim()) {
        e.preventDefault();
        handleAction("respond");
      }
    },
    [message, handleAction]
  );

  if (!open) {
    return null;
  }

  const roleColor = getRoleColor(agentRole);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      ref={overlayRef}
    >
      {/* Invisible overlay button to capture clicks outside the modal */}
      <button
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby="human-input-title"
        aria-modal="true"
        className="relative mx-4 w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        role="dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-zinc-700 border-b px-5 py-4">
          <div>
            <h2
              className="font-semibold text-base text-white"
              id="human-input-title"
            >
              Agent Input Required
            </h2>
            <p className={`mt-0.5 text-sm ${roleColor}`}>{agentRole}</p>
          </div>
          <button
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M6 18L18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {/* Question */}
          <div className="mb-4 rounded-lg bg-zinc-800/50 p-4">
            <p className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
              {question}
            </p>
          </div>

          {/* Context (if provided) */}
          {context && (
            <details className="mb-4">
              <summary className="cursor-pointer font-medium text-xs text-zinc-500 hover:text-zinc-400">
                View context
              </summary>
              <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-400">
                {context}
              </pre>
            </details>
          )}

          {/* Suggested Responses */}
          {suggestedResponses && suggestedResponses.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 font-medium text-xs text-zinc-500">
                Suggested responses
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestedResponses.map((suggestion) => (
                  <button
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-700 hover:text-white"
                    disabled={isSubmitting}
                    key={suggestion}
                    onClick={() => handleAction("respond", suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom Response Input */}
          <div className="mb-4">
            <label
              className="mb-1.5 block font-medium text-xs text-zinc-500"
              htmlFor="human-input-response"
            >
              Your response
            </label>
            <textarea
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-600 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
              disabled={isSubmitting}
              id="human-input-response"
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your response... (Ctrl+Enter to submit)"
              ref={inputRef}
              rows={3}
              value={message}
            />
          </div>
        </div>

        {/* Footer / Actions */}
        <div className="flex items-center justify-between border-zinc-700 border-t px-5 py-4">
          <button
            className="rounded-lg bg-red-600/20 px-4 py-2 font-medium text-red-400 text-sm transition-colors hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
            onClick={() =>
              handleAction("reject", message || "Rejected by user")
            }
            type="button"
          >
            Reject
          </button>

          <div className="flex gap-2">
            <button
              className="rounded-lg bg-green-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSubmitting}
              onClick={() => handleAction("approve", message || "Approved")}
              type="button"
            >
              Approve
            </button>
            <button
              className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSubmitting || !message.trim()}
              onClick={() => handleAction("respond")}
              type="button"
            >
              Respond
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
