"use client";

function _getDiffLineClass(type: string) {
  if (type === "addition") {
    return "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300";
  }
  if (type === "deletion") {
    return "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300";
  }
  return "";
}

function _getStatusVariant(status: string) {
  if (status === "open") {
    return "default" as const;
  }
  if (status === "merged") {
    return "secondary" as const;
  }
  return "outline" as const;
}

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Separator,
} from "@prometheus/ui";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FileCode,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Send,
  User,
  X,
} from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";

interface FileDiff {
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  content: string;
  number: number;
  type: "addition" | "deletion" | "context";
}

interface Comment {
  author: string;
  content: string;
  file: string | null;
  id: string;
  line: number | null;
  resolved: boolean;
  timestamp: string;
}

const MOCK_FILES: FileDiff[] = [
  {
    path: "src/lib/auth/session.ts",
    additions: 24,
    deletions: 8,
    status: "modified",
    hunks: [
      {
        header: "@@ -42,12 +42,28 @@ export async function validateSession",
        lines: [
          {
            number: 42,
            content: "export async function validateSession(token: string) {",
            type: "context",
          },
          {
            number: 43,
            content: "  const decoded = jwt.verify(token, SECRET);",
            type: "deletion",
          },
          {
            number: 43,
            content: "  const decoded = await jwt.verify(token, SECRET, {",
            type: "addition",
          },
          {
            number: 44,
            content: "    algorithms: ['RS256'],",
            type: "addition",
          },
          { number: 45, content: "    maxAge: '24h',", type: "addition" },
          { number: 46, content: "  });", type: "addition" },
          { number: 47, content: "", type: "context" },
          { number: 48, content: "  if (!decoded.sub) {", type: "context" },
          {
            number: 49,
            content:
              "    throw new AuthError('Invalid token: missing subject');",
            type: "addition",
          },
          {
            number: 50,
            content: "    throw new Error('Invalid token');",
            type: "deletion",
          },
          { number: 51, content: "  }", type: "context" },
          { number: 52, content: "", type: "context" },
          {
            number: 53,
            content: "  // Add rate limiting check",
            type: "addition",
          },
          {
            number: 54,
            content:
              "  const rateLimitResult = await checkRateLimit(decoded.sub);",
            type: "addition",
          },
          {
            number: 55,
            content: "  if (!rateLimitResult.allowed) {",
            type: "addition",
          },
          {
            number: 56,
            content:
              "    throw new RateLimitError(rateLimitResult.retryAfter);",
            type: "addition",
          },
          { number: 57, content: "  }", type: "addition" },
        ],
      },
    ],
  },
  {
    path: "src/middleware/rate-limit.ts",
    additions: 45,
    deletions: 0,
    status: "added",
    hunks: [
      {
        header: "@@ -0,0 +1,45 @@",
        lines: [
          {
            number: 1,
            content: "import { redis } from '../lib/redis';",
            type: "addition",
          },
          {
            number: 2,
            content: "import type { RateLimitResult } from '../types';",
            type: "addition",
          },
          { number: 3, content: "", type: "addition" },
          { number: 4, content: "const WINDOW_MS = 60_000;", type: "addition" },
          { number: 5, content: "const MAX_REQUESTS = 100;", type: "addition" },
          { number: 6, content: "", type: "addition" },
          {
            number: 7,
            content:
              "export async function checkRateLimit(userId: string): Promise<RateLimitResult> {",
            type: "addition",
          },
          {
            number: 8,
            content: "  const key = `rate:$` + `{userId}`;",
            type: "addition",
          },
          {
            number: 9,
            content: "  const current = await redis.incr(key);",
            type: "addition",
          },
          { number: 10, content: "  if (current === 1) {", type: "addition" },
          {
            number: 11,
            content: "    await redis.pexpire(key, WINDOW_MS);",
            type: "addition",
          },
          { number: 12, content: "  }", type: "addition" },
          { number: 13, content: "  return {", type: "addition" },
          {
            number: 14,
            content: "    allowed: current <= MAX_REQUESTS,",
            type: "addition",
          },
          {
            number: 15,
            content: "    remaining: Math.max(0, MAX_REQUESTS - current),",
            type: "addition",
          },
          {
            number: 16,
            content:
              "    retryAfter: current > MAX_REQUESTS ? WINDOW_MS / 1000 : 0,",
            type: "addition",
          },
          { number: 17, content: "  };", type: "addition" },
          { number: 18, content: "}", type: "addition" },
        ],
      },
    ],
  },
  {
    path: "src/types/index.ts",
    additions: 6,
    deletions: 0,
    status: "modified",
    hunks: [
      {
        header: "@@ -89,0 +90,6 @@",
        lines: [
          {
            number: 90,
            content: "export interface RateLimitResult {",
            type: "addition",
          },
          { number: 91, content: "  allowed: boolean;", type: "addition" },
          { number: 92, content: "  remaining: number;", type: "addition" },
          { number: 93, content: "  retryAfter: number;", type: "addition" },
          { number: 94, content: "}", type: "addition" },
        ],
      },
    ],
  },
  {
    path: "src/__tests__/rate-limit.test.ts",
    additions: 38,
    deletions: 0,
    status: "added",
    hunks: [
      {
        header: "@@ -0,0 +1,38 @@",
        lines: [
          {
            number: 1,
            content:
              "import { describe, it, expect, beforeEach } from 'vitest';",
            type: "addition",
          },
          {
            number: 2,
            content:
              "import { checkRateLimit } from '../middleware/rate-limit';",
            type: "addition",
          },
          { number: 3, content: "", type: "addition" },
          {
            number: 4,
            content: "describe('checkRateLimit', () => {",
            type: "addition",
          },
          {
            number: 5,
            content:
              "  it('should allow requests under the limit', async () => {",
            type: "addition",
          },
          {
            number: 6,
            content: "    const result = await checkRateLimit('user-1');",
            type: "addition",
          },
          {
            number: 7,
            content: "    expect(result.allowed).toBe(true);",
            type: "addition",
          },
          { number: 8, content: "  });", type: "addition" },
          { number: 9, content: "});", type: "addition" },
        ],
      },
    ],
  },
];

