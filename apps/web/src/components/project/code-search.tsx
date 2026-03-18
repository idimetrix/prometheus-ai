"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

interface SearchResult {
  content: string;
  context: {
    before: string[];
    after: string[];
  };
  file: string;
  line: number;
  matchEnd: number;
  matchStart: number;
}

interface CodeSearchProps {
  projectId: string;
}

export function CodeSearch({ projectId }: CodeSearchProps) {
  const [query, setQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [isSemantic, setIsSemantic] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      return;
    }

    // Validate regex if enabled
    if (isRegex) {
      try {
        new RegExp(query);
      } catch {
        setError("Invalid regular expression");
        return;
      }
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await utils.brain.search.fetch({
        projectId,
        query: query.trim(),
        limit: 50,
      });

      const mapped = (response.results ?? []).map((r) => ({
        file: r.filePath,
        line: r.chunkIndex,
        content: r.content,
        matchStart: 0,
        matchEnd: 0,
        context: { before: [] as string[], after: [] as string[] },
      }));
      setResults(mapped);
      // Auto-expand first few files
      const files = new Set<string>(
        mapped.slice(0, 3).map((r: SearchResult) => r.file)
      );
      setExpandedFiles(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      setError(message);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, isRegex, projectId, utils]);

  // Submit on Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const toggleFile = (file: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
      return next;
    });
  };

  // Group results by file
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.file] ??= []).push(r);
    return acc;
  }, {});

  const fileCount = Object.keys(grouped).length;

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      {/* Search input */}
      <div className="border-zinc-800 border-b p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-600"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <input
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-3 pl-9 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isSemantic
                  ? "Describe what you're looking for..."
                  : isRegex
                    ? "Enter regex pattern..."
                    : "Search code..."
              }
              ref={inputRef}
              value={query}
            />
          </div>
          <button
            className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white text-xs transition-colors hover:bg-violet-700 disabled:opacity-50"
            disabled={!query.trim() || isSearching}
            onClick={handleSearch}
          >
            {isSearching ? "..." : "Search"}
          </button>
        </div>

        {/* Toggle options */}
        <div className="mt-2 flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              checked={isRegex}
              className="rounded border-zinc-700 bg-zinc-800 text-violet-500 focus:ring-violet-500"
              onChange={(e) => {
                setIsRegex(e.target.checked);
                if (e.target.checked) {
                  setIsSemantic(false);
                }
              }}
              type="checkbox"
            />
            Regex
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              checked={isSemantic}
              className="rounded border-zinc-700 bg-zinc-800 text-violet-500 focus:ring-violet-500"
              onChange={(e) => {
                setIsSemantic(e.target.checked);
                if (e.target.checked) {
                  setIsRegex(false);
                }
              }}
              type="checkbox"
            />
            Semantic (AI)
          </label>
          {results.length > 0 && (
            <span className="ml-auto text-[11px] text-zinc-600">
              {results.length} matches in {fileCount} files
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="border-red-800/30 border-b bg-red-950/20 px-4 py-2 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {results.length === 0 && !isSearching && query && !error && (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No results found
          </div>
        )}

        {isSearching && (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            <span className="animate-pulse">Searching...</span>
          </div>
        )}

        {!isSearching &&
          Object.entries(grouped).map(([file, matches]) => (
            <div className="border-zinc-800/50 border-b" key={file}>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/30"
                onClick={() => toggleFile(file)}
              >
                <svg
                  className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${
                    expandedFiles.has(file) ? "rotate-90" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="truncate font-mono text-[11px] text-zinc-300">
                  {file}
                </span>
                <span className="ml-auto shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
                  {matches.length}
                </span>
              </button>

              {expandedFiles.has(file) && (
                <div className="bg-zinc-950/50 px-3 pb-2">
                  {matches.map((match, i) => (
                    <div
                      className="mt-1 rounded border border-zinc-800/30 bg-zinc-900/50"
                      key={`${match.line}-${i}`}
                    >
                      <div className="border-zinc-800/30 border-b px-2 py-1">
                        <span className="font-mono text-[10px] text-zinc-500">
                          Line {match.line}
                        </span>
                      </div>
                      <pre className="overflow-auto p-2 text-[10px] leading-relaxed">
                        {match.context?.before?.map((line, j) => (
                          <div className="text-zinc-600" key={`b-${j}`}>
                            {line}
                          </div>
                        ))}
                        <div className="bg-yellow-500/10 text-zinc-200">
                          {match.content}
                        </div>
                        {match.context?.after?.map((line, j) => (
                          <div className="text-zinc-600" key={`a-${j}`}>
                            {line}
                          </div>
                        ))}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
