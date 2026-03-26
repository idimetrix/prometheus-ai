"use client";

import { cn } from "@prometheus/ui";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  File,
  Filter,
  Regex,
  Replace,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ── Types ───────────────────────────────────────────────────────

interface SearchMatch {
  /** Column where match starts (0-based) */
  column: number;
  /** The full text of the matching line */
  lineContent: string;
  /** Line number (1-based) */
  lineNumber: number;
}

interface FileSearchResult {
  /** The file path relative to project root */
  filePath: string;
  /** Matching lines */
  matches: SearchMatch[];
}

interface SearchPanelProps {
  className?: string;
  /** Callback to navigate editor to a file at a line */
  onNavigate?: (filePath: string, lineNumber: number) => void;
  /** Callback for executing a replace across files */
  onReplace?: (
    filePath: string,
    searchText: string,
    replaceText: string,
    options: SearchOptions
  ) => void;
  /** Callback for executing a replace-all across files */
  onReplaceAll?: (
    searchText: string,
    replaceText: string,
    options: SearchOptions
  ) => void;
  /** Callback for executing a search */
  onSearch?: (query: string, options: SearchOptions) => void;
  /** Search results from parent */
  results?: FileSearchResult[];
}

interface SearchOptions {
  caseSensitive: boolean;
  fileFilter: string;
  regex: boolean;
  wholeWord: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function getTotalMatchCount(results: FileSearchResult[]): number {
  let count = 0;
  for (const result of results) {
    count += result.matches.length;
  }
  return count;
}

// ── Sub-components ──────────────────────────────────────────────

function MatchLine({
  match,
  onNavigate,
  searchQuery,
}: {
  match: SearchMatch;
  onNavigate: () => void;
  searchQuery: string;
}) {
  // Highlight the matching text within the line
  const parts = useMemo(() => {
    if (!searchQuery) {
      return [match.lineContent];
    }
    const idx = match.lineContent
      .toLowerCase()
      .indexOf(searchQuery.toLowerCase());
    if (idx < 0) {
      return [match.lineContent];
    }
    return [
      match.lineContent.slice(0, idx),
      match.lineContent.slice(idx, idx + searchQuery.length),
      match.lineContent.slice(idx + searchQuery.length),
    ];
  }, [match.lineContent, searchQuery]);

  return (
    <button
      className="flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left text-xs transition-colors hover:bg-zinc-800"
      onClick={onNavigate}
      type="button"
    >
      <span className="shrink-0 text-zinc-600 tabular-nums">
        {match.lineNumber}
      </span>
      <span className="min-w-0 truncate text-zinc-400">
        {parts.length === 3 ? (
          <>
            {parts[0]}
            <mark className="bg-yellow-500/30 text-yellow-200">{parts[1]}</mark>
            {parts[2]}
          </>
        ) : (
          match.lineContent
        )}
      </span>
    </button>
  );
}

function FileResultGroup({
  onNavigate,
  result,
  searchQuery,
}: {
  onNavigate: (filePath: string, lineNumber: number) => void;
  result: FileSearchResult;
  searchQuery: string;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-zinc-800 border-b last:border-0">
      <button
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/50"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
        )}
        <File className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
          {getFileName(result.filePath)}
        </span>
        <span className="shrink-0 text-[10px] text-zinc-600">
          {result.filePath}
        </span>
        <span className="ml-1 shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {result.matches.length}
        </span>
      </button>

