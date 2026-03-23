"use client";

import { useCallback, useState } from "react";

export interface FeedbackData {
  comment?: string;
  messageId: string;
  rating: "positive" | "negative";
}

interface FeedbackControlsProps {
  messageId: string;
  onSubmit: (feedback: FeedbackData) => void;
}

export function FeedbackControls({
  messageId,
  onSubmit,
}: FeedbackControlsProps) {
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleRating = useCallback(
    (value: "positive" | "negative") => {
      if (submitted) {
        return;
      }

      setRating(value);

      if (value === "positive") {
        onSubmit({ messageId, rating: "positive" });
        setSubmitted(true);
      } else {
        setShowComment(true);
      }
    },
    [messageId, onSubmit, submitted]
  );

  const handleSubmitNegative = useCallback(() => {
    const trimmed = comment.trim();
    onSubmit({
      messageId,
      rating: "negative",
      comment: trimmed || undefined,
    });
    setSubmitted(true);
    setShowComment(false);
  }, [messageId, comment, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmitNegative();
      }
    },
    [handleSubmitNegative]
  );

  if (submitted) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[10px] ${
            rating === "positive"
              ? "bg-green-500/20 text-green-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          {rating === "positive" ? (
            <ThumbsUpIcon className="h-3 w-3" />
          ) : (
            <ThumbsDownIcon className="h-3 w-3" />
          )}
          Feedback sent
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Thumbs buttons */}
      <div className="flex items-center gap-1">
        <button
          aria-label="Thumbs up"
          className={`rounded p-1 transition-colors ${
            rating === "positive"
              ? "bg-green-500/20 text-green-400"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          }`}
          onClick={() => handleRating("positive")}
          type="button"
        >
          <ThumbsUpIcon className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label="Thumbs down"
          className={`rounded p-1 transition-colors ${
            rating === "negative"
              ? "bg-red-500/20 text-red-400"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          }`}
          onClick={() => handleRating("negative")}
          type="button"
        >
          <ThumbsDownIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Comment input for negative feedback */}
      {showComment && (
        <div className="flex gap-1.5">
          <input
            autoFocus
            className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-white text-xs placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What went wrong? (optional)"
            type="text"
            value={comment}
          />
          <button
            className="shrink-0 rounded bg-violet-600 px-2.5 py-1 font-medium text-white text-xs transition-colors hover:bg-violet-500"
            onClick={handleSubmitNegative}
            type="button"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

function ThumbsUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <title>Thumbs up</title>
      <path
        d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThumbsDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <title>Thumbs down</title>
      <path
        d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10zM17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
