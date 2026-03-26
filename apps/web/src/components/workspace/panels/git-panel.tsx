"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileStatus = "staged" | "unstaged" | "untracked";

interface GitFile {
  path: string;
  status: FileStatus;
  type: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

interface BranchInfo {
  ahead: number;
  behind: number;
  branches: string[];
  current: string;
}

interface GitPanelProps {
  className?: string;
  onViewDiff?: (filePath: string) => void;
  sandboxId: string;
}

interface GitStatusResponse {
  ahead?: number;
  behind?: number;
  branch?: string;
  branches?: string[];
  files: GitFile[];
  stashes?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<GitFile["type"], string> = {
  added: "+",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "?",
};

const STATUS_COLORS: Record<GitFile["type"], string> = {
  added: "text-green-400",
  modified: "text-yellow-400",
  deleted: "text-red-400",
  renamed: "text-blue-400",
  untracked: "text-zinc-500",
};

const SANDBOX_API_BASE = "/api/sandbox";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function gitApi<T = unknown>(
  sandboxId: string,
  action: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${SANDBOX_API_BASE}/${sandboxId}/git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  if (!response.ok) {
    throw new Error(`Git ${action} failed`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GitPanel({ className, sandboxId, onViewDiff }: GitPanelProps) {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [branch, setBranch] = useState<BranchInfo>({
    current: "main",
    branches: [],
    ahead: 0,
    behind: 0,
  });
  const [commitMessage, setCommitMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showStash, setShowStash] = useState(false);
  const [stashList, setStashList] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await gitApi<GitStatusResponse>(sandboxId, "status");
      setFiles(data.files);
      setBranch({
        current: data.branch ?? "main",
        branches: data.branches ?? [],
        ahead: data.ahead ?? 0,
        behind: data.behind ?? 0,
      });
      setStashList(data.stashes ?? []);
    } catch {
      // Silent -- polling will retry
    }
  }, [sandboxId]);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 5000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [fetchStatus]);

  const stagedFiles = files.filter((f) => f.status === "staged");
  const unstagedFiles = files.filter((f) => f.status === "unstaged");
  const untrackedFiles = files.filter((f) => f.status === "untracked");

  const handleStage = useCallback(
    async (path: string) => {
      try {
        await gitApi(sandboxId, "stage", { paths: [path] });
        await fetchStatus();
      } catch {
        toast.error("Failed to stage file");
      }
    },
    [sandboxId, fetchStatus]
  );

  const handleUnstage = useCallback(
    async (path: string) => {
      try {
        await gitApi(sandboxId, "unstage", { paths: [path] });
        await fetchStatus();
      } catch {
        toast.error("Failed to unstage file");
      }
    },
    [sandboxId, fetchStatus]
  );

  const handleStageAll = useCallback(async () => {
    const paths = [...unstagedFiles, ...untrackedFiles].map((f) => f.path);
    if (paths.length === 0) {
      return;
    }
    try {
      await gitApi(sandboxId, "stage", { paths });
      await fetchStatus();
    } catch {
      toast.error("Failed to stage files");
    }
  }, [sandboxId, unstagedFiles, untrackedFiles, fetchStatus]);

