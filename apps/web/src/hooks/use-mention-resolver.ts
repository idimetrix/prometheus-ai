"use client";

import { useCallback, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

// ── Types ───────────────────────────────────────────────────

export type MentionType = "file" | "folder" | "symbol" | "web" | "docs";

export interface MentionSearchResult {
  label: string;
  sublabel?: string;
  type: MentionType;
  value: string;
}

interface UseMentionResolverOptions {
  /** Active project ID to scope searches */
  projectId: string;
  /** Active sandbox ID for file operations */
  sandboxId: string;
}

interface UseMentionResolverReturn {
  /** Clear results */
  clearResults: () => void;
  /** Whether a search is currently in flight */
  isSearching: boolean;
  /** The latest results */
  results: MentionSearchResult[];
  /** Search for documentation/README files */
  searchDocs: (query: string) => void;
  /** Search for file paths */
  searchFiles: (query: string) => void;
  /** Search for folder paths */
  searchFolders: (query: string) => void;
  /** Search for code symbols (functions, classes, types) */
  searchSymbols: (query: string) => void;
  /** Trigger web search query (returns placeholder results) */
  searchWeb: (query: string) => void;
}

// ── Debounce helper ──────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: generic debounce requires flexible args
function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: must match generic T
    (...args: any[]) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  ) as unknown as T;
}

// ── Hook ─────────────────────────────────────────────────────

export function useMentionResolver({
  projectId,
  sandboxId,
}: UseMentionResolverOptions): UseMentionResolverReturn {
  const [results, setResults] = useState<MentionSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const fileListMutation = trpc.files.list.useMutation();

  // Search files in sandbox by listing directory and filtering
  const searchFiles = useCallback(
    (query: string) => {
      if (!sandboxId) {
        setResults([]);
        return;
      }
      setIsSearching(true);

      // List from root and filter client-side
      fileListMutation.mutate(
        { sandboxId, path: "/" },
        {
          onSuccess: (data) => {
            const tree = (data.tree ?? []) as Array<{
              name: string;
              path: string;
              type: string;
            }>;
            const lowerQuery = query.toLowerCase();
            const filtered = tree
              .filter(
                (f) =>
                  f.type === "file" &&
                  (lowerQuery === "" ||
                    f.path.toLowerCase().includes(lowerQuery) ||
                    f.name.toLowerCase().includes(lowerQuery))
              )
              .slice(0, 20)
              .map((f) => ({
                type: "file" as const,
                label: f.path,
                sublabel: "file",
                value: f.path,
              }));
            setResults(filtered);
            setIsSearching(false);
          },
          onError: () => {
            setResults([]);
            setIsSearching(false);
          },
        }
      );
    },
    [sandboxId, fileListMutation]
  );

  const searchFolders = useCallback(
    (query: string) => {
      if (!sandboxId) {
        setResults([]);
        return;
      }
      setIsSearching(true);

      fileListMutation.mutate(
        { sandboxId, path: "/" },
        {
          onSuccess: (data) => {
            const tree = (data.tree ?? []) as Array<{
              name: string;
              path: string;
              type: string;
            }>;
            const lowerQuery = query.toLowerCase();
            const filtered = tree
              .filter(
                (f) =>
                  f.type === "directory" &&
                  (lowerQuery === "" ||
                    f.path.toLowerCase().includes(lowerQuery) ||
                    f.name.toLowerCase().includes(lowerQuery))
              )
              .slice(0, 20)
              .map((f) => ({
                type: "folder" as const,
                label: f.path,
                sublabel: "folder",
                value: f.path,
              }));
            setResults(filtered);
            setIsSearching(false);
          },
          onError: () => {
            setResults([]);
            setIsSearching(false);
          },
        }
      );
    },
    [sandboxId, fileListMutation]
  );

  // Search code symbols via the code analysis graph nodes
  const searchSymbols = useCallback(
    (query: string) => {
      if (!(projectId && query)) {
        setResults([]);
        return;
      }
      setIsSearching(true);

      // Use the brain search endpoint which proxies to project-brain
      const brainUrl =
        typeof window === "undefined"
          ? "http://localhost:4003"
          : `${window.location.protocol}//${window.location.hostname}:4003`;

      fetch(`${brainUrl}/search/symbols`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query, limit: 20 }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = (await res.json()) as {
              symbols: Array<{
                name: string;
                type: string;
                filePath: string;
              }>;
            };
            setResults(
              (data.symbols ?? []).map((s) => ({
                type: "symbol" as const,
                label: s.name,
                sublabel: `${s.type} in ${s.filePath}`,
                value: `${s.filePath}#${s.name}`,
              }))
            );
          } else {
            setResults([]);
          }
        })
        .catch(() => {
          setResults([]);
        })
        .finally(() => {
          setIsSearching(false);
        });
    },
    [projectId]
  );

  // Search documentation/markdown files in the project
  const searchDocs = useCallback(
    (query: string) => {
      if (!sandboxId) {
        setResults([]);
        return;
      }
      setIsSearching(true);

      fileListMutation.mutate(
        { sandboxId, path: "/" },
        {
          onSuccess: (data) => {
            const tree = (data.tree ?? []) as Array<{
              name: string;
              path: string;
              type: string;
            }>;
            const docExtensions = [".md", ".mdx", ".rst", ".txt"];
            const docNames = ["readme", "changelog", "contributing", "license"];
            const lowerQuery = query.toLowerCase();

            const filtered = tree
              .filter((f) => {
                if (f.type !== "file") {
                  return false;
                }
                const lower = f.name.toLowerCase();
                const isDoc =
                  docExtensions.some((ext) => lower.endsWith(ext)) ||
                  docNames.some((name) => lower.startsWith(name));
                if (!isDoc) {
                  return false;
                }
                return (
                  lowerQuery === "" ||
                  f.path.toLowerCase().includes(lowerQuery) ||
                  f.name.toLowerCase().includes(lowerQuery)
                );
              })
              .slice(0, 20)
              .map((f) => ({
                type: "docs" as const,
                label: f.path,
                sublabel: "documentation",
                value: f.path,
              }));
            setResults(filtered);
            setIsSearching(false);
          },
          onError: () => {
            setResults([]);
            setIsSearching(false);
          },
        }
      );
    },
    [sandboxId, fileListMutation]
  );

  // Web search - returns query as a placeholder that will be resolved server-side
  const searchWeb = useCallback((query: string) => {
    if (!query) {
      setResults([]);
      return;
    }
    // Web search is dispatched on selection, just show the query as a single result
    setResults([
      {
        type: "web" as const,
        label: query,
        sublabel: "press Enter to search",
        value: query,
      },
    ]);
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setIsSearching(false);
  }, []);

  const debouncedSearchFiles = useDebouncedCallback(searchFiles, 200);
  const debouncedSearchFolders = useDebouncedCallback(searchFolders, 200);
  const debouncedSearchSymbols = useDebouncedCallback(searchSymbols, 250);
  const debouncedSearchDocs = useDebouncedCallback(searchDocs, 200);

  return {
    isSearching,
    results,
    searchFiles: debouncedSearchFiles,
    searchFolders: debouncedSearchFolders,
    searchSymbols: debouncedSearchSymbols,
    searchDocs: debouncedSearchDocs,
    searchWeb,
    clearResults,
  };
}
