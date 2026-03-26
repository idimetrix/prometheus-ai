"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorTab } from "@/components/editor/editor-tabs";
import type { FileTreeNode } from "@/components/editor/file-tree";
import { trpc } from "@/lib/trpc";
import { useSocket } from "./use-socket";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface FileContent {
  content: string;
  language?: string;
  path: string;
}

interface UseFileSystemReturn {
  /** Currently active file path */
  activeFile: string | null;
  /** Close a file tab */
  closeFile: (path: string) => void;
  /** Create a new file in the sandbox */
  createFile: (path: string) => Promise<void>;
  /** Delete a file from the sandbox */
  deleteFile: (path: string) => Promise<void>;
  /** The file tree structure */
  fileTree: FileTreeNode[];
  /** Whether the file tree is loading */
  isLoading: boolean;
  /** List directory contents */
  listDirectory: (path: string) => Promise<void>;
  /** Set of paths that have been modified locally */
  modifiedFiles: Set<string>;
  /** Open a file in the editor */
  openFile: (path: string) => Promise<void>;
  /** Currently open file tabs */
  openFiles: EditorTab[];
  /** Read a file's content */
  readFile: (path: string) => Promise<FileContent | null>;
  /** Rename/move a file */
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  /** Set the active file */
  setActiveFile: (path: string) => void;
  /** Update file content locally (triggers debounced save) */
  updateFileContent: (path: string, content: string) => void;
  /** Write file content to the sandbox */
  writeFile: (path: string, content: string) => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Debounce helper                                                            */
/* -------------------------------------------------------------------------- */

function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const debouncedFn = useCallback(
    (...args: unknown[]) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  ) as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedFn;
}