  const handleUnstageAll = useCallback(async () => {
    const paths = stagedFiles.map((f) => f.path);
    if (paths.length === 0) {
      return;
    }
    try {
      await gitApi(sandboxId, "unstage", { paths });
      await fetchStatus();
    } catch {
      toast.error("Failed to unstage files");
    }
  }, [sandboxId, stagedFiles, fetchStatus]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || stagedFiles.length === 0) {
      return;
    }
    setIsLoading(true);
    try {
      await gitApi(sandboxId, "commit", { message: commitMessage.trim() });
      setCommitMessage("");
      await fetchStatus();
      toast.success("Changes committed");
    } catch {
      toast.error("Commit failed");
    } finally {
      setIsLoading(false);
    }
  }, [sandboxId, commitMessage, stagedFiles, fetchStatus]);

  const handlePush = useCallback(async () => {
    setIsLoading(true);
    try {
      await gitApi(sandboxId, "push");
      await fetchStatus();
      toast.success("Pushed to remote");
    } catch {
      toast.error("Push failed");
    } finally {
      setIsLoading(false);
    }
  }, [sandboxId, fetchStatus]);

  const handlePull = useCallback(async () => {
    setIsLoading(true);
    try {
      await gitApi(sandboxId, "pull");
      await fetchStatus();
      toast.success("Pulled from remote");
    } catch {
      toast.error("Pull failed");
    } finally {
      setIsLoading(false);
    }
  }, [sandboxId, fetchStatus]);

  const handleBranchChange = useCallback(
    async (branchName: string) => {
      setIsLoading(true);
      try {
        await gitApi(sandboxId, "checkout", { branch: branchName });
        await fetchStatus();
      } catch {
        toast.error("Failed to switch branch");
      } finally {
        setIsLoading(false);
      }
    },
    [sandboxId, fetchStatus]
  );

  const handleStash = useCallback(async () => {
    try {
      await gitApi(sandboxId, "stash", { stashAction: "push" });
      await fetchStatus();
      toast.success("Changes stashed");
    } catch {
      toast.error("Failed to stash changes");
    }
  }, [sandboxId, fetchStatus]);

  const handleStashPop = useCallback(async () => {
    try {
      await gitApi(sandboxId, "stash", { stashAction: "pop" });
      await fetchStatus();
      toast.success("Stash applied");
    } catch {
      toast.error("Failed to pop stash");
    }
  }, [sandboxId, fetchStatus]);

  const handleCommitKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit]
  );

  return (
    <div className={`flex h-full flex-col overflow-hidden ${className ?? ""}`}>
      {/* Branch header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-zinc-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.03a4.5 4.5 0 0 0-1.242-7.244l-4.5-4.5a4.5 4.5 0 0 0-6.364 6.364L4.757 8.96"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <select
          aria-label="Current branch"
          className="flex-1 truncate rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-pink-500"
          onChange={(e) => handleBranchChange(e.target.value)}
          value={branch.current}
        >
          {branch.branches.length > 0 ? (
            branch.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))
          ) : (
            <option value={branch.current}>{branch.current}</option>
          )}
        </select>

        {/* Push / Pull */}
        <div className="flex items-center gap-1">
          <button
            aria-label={`Pull from remote${branch.behind > 0 ? ` (${branch.behind} behind)` : ""}`}
            className="relative rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
            disabled={isLoading}
            onClick={handlePull}
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
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {branch.behind > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white">
                {branch.behind}
              </span>
            )}
          </button>

          <button
            aria-label={`Push to remote${branch.ahead > 0 ? ` (${branch.ahead} ahead)` : ""}`}
            className="relative rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
            disabled={isLoading}
            onClick={handlePush}
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
                d="M5 10l7-7m0 0l7 7m-7-7v18"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {branch.ahead > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 text-[8px] text-white">
                {branch.ahead}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto">
        {/* Staged changes */}
        <FileSection
          emptyText="No staged changes"
          files={stagedFiles}
          onAction={handleUnstage}
          onBulkAction={handleUnstageAll}
          onViewDiff={onViewDiff}
          sectionAction="unstage"
          title="Staged Changes"
        />

        {/* Unstaged changes */}
        <FileSection
          files={unstagedFiles}
          onAction={handleStage}
          onBulkAction={handleStageAll}
          onViewDiff={onViewDiff}
          sectionAction="stage"
          title="Changes"
        />

        {/* Untracked files */}
        {untrackedFiles.length > 0 && (
          <FileSection
            files={untrackedFiles}
            onAction={handleStage}
            onViewDiff={onViewDiff}
            sectionAction="stage"
            title="Untracked"
          />
        )}

        {/* Stash section */}
        <div className="border-zinc-800 border-t">
          <button
            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            onClick={() => setShowStash((prev) => !prev)}
            type="button"
          >
            <span>Stash ({stashList.length})</span>
            <span className="text-[10px]">{showStash ? "Hide" : "Show"}</span>
          </button>

          {showStash && (
            <div className="px-3 pb-2">
              <div className="flex items-center gap-1 pb-1.5">
                <button
                  className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-50"
                  disabled={files.length === 0}
                  onClick={handleStash}
                  type="button"
                >
                  Stash
                </button>
                <button
                  className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-50"
                  disabled={stashList.length === 0}
                  onClick={handleStashPop}
                  type="button"
                >
                  Pop
                </button>
              </div>
              {stashList.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {stashList.map((entry, i) => (
                    <span
                      className="truncate text-[10px] text-zinc-500"
                      key={entry}
                    >
                      stash@&#123;{i}&#125;: {entry}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[10px] text-zinc-600">No stashes</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Commit input */}
      <div className="border-zinc-800 border-t p-3">
        <textarea
          className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-pink-500"
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleCommitKeyDown}
          placeholder="Commit message (Ctrl+Enter to commit)"
          rows={2}
          value={commitMessage}
        />
        <button
          className="mt-2 w-full rounded-md bg-pink-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-pink-500 disabled:opacity-50 disabled:hover:bg-pink-600"
          disabled={
            !commitMessage.trim() || stagedFiles.length === 0 || isLoading
          }
          onClick={handleCommit}
          type="button"
        >
          {isLoading
            ? "Committing..."
            : `Commit (${stagedFiles.length} file${stagedFiles.length === 1 ? "" : "s"})`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// File Section sub-component
// ---------------------------------------------------------------------------

interface FileSectionProps {
  emptyText?: string;
  files: GitFile[];
  onAction: (path: string) => void;
  onBulkAction?: () => void;
  onViewDiff?: (path: string) => void;
  sectionAction: "stage" | "unstage";
  title: string;
}

function FileSection({
  emptyText,
  files,
  onAction,
  onBulkAction,
  onViewDiff,
  sectionAction,
  title,
}: FileSectionProps) {
  if (files.length === 0 && !emptyText) {
    return null;
  }

  return (
    <div className="border-zinc-800 border-t first:border-t-0">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="font-medium text-xs text-zinc-400">
          {title} ({files.length})
        </span>
        {onBulkAction && files.length > 0 && (
          <button
            className="text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={onBulkAction}
            type="button"
          >
            {sectionAction === "stage" ? "Stage All" : "Unstage All"}
          </button>
        )}
      </div>

      {files.length === 0 && emptyText ? (
        <div className="px-3 pb-2 text-[10px] text-zinc-600">{emptyText}</div>
      ) : (
        <div className="flex flex-col">
          {files.map((file) => (
            <div
              className="group flex items-center gap-1.5 px-3 py-0.5 hover:bg-zinc-800/50"
              key={file.path}
            >
              <span
                className={`w-4 text-center font-mono text-[10px] ${STATUS_COLORS[file.type]}`}
              >
                {STATUS_ICONS[file.type]}
              </span>
              <button
                className="flex-1 truncate text-left text-[11px] text-zinc-300 transition-colors hover:text-zinc-100"
                onClick={() => onViewDiff?.(file.path)}
                type="button"
              >
                {file.path}
              </button>
              <button
                aria-label={`${sectionAction} ${file.path}`}
                className="invisible rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200 group-hover:visible"
                onClick={() => onAction(file.path)}
                type="button"
              >
                {sectionAction === "stage" ? (
                  <svg
                    aria-hidden="true"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12 4.5v15m7.5-7.5h-15"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    aria-hidden="true"
                    className="h-3 w-3"
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
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
