"use client";

import { DiffEditor as MonacoDiffEditor } from "@monaco-editor/react";
import { useCallback, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface DiffEditorProps {
  className?: string;
  language?: string;
  modified: string;
  onAccept?: (content: string) => void;
  onReject?: () => void;
  original: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function DiffEditorPanel({
  original,
  modified,
  language = "typescript",
  onAccept,
  onReject,
  className = "",
}: DiffEditorProps) {
  const [renderSideBySide, setRenderSideBySide] = useState(true);

  const handleAcceptAll = useCallback(() => {
    onAccept?.(modified);
  }, [modified, onAccept]);

  const handleRejectAll = useCallback(() => {
    onReject?.();
  }, [onReject]);

  return (
    <div className={`flex h-full flex-col ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-zinc-800 border-b bg-zinc-900/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-xs text-zinc-400">Diff View</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {language}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle inline/side-by-side */}
          <div className="flex items-center gap-0.5 rounded border border-zinc-800 p-0.5">
            <button
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                renderSideBySide
                  ? "bg-violet-500/20 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => setRenderSideBySide(true)}
              type="button"
            >
              Side by Side
            </button>
            <button
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                renderSideBySide
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "bg-violet-500/20 text-violet-400"
              }`}
              onClick={() => setRenderSideBySide(false)}
              type="button"
            >
              Inline
            </button>
          </div>

          {/* Accept/Reject buttons */}
          {onAccept && (
            <button
              className="rounded bg-green-600/80 px-2.5 py-1 font-medium text-[10px] text-white hover:bg-green-600"
              onClick={handleAcceptAll}
              type="button"
            >
              Accept All
            </button>
          )}
          {onReject && (
            <button
              className="rounded bg-red-600/80 px-2.5 py-1 font-medium text-[10px] text-white hover:bg-red-600"
              onClick={handleRejectAll}
              type="button"
            >
              Reject All
            </button>
          )}
        </div>
      </div>

      {/* Diff Editor */}
      <div className="flex-1 overflow-hidden">
        <MonacoDiffEditor
          language={language}
          loading={
            <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-600">
              Loading diff...
            </div>
          }
          modified={modified}
          options={{
            readOnly: true,
            renderSideBySide,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily:
              "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            lineNumbers: "on",
            renderWhitespace: "selection",
            padding: { top: 8, bottom: 8 },
          }}
          original={original}
          theme="vs-dark"
        />
      </div>
    </div>
  );
}