const MOCK_COMMENTS: Comment[] = [
  {
    id: "cmt-001",
    author: "Sarah Chen",
    content:
      "Great improvement on the JWT verification. The algorithm pinning is important for security.",
    timestamp: "2026-03-26T10:30:00Z",
    file: null,
    line: null,
    resolved: false,
  },
  {
    id: "cmt-002",
    author: "Alex Kim",
    content:
      "Should we add a configurable max age instead of hardcoding 24h? Different endpoints might need different session durations.",
    timestamp: "2026-03-26T11:15:00Z",
    file: "src/lib/auth/session.ts",
    line: 45,
    resolved: false,
  },
  {
    id: "cmt-003",
    author: "Maria Lopez",
    content:
      "The rate limiting looks good. One suggestion: consider using a sliding window algorithm instead of fixed window for smoother rate limiting.",
    timestamp: "2026-03-26T12:00:00Z",
    file: "src/middleware/rate-limit.ts",
    line: 7,
    resolved: true,
  },
  {
    id: "cmt-004",
    author: "James Wilson",
    content:
      "We should add integration tests for the rate limit behavior under concurrent requests. The unit test is a good start though.",
    timestamp: "2026-03-26T13:45:00Z",
    file: "src/__tests__/rate-limit.test.ts",
    line: 5,
    resolved: false,
  },
];