/* -------------------------------------------------------------------------- */
/*  Hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useFileSystem(sandboxId: string): UseFileSystemReturn {
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());
  const [fileContents, setFileContents] = useState<Map<string, string>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(true);

  // Socket connection for real-time file updates
  const { on, isConnected } = useSocket(`sandbox:${sandboxId}`);

  // tRPC mutations
  const fileReadMutation = trpc.files.read.useMutation();
  const fileWriteMutation = trpc.files.write.useMutation();
  const fileListMutation = trpc.files.list.useMutation();
  const fileCreateMutation = trpc.files.create.useMutation();
  const fileDeleteMutation = trpc.files.delete.useMutation();
  const fileRenameMutation = trpc.files.rename.useMutation();

  // Build open files tabs list
  const openFiles: EditorTab[] = openFilePaths.map((path) => ({
    path,
    name: path.split("/").pop() ?? path,
    isModified: modifiedFiles.has(path),
  }));

  /* ──────────────── List directory ──────────────── */

  const listDirectory = useCallback(
    async (path: string) => {
      try {
        const result = await fileListMutation.mutateAsync({
          sandboxId,
          path,
        });
        if (result.tree) {
          setFileTree(result.tree as FileTreeNode[]);
        }
      } catch {
        // Silently fail - tree stays as-is
      }
    },
    [sandboxId, fileListMutation]
  );

  /* ──────────────── Read file ──────────────── */

  const readFile = useCallback(
    async (path: string): Promise<FileContent | null> => {
      // Check local cache first
      const cached = fileContents.get(path);
      if (cached !== undefined) {
        return { path, content: cached };
      }

      try {
        const result = await fileReadMutation.mutateAsync({
          sandboxId,
          path,
        });
        const content = result.content ?? "";
        setFileContents((prev) => {
          const next = new Map(prev);
          next.set(path, content);
          return next;
        });
        return { path, content, language: result.language };
      } catch {
        return null;
      }
    },
    [sandboxId, fileReadMutation, fileContents]
  );

  /* ──────────────── Write file ──────────────── */

  const writeFile = useCallback(
    async (path: string, content: string) => {
      try {
        await fileWriteMutation.mutateAsync({
          sandboxId,
          path,
          content,
        });
        // Clear modified state after successful save
        setModifiedFiles((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      } catch {
        // Write failed, keep modified state
      }
    },
    [sandboxId, fileWriteMutation]
  );

  /* ──────────────── Debounced save ──────────────── */

  const debouncedSave = useDebouncedCallback(async (...args: unknown[]) => {
    const path = args[0] as string;
    const content = args[1] as string;
    await writeFile(path, content);
  }, 1500);

  /* ──────────────── Update file content ──────────────── */

  const updateFileContent = useCallback(
    (path: string, content: string) => {
      setFileContents((prev) => {
        const next = new Map(prev);
        next.set(path, content);
        return next;
      });
      setModifiedFiles((prev) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      debouncedSave(path, content);
    },
    [debouncedSave]
  );

  /* ──────────────── Open file ──────────────── */

  const openFile = useCallback(
    async (path: string) => {
      // Add to open files if not already there
      setOpenFilePaths((prev) => {
        if (prev.includes(path)) {
          return prev;
        }
        return [...prev, path];
      });
      setActiveFile(path);

      // Fetch content if not cached
      if (!fileContents.has(path)) {
        await readFile(path);
      }
    },
    [fileContents, readFile]
  );

  /* ──────────────── Close file ──────────────── */

  const closeFile = useCallback(
    (path: string) => {
      setOpenFilePaths((prev) => {
        const next = prev.filter((p) => p !== path);
        // If we closed the active file, switch to another
        if (activeFile === path) {
          const idx = prev.indexOf(path);
          const newActive = next[Math.min(idx, next.length - 1)] ?? null;
          setActiveFile(newActive);
        }
        return next;
      });
    },
    [activeFile]
  );

  /* ──────────────── Create file ──────────────── */

  const createFile = useCallback(
    async (path: string) => {
      try {
        await fileCreateMutation.mutateAsync({
          sandboxId,
          path,
        });
        await listDirectory("/");
        await openFile(path);
      } catch {
        // Failed to create
      }
    },
    [sandboxId, fileCreateMutation, listDirectory, openFile]
  );

  /* ──────────────── Delete file ──────────────── */

  const deleteFile = useCallback(
    async (path: string) => {
      try {
        await fileDeleteMutation.mutateAsync({
          sandboxId,
          path,
        });
        // Close if open
        closeFile(path);
        // Remove from contents cache
        setFileContents((prev) => {
          const next = new Map(prev);
          next.delete(path);
          return next;
        });
        await listDirectory("/");
      } catch {
        // Failed to delete
      }
    },
    [sandboxId, fileDeleteMutation, closeFile, listDirectory]
  );

  /* ──────────────── Rename file ──────────────── */

  const renameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      try {
        await fileRenameMutation.mutateAsync({
          sandboxId,
          oldPath,
          newPath,
        });
        // Update open files
        setOpenFilePaths((prev) =>
          prev.map((p) => (p === oldPath ? newPath : p))
        );
        if (activeFile === oldPath) {
          setActiveFile(newPath);
        }
        // Move cached content
        setFileContents((prev) => {
          const next = new Map(prev);
          const content = next.get(oldPath);
          if (content !== undefined) {
            next.delete(oldPath);
            next.set(newPath, content);
          }
          return next;
        });
        await listDirectory("/");
      } catch {
        // Failed to rename
      }
    },
    [sandboxId, fileRenameMutation, activeFile, listDirectory]
  );

  /* ──────────────── Initial load ──────────────── */

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const result = await fileListMutation.mutateAsync({
          sandboxId,
          path: "/",
        });
        if (!cancelled && result.tree) {
          setFileTree(result.tree as FileTreeNode[]);
        }
      } catch {
        // Failed to load
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // Only run on mount / sandboxId change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxId, fileListMutation.mutateAsync]);

  /* ──────────────── Socket events for real-time updates ──────────────── */

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    // File changed by agent
    const unsubFileChanged = on("file:changed", (...args: unknown[]) => {
      const data = args[0] as { path?: string; content?: string } | undefined;
      if (data?.path && data?.content) {
        setFileContents((prev) => {
          const next = new Map(prev);
          next.set(data.path as string, data.content as string);
          return next;
        });
      }
    });

    // File created by agent
    const unsubFileCreated = on("file:created", () => {
      // Refresh tree
      listDirectory("/");
    });

    // File deleted by agent
    const unsubFileDeleted = on("file:deleted", (...args: unknown[]) => {
      const data = args[0] as { path?: string } | undefined;
      if (data?.path) {
        setFileContents((prev) => {
          const next = new Map(prev);
          next.delete(data.path as string);
          return next;
        });
        listDirectory("/");
      }
    });

    // Tree refresh event
    const unsubTreeRefresh = on("files:refresh", () => {
      listDirectory("/");
    });

    return () => {
      unsubFileChanged();
      unsubFileCreated();
      unsubFileDeleted();
      unsubTreeRefresh();
    };
  }, [isConnected, on, listDirectory]);

  return {
    fileTree,
    openFiles,
    activeFile,
    modifiedFiles,
    isLoading,
    readFile,
    writeFile,
    createFile,
    deleteFile,
    renameFile,
    listDirectory,
    openFile,
    closeFile,
    setActiveFile,
    updateFileContent,
  };
}
