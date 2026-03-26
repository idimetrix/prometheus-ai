"use client";

import { Badge, Button } from "@prometheus/ui";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  FileCode2,
  MessageSquare,
  XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type CommentSeverity = "suggestion" | "issue" | "question" | "praise";
export type ReviewVerdict = "approve" | "request_changes" | "comment";

export interface ReviewComment {
  author: string;
  /** Code suggestion (like GitHub's suggestion feature) */
  codeSuggestion?: string;
  content: string;
  id: string;
  lineNumber?: number;
  /** End line for multi-line selection comments */
  lineNumberEnd?: number;
  /** Threaded replies */
  replies?: ReviewComment[];
  resolved?: boolean;
  /** Comment severity classification */
  severity?: CommentSeverity;
  timestamp: string;
}

export interface FileDiff {
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  path: string;
}

export interface DiffHunk {
  lines: DiffLine[];
  startLine: number;
}

export interface DiffLine {
  content: string;
  lineNumber: number;
  type: "addition" | "deletion" | "context";
}

export interface PendingReview {
  author: string;
  comments: ReviewComment[];
  description?: string;
  diffs: FileDiff[];
  id: string;
  status: "pending" | "approved" | "changes_requested" | "dismissed";
  title: string;
  updatedAt: string;
}

interface ReviewDashboardProps {
  onApprove?: (reviewId: string) => void;
  onComment?: (reviewId: string, comment: string) => void;
  /** Callback for inline comments on a specific line */
  onInlineComment?: (
    reviewId: string,
    filePath: string,
    lineNumber: number,
    comment: InlineCommentPayload
  ) => void;
  onRequestChanges?: (reviewId: string) => void;
  /** Callback to resolve/unresolve a comment */
  onResolveComment?: (
    reviewId: string,
    commentId: string,
    resolved: boolean
  ) => void;
  /** Callback for submitting a full review with verdict */
  onSubmitReview?: (
    reviewId: string,
    verdict: ReviewVerdict,
    body: string
  ) => void;
  reviews: PendingReview[];
}

export interface InlineCommentPayload {
  /** Optional code suggestion */
  codeSuggestion?: string;
  content: string;
  /** End line for multi-line comments */
  lineNumberEnd?: number;
  severity: CommentSeverity;
}

/* -------------------------------------------------------------------------- */
/*  Severity helpers                                                           */
/* -------------------------------------------------------------------------- */

const SEVERITY_CONFIG: Record<
  CommentSeverity,
  { color: string; bg: string; label: string }
> = {
  suggestion: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    label: "Suggestion",
  },
  issue: {
    color: "text-red-400",
    bg: "bg-red-500/10",
    label: "Issue",
  },
  question: {
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    label: "Question",
  },
  praise: {
    color: "text-green-400",
    bg: "bg-green-500/10",
    label: "Praise",
  },
};

/* -------------------------------------------------------------------------- */
/*  Status helpers                                                             */
/* -------------------------------------------------------------------------- */

function getDiffLineBackground(type: string): string {
  if (type === "addition") {
    return "bg-green-500/5";
  }
  if (type === "deletion") {
    return "bg-red-500/5";
  }
  return "";
}

function getDiffLineColor(type: string): string {
  if (type === "addition") {
    return "text-green-400";
  }
  if (type === "deletion") {
    return "text-red-400";
  }
  return "text-zinc-400";
}

function formatFilterLabel(filter: string): string {
  if (filter === "all") {
    return "All";
  }
  if (filter === "changes_requested") {
    return "Changes";
  }
  return filter.charAt(0).toUpperCase() + filter.slice(1);
}

const STATUS_CONFIG: Record<
  string,
  {
    color: string;
    icon: typeof Clock;
    label: string;
    variant: "default" | "success" | "destructive" | "outline";
  }
> = {
  pending: {
    label: "Pending",
    color: "text-yellow-400",
    icon: Clock,
    variant: "outline",
  },
  approved: {
    label: "Approved",
    color: "text-green-400",
    icon: CheckCircle,
    variant: "success",
  },
  changes_requested: {
    label: "Changes Requested",
    color: "text-red-400",
    icon: XCircle,
    variant: "destructive",
  },
  dismissed: {
    label: "Dismissed",
    color: "text-zinc-500",
    icon: XCircle,
    variant: "outline",
  },
};