const FILE_STATUS_COLORS: Record<string, string> = {
  added: "text-green-500",
  modified: "text-amber-500",
  deleted: "text-red-500",
  renamed: "text-blue-500",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDiffLineClass(type: DiffLine["type"]): string {
  if (type === "addition") {
    return "bg-green-500/10 text-green-400";
  }
  if (type === "deletion") {
    return "bg-red-500/10 text-red-400";
  }
  return "text-muted-foreground";
}

function getDiffLinePrefix(type: DiffLine["type"]): string {
  if (type === "addition") {
    return "+";
  }
  if (type === "deletion") {
    return "-";
  }
  return " ";
}

export default function PrDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; prNumber: string }>;
}) {
  const { projectId: _projectId, prNumber } = use(params);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    new Set(MOCK_FILES.map((f) => f.path))
  );
  const [comments, setComments] = useState<Comment[]>(MOCK_COMMENTS);
  const [newComment, setNewComment] = useState("");
  const [_selectedFile, _setSelectedFile] = useState<string | null>(null);

  const totalAdditions = MOCK_FILES.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = MOCK_FILES.reduce((acc, f) => acc + f.deletions, 0);
  const unresolvedComments = comments.filter((c) => !c.resolved).length;

  function toggleFile(path: string) {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function handleAddComment() {
    if (!newComment.trim()) {
      return;
    }
    const comment: Comment = {
      id: `cmt-${String(Date.now())}`,
      author: "You",
      content: newComment.trim(),
      timestamp: new Date().toISOString(),
      file: null,
      line: null,
      resolved: false,
    };
    setComments((prev) => [...prev, comment]);
    setNewComment("");
    toast.success("Comment added");
  }

  function handleApprove() {
    toast.success(`PR #${prNumber} approved`);
  }

  function handleRequestChanges() {
    toast.info(`Changes requested on PR #${prNumber}`);
  }

  function handleResolveComment(commentId: string) {
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c))
    );
    toast.success("Comment resolved");
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <GitPullRequest className="h-6 w-6 text-green-500" />
          <h1 className="font-bold text-2xl text-foreground">
            Add rate limiting and improve JWT validation
          </h1>
          <Badge variant="default">Open</Badge>
        </div>
        <p className="mt-2 text-muted-foreground text-sm">
          #{prNumber} opened by{" "}
          <span className="font-medium text-foreground">James Wilson</span> 2
          hours ago
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
              feat/rate-limiting
            </span>
            <span className="text-muted-foreground">into</span>
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
              main
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileCode className="h-4 w-4" />
            {MOCK_FILES.length} files changed
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-green-500 text-xs">
              +{totalAdditions}
            </span>
            <span className="font-mono text-red-500 text-xs">
              -{totalDeletions}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            {comments.length} comments ({unresolvedComments} unresolved)
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-muted-foreground text-sm">
                  This PR adds rate limiting to the authentication flow and
                  improves JWT validation security.
                </p>
                <ul className="mt-2 space-y-1 text-muted-foreground text-sm">
                  <li>
                    Pin JWT algorithm to RS256 to prevent algorithm substitution
                    attacks
                  </li>
                  <li>Add max age validation (24h) to prevent token reuse</li>
                  <li>
                    Implement Redis-based rate limiting (100 req/min per user)
                  </li>
                  <li>Add custom error types (AuthError, RateLimitError)</li>
                  <li>Add unit tests for rate limiting</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {MOCK_FILES.map((file) => {
            const isExpanded = expandedFiles.has(file.path);
            const statusColor =
              FILE_STATUS_COLORS[file.status] ?? "text-muted-foreground";
            return (
              <Card key={file.path}>
                <button
                  className="flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-muted/50"
                  onClick={() => toggleFile(file.path)}
                  type="button"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <FileCode className={`h-4 w-4 shrink-0 ${statusColor}`} />
                  <span className="flex-1 font-mono text-sm">{file.path}</span>
                  <Badge className="text-xs capitalize" variant="outline">
                    {file.status}
                  </Badge>
                  <span className="font-mono text-green-500 text-xs">
                    +{file.additions}
                  </span>
                  <span className="font-mono text-red-500 text-xs">
                    -{file.deletions}
                  </span>
                </button>
                {isExpanded && (
                  <div className="overflow-x-auto">
                    {file.hunks.map((hunk, hi) => (
                      <div key={hunk.header}>
                        <div className="bg-blue-500/10 px-4 py-1 font-mono text-blue-400 text-xs">
                          {hunk.header}
                        </div>
                        {hunk.lines.map((line, li) => (
                          <div
                            className={`flex font-mono text-xs ${getDiffLineClass(line.type)}`}
                            key={`${String(hi)}-${String(li)}`}
                          >
                            <span className="w-12 shrink-0 select-none px-3 py-0.5 text-right text-muted-foreground">
                              {line.number}
                            </span>
                            <span className="w-4 shrink-0 select-none py-0.5 text-center">
                              {getDiffLinePrefix(line.type)}
                            </span>
                            <span className="flex-1 py-0.5 pr-4">
                              {line.content}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Comments ({comments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {comments.map((comment) => (
                <div
                  className={`rounded-lg border p-4 ${comment.resolved ? "opacity-60" : ""}`}
                  key={comment.id}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-xs">
                        {comment.author.charAt(0)}
                      </div>
                      <span className="font-medium text-sm">
                        {comment.author}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatTimestamp(comment.timestamp)}
                      </span>
                      {comment.file && (
                        <Badge className="text-xs" variant="outline">
                          {comment.file}
                          {comment.line === null ? "" : `:${comment.line}`}
                        </Badge>
                      )}
                    </div>
                    {!comment.resolved && comment.author !== "You" && (
                      <Button
                        onClick={() => handleResolveComment(comment.id)}
                        size="sm"
                        variant="ghost"
                      >
                        <Check className="mr-1 h-3 w-3" />
                        Resolve
                      </Button>
                    )}
                    {comment.resolved && (
                      <Badge className="text-xs" variant="secondary">
                        Resolved
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm">{comment.content}</p>
                </div>
              ))}

              <Separator />
              <div className="flex gap-2">
                <Input
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                  placeholder="Write a comment..."
                  value={newComment}
                />
                <Button
                  disabled={!newComment.trim()}
                  onClick={handleAddComment}
                >
                  <Send className="mr-1 h-4 w-4" />
                  Comment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full"
                onClick={handleApprove}
                variant="default"
              >
                <Check className="mr-2 h-4 w-4" />
                Approve
              </Button>
              <Button
                className="w-full"
                onClick={handleRequestChanges}
                variant="outline"
              >
                <X className="mr-2 h-4 w-4" />
                Request Changes
              </Button>
              <Button
                className="w-full"
                onClick={handleAddComment}
                variant="ghost"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Comment Only
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Author</span>
                <div className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  James Wilson
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="default">Open</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Created</span>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Mar 26, 2:00 PM
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Labels</span>
                <div className="flex gap-1">
                  <Badge className="text-xs" variant="secondary">
                    security
                  </Badge>
                  <Badge className="text-xs" variant="secondary">
                    enhancement
                  </Badge>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Reviewers</span>
                <span>Sarah Chen, Alex Kim</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Changed Files</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {MOCK_FILES.map((file) => {
                  const statusColor =
                    FILE_STATUS_COLORS[file.status] ?? "text-muted-foreground";
                  return (
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      key={file.path}
                      onClick={() => {
                        setExpandedFiles((prev) => {
                          const next = new Set(prev);
                          next.add(file.path);
                          return next;
                        });
                      }}
                      type="button"
                    >
                      <FileCode
                        className={`h-3.5 w-3.5 shrink-0 ${statusColor}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {file.path}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
