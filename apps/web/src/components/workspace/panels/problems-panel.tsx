"use client";

import { useCallback, useMemo, useState } from "react";

type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  /** Column number (1-based) */
  column: number;
  /** Unique identifier */
  id: string;
  /** Line number (1-based) */
  line: number;
  /** Human-readable message */
  message: string;
  /** Diagnostic severity */
  severity: DiagnosticSeverity;
  /** Source tool that produced this diagnostic */
  source: string;
}

export interface FileDiagnostics {
  /** File path relative to workspace root */
  filePath: string;
  /** Diagnostics for this file */
  items: Diagnostic[];
}

function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  if (severity === "error") {
    return (
      <svg
        aria-label="Error"
        className="h-4 w-4 shrink-0 text-red-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" x2="9" y1="9" y2="15" />
        <line x1="9" x2="15" y1="9" y2="15" />
      </svg>
    );
  }
  if (severity === "warning") {
    return (
      <svg
        aria-label="Warning"
        className="h-4 w-4 shrink-0 text-yellow-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" x2="12" y1="9" y2="13" />
        <line x1="12" x2="12.01" y1="17" y2="17" />
      </svg>
    );
  }
  return (
    <svg
      aria-label="Info"
      className="h-4 w-4 shrink-0 text-blue-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="16" y2="12" />
      <line x1="12" x2="12.01" y1="8" y2="8" />
    </svg>
  );
}

interface ProblemsPanelProps {
  /** Diagnostics grouped by file */
  diagnostics: FileDiagnostics[];
  /** Called to clear all diagnostics */
  onClearAll: () => void;
  /** Called when a diagnostic is clicked to navigate to its location */
  onNavigate: (filePath: string, line: number, column: number) => void;
}

export function ProblemsPanel({
  diagnostics,
  onNavigate,
  onClearAll,
}: ProblemsPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<
    DiagnosticSeverity | "all"
  >("all");

  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const file of diagnostics) {
      for (const item of file.items) {
        if (item.severity === "error") {
          errors++;
        }
        if (item.severity === "warning") {
          warnings++;
        }
        if (item.severity === "info") {
          infos++;
        }
      }
    }
    return { errors, warnings, infos, total: errors + warnings + infos };
  }, [diagnostics]);

  const filtered = useMemo(() => {
    if (severityFilter === "all") {
      return diagnostics;
    }
    return diagnostics
      .map((file) => ({
        ...file,
        items: file.items.filter((item) => item.severity === severityFilter),
      }))
      .filter((file) => file.items.length > 0);
  }, [diagnostics, severityFilter]);

  const handleNavigate = useCallback(
    (filePath: string, diag: Diagnostic) => {
      onNavigate(filePath, diag.line, diag.column);
    },
    [onNavigate]
  );

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center gap-1">
          <FilterButton
            active={severityFilter === "all"}
            count={counts.total}
            label="All"
            onClick={() => setSeverityFilter("all")}
          />
          <FilterButton
            active={severityFilter === "error"}
            count={counts.errors}
            label="Errors"
            onClick={() => setSeverityFilter("error")}
          />
          <FilterButton
            active={severityFilter === "warning"}
            count={counts.warnings}
            label="Warnings"
            onClick={() => setSeverityFilter("warning")}
          />
          <FilterButton
            active={severityFilter === "info"}
            count={counts.infos}
            label="Info"
            onClick={() => setSeverityFilter("info")}
          />
        </div>
        <div className="flex-1" />
        <button
          className="rounded px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          onClick={onClearAll}
          type="button"
        >
          Clear All
        </button>
      </div>

      {/* Diagnostic list */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-600">
            No problems detected
          </div>
        ) : (
          filtered.map((file) => (
            <div key={file.filePath}>
              {/* File header */}
              <div className="sticky top-0 bg-zinc-900/95 px-3 py-1.5 font-medium text-[11px] text-zinc-400 backdrop-blur-sm">
                {file.filePath}
                <span className="ml-2 text-zinc-600">
                  ({file.items.length})
                </span>
              </div>

              {/* Diagnostics */}
              {file.items.map((diag) => (
                <button
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-zinc-800/50"
                  key={diag.id}
                  onClick={() => handleNavigate(file.filePath, diag)}
                  type="button"
                >
                  <SeverityIcon severity={diag.severity} />
                  <span className="min-w-0 flex-1 text-[12px] text-zinc-300">
                    {diag.message}
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-600">
                    [{diag.line}:{diag.column}]
                  </span>
                  <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {diag.source}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function FilterButton({
  label,
  count,
  active,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded px-2 py-1 text-[11px] transition-colors ${
        active
          ? "bg-zinc-800 text-zinc-200"
          : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-400"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
      <span className={`ml-1 ${active ? "text-zinc-400" : "text-zinc-600"}`}>
        {count}
      </span>
    </button>
  );
}

/** Badge component for showing problem counts in panel tab headers */
export function ProblemsBadge({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/20 px-1 font-medium text-[10px] text-red-400">
      {count > 99 ? "99+" : count}
    </span>
  );
}
