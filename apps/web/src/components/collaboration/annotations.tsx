"use client";

import { useCallback, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type AnnotationType = "highlight" | "comment" | "reaction";

interface Annotation {
  color: string;
  content: string;
  createdAt: number;
  endOffset: number;
  id: string;
  reactions?: Array<{ emoji: string; userId: string }>;
  replies?: AnnotationReply[];
  startOffset: number;
  type: AnnotationType;
  userId: string;
  userName: string;
}

interface AnnotationReply {
  content: string;
  createdAt: number;
  id: string;
  userId: string;
  userName: string;
}

interface AnnotationOverlayProps {
  annotations: Annotation[];
  className?: string;
  currentUserId: string;
  onAdd?: (annotation: Omit<Annotation, "id" | "createdAt">) => void;
  onDelete?: (id: string) => void;
  onReact?: (annotationId: string, emoji: string) => void;
  onReply?: (annotationId: string, content: string) => void;
  onResolve?: (id: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Annotation Bubble                                                          */
/* -------------------------------------------------------------------------- */

function AnnotationBubble({
  annotation,
  currentUserId,
  onReply,
  onReact,
  onDelete,
}: {
  annotation: Annotation;
  currentUserId: string;
  onDelete?: (id: string) => void;
  onReact?: (id: string, emoji: string) => void;
  onReply?: (id: string, content: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replyText, setReplyText] = useState("");
  const isOwn = annotation.userId === currentUserId;

  const handleSubmitReply = useCallback(() => {
    if (replyText.trim() && onReply) {
      onReply(annotation.id, replyText.trim());
      setReplyText("");
    }
  }, [annotation.id, replyText, onReply]);

  const QUICK_REACTIONS = ["👍", "👎", "❓", "✅"];

  return (
    <div
      className="absolute z-40"
      style={{ top: `${annotation.startOffset}px` }}
    >
      {/* Indicator dot */}
      <button
        className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white"
        onClick={() => setExpanded((v) => !v)}
        style={{ backgroundColor: annotation.color }}
        type="button"
      >
        {annotation.type === "comment" && "C"}
        {annotation.type === "reaction" && "R"}
        {annotation.type === "highlight" && "H"}
      </button>

      {/* Expanded bubble */}
      {expanded && (
        <div className="mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-lg">
          {/* Header */}
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-xs text-zinc-300">
              {annotation.userName}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-600">
                {new Date(annotation.createdAt).toLocaleTimeString()}
              </span>
              {isOwn && onDelete && (
                <button
                  className="text-[10px] text-zinc-600 hover:text-red-400"
                  onClick={() => onDelete(annotation.id)}
                  type="button"
                >
                  del
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <p className="mb-2 text-sm text-zinc-200">{annotation.content}</p>

          {/* Reactions */}
          {annotation.reactions && annotation.reactions.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {annotation.reactions.map((r) => (
                <span
                  className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs"
                  key={`${r.emoji}-${r.userId}`}
                >
                  {r.emoji}
                </span>
              ))}
            </div>
          )}

          {/* Quick reaction buttons */}
          {onReact && (
            <div className="mb-2 flex gap-1">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs hover:bg-zinc-700"
                  key={emoji}
                  onClick={() => onReact(annotation.id, emoji)}
                  type="button"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Replies */}
          {annotation.replies && annotation.replies.length > 0 && (
            <div className="mb-2 border-zinc-800 border-l-2 pl-2">
              {annotation.replies.map((reply) => (
                <div className="mb-1" key={reply.id}>
                  <span className="text-[10px] text-zinc-500">
                    {reply.userName}
                  </span>
                  <p className="text-xs text-zinc-400">{reply.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* Reply input */}
          {onReply && (
            <div className="flex gap-1">
              <input
                className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSubmitReply();
                  }
                }}
                placeholder="Reply..."
                value={replyText}
              />
              <button
                className="rounded bg-blue-600 px-2 py-1 text-white text-xs hover:bg-blue-500 disabled:opacity-40"
                disabled={!replyText.trim()}
                onClick={handleSubmitReply}
                type="button"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function AnnotationOverlay({
  annotations,
  currentUserId,
  onAdd: _onAdd,
  onReply,
  onReact,
  onDelete,
  onResolve: _onResolve,
  className = "",
}: AnnotationOverlayProps) {
  return (
    <div className={`pointer-events-none relative ${className}`}>
      <div className="pointer-events-auto absolute top-0 right-0 h-full w-6">
        {annotations.map((annotation) => (
          <AnnotationBubble
            annotation={annotation}
            currentUserId={currentUserId}
            key={annotation.id}
            onDelete={onDelete}
            onReact={onReact}
            onReply={onReply}
          />
        ))}
      </div>
    </div>
  );
}

export type {
  Annotation,
  AnnotationOverlayProps,
  AnnotationReply,
  AnnotationType,
};