      {expanded && (
        <div className="pb-1 pl-4">
          {result.matches.map((match) => (
            <MatchLine
              key={`${result.filePath}:${match.lineNumber}:${match.column}`}
              match={match}
              onNavigate={() => onNavigate(result.filePath, match.lineNumber)}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

export function SearchPanel({
  className,
  results = [],
  onSearch,
  onNavigate,
  onReplace,
  onReplaceAll,
}: SearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [showFileFilter, setShowFileFilter] = useState(false);

  const options: SearchOptions = useMemo(
    () => ({
      caseSensitive,
      wholeWord,
      regex: useRegex,
      fileFilter,
    }),
    [caseSensitive, wholeWord, useRegex, fileFilter]
  );

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) {
      return;
    }
    onSearch?.(searchQuery, options);
  }, [searchQuery, options, onSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      }
    },
    [handleSearch]
  );

  const handleNavigate = useCallback(
    (filePath: string, lineNumber: number) => {
      onNavigate?.(filePath, lineNumber);
    },
    [onNavigate]
  );

  const _handleReplace = useCallback(
    (filePath: string) => {
      onReplace?.(filePath, searchQuery, replaceQuery, options);
    },
    [searchQuery, replaceQuery, options, onReplace]
  );

  const handleReplaceAll = useCallback(() => {
    onReplaceAll?.(searchQuery, replaceQuery, options);
  }, [searchQuery, replaceQuery, options, onReplaceAll]);

  const totalMatches = getTotalMatchCount(results);

  return (
    <div className={cn("flex h-full flex-col bg-zinc-900", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-zinc-500" />
          <span className="font-medium text-xs text-zinc-300">Search</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className={cn(
              "rounded p-1 transition-colors",
              showReplace
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            )}
            onClick={() => setShowReplace(!showReplace)}
            title="Toggle replace"
            type="button"
          >
            <Replace className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn(
              "rounded p-1 transition-colors",
              showFileFilter
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            )}
            onClick={() => setShowFileFilter(!showFileFilter)}
            title="Toggle file filter"
            type="button"
          >
            <Filter className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search input area */}
      <div className="space-y-2 border-zinc-800 border-b px-3 py-2">
        {/* Search row */}
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <input
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 pr-20 text-xs text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search..."
              value={searchQuery}
            />
            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
              <button
                className={cn(
                  "rounded p-0.5 transition-colors",
                  caseSensitive
                    ? "bg-violet-500/20 text-violet-300"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
                onClick={() => setCaseSensitive(!caseSensitive)}
                title="Match case"
                type="button"
              >
                <CaseSensitive className="h-3.5 w-3.5" />
              </button>
              <button
                className={cn(
                  "rounded p-0.5 transition-colors",
                  wholeWord
                    ? "bg-violet-500/20 text-violet-300"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
                onClick={() => setWholeWord(!wholeWord)}
                title="Match whole word"
                type="button"
              >
                <WholeWord className="h-3.5 w-3.5" />
              </button>
              <button
                className={cn(
                  "rounded p-0.5 transition-colors",
                  useRegex
                    ? "bg-violet-500/20 text-violet-300"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
                onClick={() => setUseRegex(!useRegex)}
                title="Use regular expression"
                type="button"
              >
                <Regex className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div className="flex items-center gap-1">
            <input
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder="Replace..."
              value={replaceQuery}
            />
            <button
              className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
              disabled={results.length === 0 || !replaceQuery}
              onClick={handleReplaceAll}
              title="Replace all"
              type="button"
            >
              All
            </button>
          </div>
        )}

        {/* File filter */}
        {showFileFilter && (
          <div className="flex items-center gap-1">
            <input
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="Files to include (e.g., *.ts, src/**)"
              value={fileFilter}
            />
            {fileFilter && (
              <button
                className="rounded p-1 text-zinc-500 hover:text-zinc-300"
                onClick={() => setFileFilter("")}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Result count */}
      {results.length > 0 && (
        <div className="border-zinc-800 border-b px-3 py-1.5 text-[10px] text-zinc-500">
          {totalMatches} result{totalMatches === 1 ? "" : "s"} in{" "}
          {results.length} file{results.length === 1 ? "" : "s"}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {results.length === 0 && searchQuery.trim() && (
          <div className="py-8 text-center text-xs text-zinc-600">
            No results found
          </div>
        )}

        {results.length === 0 && !searchQuery.trim() && (
          <div className="py-8 text-center text-xs text-zinc-600">
            Type to search across files
          </div>
        )}

        {results.map((result) => (
          <FileResultGroup
            key={result.filePath}
            onNavigate={handleNavigate}
            result={result}
            searchQuery={searchQuery}
          />
        ))}
      </div>

      {/* Replace actions for individual files */}
      {showReplace && results.length > 0 && (
        <div className="border-zinc-800 border-t px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500">
              Replace &quot;{searchQuery}&quot; with &quot;{replaceQuery}&quot;
            </span>
            <button
              className="rounded bg-violet-600 px-2 py-1 text-[10px] text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
              disabled={!replaceQuery}
              onClick={handleReplaceAll}
              type="button"
            >
              Replace All ({totalMatches})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
