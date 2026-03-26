"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@prometheus/ui";
import {
  File,
  FileCode,
  FileJson,
  FileText,
  FolderOpen,
  Image,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ───────────────────────────────────────────────────────

interface FileEntry {
  /** Last opened timestamp for MRU sorting */
  lastOpened?: number;
  /** File name */
  name: string;
  /** Full path relative to project root */
  path: string;
}

interface FilePickerProps {
  /** All files available in the workspace */
  files: FileEntry[];
  /** Callback when a file is selected */
  onSelect: (path: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────

const EXTENSION_ICON_MAP: Record<string, React.ReactNode> = {
  ts: <FileCode className="h-4 w-4 text-blue-400" />,
  tsx: <FileCode className="h-4 w-4 text-blue-400" />,
  js: <FileCode className="h-4 w-4 text-yellow-400" />,
  jsx: <FileCode className="h-4 w-4 text-yellow-400" />,
  json: <FileJson className="h-4 w-4 text-green-400" />,
  md: <FileText className="h-4 w-4 text-zinc-400" />,
  mdx: <FileText className="h-4 w-4 text-zinc-400" />,
  css: <FileCode className="h-4 w-4 text-pink-400" />,
  scss: <FileCode className="h-4 w-4 text-pink-400" />,
  html: <FileCode className="h-4 w-4 text-orange-400" />,
  svg: <Image className="h-4 w-4 text-green-300" />,
  png: <Image className="h-4 w-4 text-green-300" />,
  jpg: <Image className="h-4 w-4 text-green-300" />,
  yaml: <FileText className="h-4 w-4 text-red-300" />,
  yml: <FileText className="h-4 w-4 text-red-300" />,
};

function getFileIcon(name: string): React.ReactNode {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_ICON_MAP[ext] ?? <File className="h-4 w-4 text-zinc-500" />;
}

function getDirectoryName(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

/**
 * Highlight matching characters in a string.
 * Returns an array of React nodes with matched characters wrapped in <mark>.
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) {
    return text;
  }

  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const result: React.ReactNode[] = [];
  let queryIdx = 0;
  let lastMatchEnd = 0;

  for (let i = 0; i < text.length && queryIdx < queryLower.length; i++) {
    if (lower[i] === queryLower[queryIdx]) {
      if (i > lastMatchEnd) {
        result.push(text.slice(lastMatchEnd, i));
      }
      result.push(
        <mark
          className="bg-violet-500/30 text-inherit"
          key={`${i}-${queryIdx}`}
        >
          {text[i]}
        </mark>
      );
      lastMatchEnd = i + 1;
      queryIdx++;
    }
  }

  if (lastMatchEnd < text.length) {
    result.push(text.slice(lastMatchEnd));
  }

  return result;
}

/**
 * Fuzzy match score: returns a number >= 0 if matched, -1 if no match.
 * Lower is better. Considers consecutive matches and position.
 */
function fuzzyScore(text: string, query: string): number {
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  let score = 0;
  let queryIdx = 0;
  let prevMatchIdx = -2;

  for (let i = 0; i < lower.length && queryIdx < queryLower.length; i++) {
    if (lower[i] === queryLower[queryIdx]) {
      // Bonus for consecutive matches
      if (i === prevMatchIdx + 1) {
        score += 1;
      }
      // Bonus for matching at word boundaries
      if (
        i === 0 ||
        lower[i - 1] === "/" ||
        lower[i - 1] === "-" ||
        lower[i - 1] === "_" ||
        lower[i - 1] === "."
      ) {
        score += 2;
      }
      prevMatchIdx = i;
      queryIdx++;
    }
  }

  // All characters matched
  if (queryIdx === queryLower.length) {
    return score;
  }

  return -1;
}

// ── Component ───────────────────────────────────────────────────

export function FilePicker({ files, onSelect }: FilePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Listen for Cmd+P / Ctrl+P
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Also listen for the custom event from the command palette
  useEffect(() => {
    const handleOpenFile = () => setOpen(true);
    window.addEventListener("prometheus:open-file", handleOpenFile);
    return () =>
      window.removeEventListener("prometheus:open-file", handleOpenFile);
  }, []);

  // Reset query when opening
  useEffect(() => {
    if (open) {
      setQuery("");
    }
  }, [open]);

  const sortedFiles = useMemo(() => {
    if (!query.trim()) {
      // MRU sort when no query
      return [...files].sort((a, b) => {
        const aTime = a.lastOpened ?? 0;
        const bTime = b.lastOpened ?? 0;
        return bTime - aTime;
      });
    }

    // Fuzzy search + score
    const scored = files
      .map((file) => {
        const nameScore = fuzzyScore(file.name, query);
        const pathScore = fuzzyScore(file.path, query);
        const bestScore = Math.max(nameScore, pathScore);
        return { file, score: bestScore };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((entry) => entry.file);
  }, [files, query]);

  const recentFiles = useMemo(
    () =>
      files
        .filter((f) => f.lastOpened !== undefined && f.lastOpened > 0)
        .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
        .slice(0, 5),
    [files]
  );

  const handleSelect = useCallback(
    (path: string) => {
      setOpen(false);
      onSelect(path);
    },
    [onSelect]
  );

  const showRecent = !query.trim() && recentFiles.length > 0;
  const displayFiles = query.trim() ? sortedFiles : sortedFiles.slice(0, 50);

  return (
    <CommandDialog onOpenChange={setOpen} open={open}>
      <CommandInput
        onValueChange={setQuery}
        placeholder="Search files by name..."
        value={query}
      />
      <CommandList className="max-h-[400px]">
        <CommandEmpty>No files found.</CommandEmpty>

        {showRecent && (
          <CommandGroup heading="Recent files">
            {recentFiles.map((file) => (
              <CommandItem
                key={`recent-${file.path}`}
                onSelect={() => handleSelect(file.path)}
                value={file.path}
              >
                {getFileIcon(file.name)}
                <div className="ml-2 min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">
                    {highlightMatch(file.name, query)}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">
                    {getDirectoryName(file.path)}
                  </div>
                </div>
                <FolderOpen className="ml-auto h-3 w-3 text-zinc-600" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={query.trim() ? "Results" : "All files"}>
          {displayFiles.map((file) => (
            <CommandItem
              key={file.path}
              onSelect={() => handleSelect(file.path)}
              value={file.path}
            >
              {getFileIcon(file.name)}
              <div className="ml-2 min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-200">
                  {highlightMatch(file.name, query)}
                </div>
                <div className="truncate text-[11px] text-zinc-500">
                  {highlightMatch(getDirectoryName(file.path), query)}
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