/* -------------------------------------------------------------------------- */
/*  Inline comment form                                                        */
/* -------------------------------------------------------------------------- */

function InlineCommentForm({
  lineNumber,
  onCancel,
  onSubmit,
}: {
  lineNumber: number;
  onCancel: () => void;
  onSubmit: (payload: InlineCommentPayload) => void;
}) {
  const [content, setContent] = useState("");
  const [severity, setSeverity] = useState<CommentSeverity>("suggestion");
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [codeSuggestion, setCodeSuggestion] = useState("");

  function handleSubmit() {
    if (!content.trim()) {
      return;
    }
    onSubmit({
      content: content.trim(),
      severity,
      codeSuggestion: showSuggestion ? codeSuggestion.trim() : undefined,
    });
    setContent("");
    setCodeSuggestion("");
    setShowSuggestion(false);
  }

  return (
    <div className="border-violet-500 border-l-2 bg-zinc-900/80 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] text-zinc-600">
          Line {lineNumber}
        </span>
        {/* Severity selector */}
        <div className="flex items-center gap-1">
          {(
            Object.entries(SEVERITY_CONFIG) as [
              CommentSeverity,
              (typeof SEVERITY_CONFIG)[CommentSeverity],
            ][]
          ).map(([sev, config]) => (
            <button
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                severity === sev
                  ? `${config.bg} font-medium ${config.color}`
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={sev}
              onClick={() => setSeverity(sev)}
              type="button"
            >
              {config.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write a comment..."
        rows={3}
        value={content}
      />

      {/* Code suggestion toggle */}
      <button
        className="mt-2 flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
        onClick={() => setShowSuggestion(!showSuggestion)}
        type="button"
      >
        <FileCode2 className="h-3 w-3" />
        {showSuggestion ? "Remove suggestion" : "Add code suggestion"}
      </button>

      {showSuggestion && (
        <textarea
          className="mt-2 w-full resize-none rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
          onChange={(e) => setCodeSuggestion(e.target.value)}
          placeholder="Suggested code..."
          rows={3}
          value={codeSuggestion}
        />
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onCancel} size="sm" variant="outline">
          Cancel
        </Button>
        <Button disabled={!content.trim()} onClick={handleSubmit} size="sm">
          Comment
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Diff Viewer with inline commenting                                         */
/* -------------------------------------------------------------------------- */

function InlineDiffViewer({
  diff,
  onInlineComment,
}: {
  diff: FileDiff;
  onInlineComment?: (
    filePath: string,
    lineNumber: number,
    comment: InlineCommentPayload
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);

  const handleLineClick = useCallback(
    (lineNumber: number) => {
      if (!onInlineComment) {
        return;
      }
      setCommentingLine((prev) => (prev === lineNumber ? null : lineNumber));
    },
    [onInlineComment]
  );

  const handleCommentSubmit = useCallback(
    (payload: InlineCommentPayload) => {
      if (commentingLine !== null) {
        onInlineComment?.(diff.path, commentingLine, payload);
        setCommentingLine(null);
      }
    },
    [commentingLine, diff.path, onInlineComment]
  );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950">
      {/* File header */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-900"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
        )}
        <FileCode2 className="h-3.5 w-3.5 text-zinc-500" />
        <span className="flex-1 truncate font-mono text-xs text-zinc-300">
          {diff.path}
        </span>
        <span className="font-mono text-[10px] text-green-500">
          +{diff.additions}
        </span>
        <span className="font-mono text-[10px] text-red-500">
          -{diff.deletions}
        </span>
      </button>

      {/* Diff content */}
      {expanded && (
        <div className="border-zinc-800 border-t">
          {diff.hunks.map((hunk, _hunkIdx) => (
            <div key={`hunk-${hunk.startLine}`}>
              {/* Hunk header */}
              <div className="bg-zinc-900/50 px-3 py-1 font-mono text-[10px] text-zinc-600">
                @@ -{hunk.startLine} @@
              </div>
              {/* Lines */}
              {hunk.lines.map((line) => (
                <div key={`${line.lineNumber}-${line.type}`}>
                  <div
                    className={`flex font-mono text-xs ${getDiffLineBackground(
                      line.type
                    )} ${onInlineComment ? "cursor-pointer hover:bg-violet-500/5" : ""}`}
                    onClick={() => handleLineClick(line.lineNumber)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        handleLineClick(line.lineNumber);
                      }
                    }}
                    role={onInlineComment ? "button" : undefined}
                    tabIndex={onInlineComment ? 0 : undefined}
                  >
                    <span className="w-12 shrink-0 select-none px-2 py-0.5 text-right text-zinc-600">
                      {line.lineNumber}
                    </span>
                    <span className="w-5 shrink-0 select-none py-0.5 text-center">
                      {line.type === "addition" && (
                        <span className="text-green-500">+</span>
                      )}
                      {line.type === "deletion" && (
                        <span className="text-red-500">-</span>
                      )}
                    </span>
                    <span
                      className={`flex-1 whitespace-pre-wrap py-0.5 pr-3 ${getDiffLineColor(
                        line.type
                      )}`}
                    >
                      {line.content}
                    </span>
                  </div>

                  {/* Inline comment form */}
                  {commentingLine === line.lineNumber && (
                    <InlineCommentForm
                      lineNumber={line.lineNumber}
                      onCancel={() => setCommentingLine(null)}
                      onSubmit={handleCommentSubmit}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Comment Thread with severity, replies, resolve                             */
/* -------------------------------------------------------------------------- */

function CommentThread({
  comments,
  onReply,
  onResolve,
}: {
  comments: ReviewComment[];
  onReply?: (content: string) => void;
  onResolve?: (commentId: string, resolved: boolean) => void;
}) {
  const [replyText, setReplyText] = useState("");
  const [showReply, setShowReply] = useState(false);

  function handleSubmitReply() {
    if (replyText.trim()) {
      onReply?.(replyText.trim());
      setReplyText("");
      setShowReply(false);
    }
  }

  return (
    <div className="space-y-2">
      {comments.map((comment) => {
        const severityConfig = comment.severity
          ? SEVERITY_CONFIG[comment.severity]
          : undefined;

        return (
          <div key={comment.id}>
            <div
              className={`rounded-lg border p-3 ${
                comment.resolved
                  ? "border-green-500/20 bg-green-500/5"
                  : "border-zinc-800 bg-zinc-900/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 font-medium text-[10px] text-violet-400">
                    {comment.author.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-xs text-zinc-300">
                    {comment.author}
                  </span>
                  {comment.lineNumber && (
                    <span className="font-mono text-[10px] text-zinc-600">
                      L{comment.lineNumber}
                      {comment.lineNumberEnd
                        ? `-L${comment.lineNumberEnd}`
                        : ""}
                    </span>
                  )}
                  {severityConfig && (
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium text-[9px] ${severityConfig.bg} ${severityConfig.color}`}
                    >
                      {severityConfig.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {comment.resolved ? (
                    <button
                      className="text-[10px] text-green-400 hover:text-green-300"
                      onClick={() => onResolve?.(comment.id, false)}
                      type="button"
                    >
                      Unresolve
                    </button>
                  ) : (
                    onResolve && (
                      <button
                        className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        onClick={() => onResolve(comment.id, true)}
                        type="button"
                      >
                        Resolve
                      </button>
                    )
                  )}
                  {comment.resolved && (
                    <Badge variant="success">Resolved</Badge>
                  )}
                  <span className="text-[10px] text-zinc-600">
                    {new Date(comment.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-sm text-zinc-400">{comment.content}</p>

              {/* Code suggestion block */}
              {comment.codeSuggestion && (
                <div className="mt-2 rounded-md border border-green-500/20 bg-green-500/5 p-2">
                  <div className="mb-1 font-medium text-[10px] text-green-400">
                    Suggested change:
                  </div>
                  <pre className="font-mono text-green-300 text-xs">
                    {comment.codeSuggestion}
                  </pre>
                </div>
              )}

              {/* Thread replies */}
              {comment.replies && comment.replies.length > 0 && (
                <div className="mt-3 space-y-2 border-zinc-700 border-l-2 pl-3">
                  {comment.replies.map((reply) => (
                    <div className="rounded bg-zinc-800/50 p-2" key={reply.id}>
                      <div className="flex items-center gap-2">
                        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-500/20 font-medium text-[8px] text-violet-400">
                          {reply.author.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-[10px] text-zinc-300">
                          {reply.author}
                        </span>
                        <span className="text-[9px] text-zinc-600">
                          {new Date(reply.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {reply.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Reply input */}
      {showReply ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <textarea
            className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            rows={3}
            value={replyText}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              onClick={() => {
                setShowReply(false);
                setReplyText("");
              }}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={!replyText.trim()}
              onClick={handleSubmitReply}
              size="sm"
            >
              Reply
            </Button>
          </div>
        </div>
      ) : (
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          onClick={() => setShowReply(true)}
          type="button"
        >
          <MessageSquare className="h-3 w-3" />
          Reply
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Review Submit Form                                                         */
/* -------------------------------------------------------------------------- */

function ReviewSubmitForm({
  onSubmit,
  reviewId,
}: {
  onSubmit: (reviewId: string, verdict: ReviewVerdict, body: string) => void;
  reviewId: string;
}) {
  const [verdict, setVerdict] = useState<ReviewVerdict>("comment");
  const [body, setBody] = useState("");

  function handleSubmit() {
    onSubmit(reviewId, verdict, body.trim());
    setBody("");
    setVerdict("comment");
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h4 className="font-medium text-sm text-zinc-300">Submit Review</h4>

      <textarea
        className="mt-3 w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment on this review..."
        rows={3}
        value={body}
      />

      <div className="mt-3 flex items-center gap-3">
        {/* Verdict buttons */}
        <div className="flex items-center gap-1">
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
              verdict === "approve"
                ? "bg-green-500/20 font-medium text-green-400"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
            onClick={() => setVerdict("approve")}
            type="button"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Approve
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
              verdict === "request_changes"
                ? "bg-red-500/20 font-medium text-red-400"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
            onClick={() => setVerdict("request_changes")}
            type="button"
          >
            <XCircle className="h-3.5 w-3.5" />
            Request Changes
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
              verdict === "comment"
                ? "bg-zinc-700/50 font-medium text-zinc-300"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
            onClick={() => setVerdict("comment")}
            type="button"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Comment
          </button>
        </div>

        <div className="ml-auto">
          <Button onClick={handleSubmit} size="sm">
            Submit Review
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Review Card                                                                */
/* -------------------------------------------------------------------------- */

function ReviewCard({
  onApprove,
  onComment,
  onInlineComment,
  onRequestChanges,
  onResolveComment,
  onSubmitReview,
  review,
}: {
  onApprove?: (reviewId: string) => void;
  onComment?: (reviewId: string, comment: string) => void;
  onInlineComment?: (
    reviewId: string,
    filePath: string,
    lineNumber: number,
    comment: InlineCommentPayload
  ) => void;
  onRequestChanges?: (reviewId: string) => void;
  onResolveComment?: (
    reviewId: string,
    commentId: string,
    resolved: boolean
  ) => void;
  onSubmitReview?: (
    reviewId: string,
    verdict: ReviewVerdict,
    body: string
  ) => void;
  review: PendingReview;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusConfig = STATUS_CONFIG[review.status] ??
    STATUS_CONFIG.pending ?? {
      icon: CircleDot,
      color: "text-zinc-400",
      label: review.status,
      variant: "default" as const,
    };
  const StatusIcon = statusConfig.icon;

  const totalAdditions = review.diffs.reduce((s, d) => s + d.additions, 0);
  const totalDeletions = review.diffs.reduce((s, d) => s + d.deletions, 0);
  const unresolvedComments = review.comments.filter((c) => !c.resolved).length;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700">
      {/* Header */}
      <button
        className="flex w-full items-center gap-3 p-4 text-left"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <StatusIcon className={`h-4 w-4 shrink-0 ${statusConfig.color}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-sm text-zinc-200">
              {review.title}
            </span>
            <Badge variant={statusConfig?.variant ?? "default"}>
              {statusConfig?.label ?? review.status}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
            <span>{review.author}</span>
            <span>
              {review.diffs.length} file{review.diffs.length === 1 ? "" : "s"}
            </span>
            <span className="font-mono text-green-500/70">
              +{totalAdditions}
            </span>
            <span className="font-mono text-red-500/70">-{totalDeletions}</span>
            {unresolvedComments > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <MessageSquare className="h-3 w-3" />
                {unresolvedComments}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-zinc-600">
          {new Date(review.updatedAt).toLocaleDateString()}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-zinc-800 border-t px-4 pt-3 pb-4">
          {review.description && (
            <p className="mb-4 text-sm text-zinc-400">{review.description}</p>
          )}

          {/* Diffs with inline commenting */}
          <div className="space-y-2">
            <h4 className="font-medium text-xs text-zinc-500 uppercase tracking-wider">
              Changed Files
            </h4>
            {review.diffs.map((diff) => (
              <InlineDiffViewer
                diff={diff}
                key={diff.path}
                onInlineComment={
                  onInlineComment
                    ? (filePath, lineNumber, comment) =>
                        onInlineComment(
                          review.id,
                          filePath,
                          lineNumber,
                          comment
                        )
                    : undefined
                }
              />
            ))}
          </div>

          {/* Comments */}
          {review.comments.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="font-medium text-xs text-zinc-500 uppercase tracking-wider">
                Comments ({review.comments.length})
              </h4>
              <CommentThread
                comments={review.comments}
                onReply={
                  onComment
                    ? (content) => onComment(review.id, content)
                    : undefined
                }
                onResolve={
                  onResolveComment
                    ? (commentId, resolved) =>
                        onResolveComment(review.id, commentId, resolved)
                    : undefined
                }
              />
            </div>
          )}

          {/* Review submit form */}
          {review.status === "pending" && onSubmitReview && (
            <div className="mt-4 border-zinc-800 border-t pt-4">
              <ReviewSubmitForm
                onSubmit={onSubmitReview}
                reviewId={review.id}
              />
            </div>
          )}

          {/* Legacy actions (if no submit form) */}
          {review.status === "pending" && !onSubmitReview && (
            <div className="mt-4 flex items-center gap-2 border-zinc-800 border-t pt-4">
              {onApprove && (
                <Button
                  onClick={() => onApprove(review.id)}
                  size="sm"
                  variant="outline"
                >
                  <CheckCircle className="mr-1.5 h-3.5 w-3.5 text-green-500" />
                  Approve
                </Button>
              )}
              {onRequestChanges && (
                <Button
                  onClick={() => onRequestChanges(review.id)}
                  size="sm"
                  variant="outline"
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5 text-red-500" />
                  Request Changes
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Dashboard                                                             */
/* -------------------------------------------------------------------------- */

export function ReviewDashboard({
  reviews,
  onApprove,
  onComment,
  onInlineComment,
  onRequestChanges,
  onResolveComment,
  onSubmitReview,
}: ReviewDashboardProps) {
  const pendingCount = reviews.filter((r) => r.status === "pending").length;
  const approvedCount = reviews.filter((r) => r.status === "approved").length;
  const changesCount = reviews.filter(
    (r) => r.status === "changes_requested"
  ).length;

  const [filter, setFilter] = useState<string>("all");

  const filteredReviews =
    filter === "all" ? reviews : reviews.filter((r) => r.status === filter);

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm text-zinc-300">
          <Clock className="h-4 w-4 text-yellow-500" />
          <span className="font-medium">{pendingCount}</span>
          <span className="text-zinc-500">pending</span>
        </div>
        <div className="h-4 w-px bg-zinc-700" />
        <div className="flex items-center gap-1.5 text-sm text-zinc-300">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="font-medium">{approvedCount}</span>
          <span className="text-zinc-500">approved</span>
        </div>
        <div className="h-4 w-px bg-zinc-700" />
        <div className="flex items-center gap-1.5 text-sm text-zinc-300">
          <XCircle className="h-4 w-4 text-red-500" />
          <span className="font-medium">{changesCount}</span>
          <span className="text-zinc-500">changes requested</span>
        </div>

        {/* Filter */}
        <div className="ml-auto flex items-center gap-1">
          {["all", "pending", "approved", "changes_requested"].map((f) => (
            <button
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                filter === f
                  ? "bg-zinc-800 font-medium text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={f}
              onClick={() => setFilter(f)}
              type="button"
            >
              {formatFilterLabel(f)}
            </button>
          ))}
        </div>
      </div>

      {/* Review list */}
      {filteredReviews.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center">
          <CheckCircle className="mx-auto h-8 w-8 text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500">No reviews to show</p>
          <p className="mt-1 text-xs text-zinc-600">
            {filter === "all"
              ? "All code reviews will appear here"
              : "No reviews match the current filter"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredReviews.map((review) => (
            <ReviewCard
              key={review.id}
              onApprove={onApprove}
              onComment={onComment}
              onInlineComment={onInlineComment}
              onRequestChanges={onRequestChanges}
              onResolveComment={onResolveComment}
              onSubmitReview={onSubmitReview}
              review={review}
            />
          ))}
        </div>
      )}
    </div>
  );
}
