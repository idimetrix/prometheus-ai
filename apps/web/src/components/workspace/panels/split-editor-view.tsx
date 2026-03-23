"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

// --- Types ---

interface FileTab {
  /** File content */
  content: string;
  /** File extension for syntax highlighting (e.g., "ts", "py") */
  extension: string;
  /** File path / display label */
  path: string;
}

type SplitDirection = "horizontal" | "vertical";

interface SplitEditorViewProps {
  /** Default split ratio (0.0 - 1.0, default 0.5) */
  defaultRatio?: number;
  /** The direction of the split ("horizontal" = side-by-side, "vertical" = top-bottom) */
  direction: SplitDirection;
  /** The two files to display */
  files: [FileTab, FileTab];
  /** Called when a file's content changes. Receives file index and new content. */
  onChange?: (fileIndex: number, content: string) => void;
  /** Called when save is triggered. Receives file index and content. */
  onSave?: (fileIndex: number, content: string) => void;
  /** Whether editors are read-only */
  readOnly?: boolean;
}

// Dynamically import CodeMirrorEditor to avoid SSR issues
const CodeMirrorEditor = dynamic(
  () =>
    import("./codemirror-editor").then((mod) => ({
      default: mod.CodeMirrorEditor,
    })),
  { ssr: false, loading: () => <div className="h-full bg-zinc-950" /> }
);

// --- Split Editor View Component ---

export function SplitEditorView({
  files,
  direction,
  onChange,
  onSave,
  readOnly = false,
  defaultRatio = 0.5,
}: SplitEditorViewProps) {
  const [splitRatio, setSplitRatio] = useState(defaultRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!(isDraggingRef.current && container)) {
          return;
        }

        const rect = container.getBoundingClientRect();
        let ratio: number;

        if (isHorizontal) {
          ratio = (moveEvent.clientX - rect.left) / rect.width;
        } else {
          ratio = (moveEvent.clientY - rect.top) / rect.height;
        }

        // Clamp between 20% and 80%
        ratio = Math.max(0.2, Math.min(0.8, ratio));
        setSplitRatio(ratio);
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isHorizontal]
  );

  const handleChange0 = useCallback(
    (content: string) => onChange?.(0, content),
    [onChange]
  );

  const handleChange1 = useCallback(
    (content: string) => onChange?.(1, content),
    [onChange]
  );

  const handleSave0 = useCallback(
    (content: string) => onSave?.(0, content),
    [onSave]
  );

  const handleSave1 = useCallback(
    (content: string) => onSave?.(1, content),
    [onSave]
  );

  const firstSize = `${splitRatio * 100}%`;
  const secondSize = `${(1 - splitRatio) * 100}%`;

  function getFileName(path: string): string {
    return path.split("/").pop() ?? path;
  }

  return (
    <div
      className={`flex h-full ${isHorizontal ? "flex-row" : "flex-col"}`}
      ref={containerRef}
    >
      {/* First editor pane */}
      <div
        className="flex flex-col overflow-hidden"
        style={
          isHorizontal
            ? { width: firstSize, minWidth: 0 }
            : { height: firstSize, minHeight: 0 }
        }
      >
        {/* File tab */}
        <div className="flex items-center border-zinc-800 border-b bg-zinc-900/50 px-3 py-1">
          <span
            className="truncate font-mono text-xs text-zinc-300"
            title={files[0].path}
          >
            {getFileName(files[0].path)}
          </span>
          <span className="ml-2 text-[10px] text-zinc-600">
            {files[0].path}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <CodeMirrorEditor
            extension={files[0].extension}
            onChange={handleChange0}
            onSave={handleSave0}
            readOnly={readOnly}
            value={files[0].content}
          />
        </div>
      </div>

      {/* Drag handle / divider */}
      <hr
        aria-label="Resize split editor panes"
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        aria-valuemax={80}
        aria-valuemin={20}
        aria-valuenow={Math.round(splitRatio * 100)}
        className={`relative m-0 flex-shrink-0 border-0 ${
          isHorizontal
            ? "w-1 cursor-col-resize hover:bg-violet-500/30"
            : "h-1 cursor-row-resize hover:bg-violet-500/30"
        } bg-zinc-800 transition-colors`}
        onMouseDown={handleMouseDown}
        tabIndex={0}
      />

      {/* Second editor pane */}
      <div
        className="flex flex-col overflow-hidden"
        style={
          isHorizontal
            ? { width: secondSize, minWidth: 0 }
            : { height: secondSize, minHeight: 0 }
        }
      >
        {/* File tab */}
        <div className="flex items-center border-zinc-800 border-b bg-zinc-900/50 px-3 py-1">
          <span
            className="truncate font-mono text-xs text-zinc-300"
            title={files[1].path}
          >
            {getFileName(files[1].path)}
          </span>
          <span className="ml-2 text-[10px] text-zinc-600">
            {files[1].path}
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <CodeMirrorEditor
            extension={files[1].extension}
            onChange={handleChange1}
            onSave={handleSave1}
            readOnly={readOnly}
            value={files[1].content}
          />
        </div>
      </div>
    </div>
  );
}

export type { FileTab, SplitDirection, SplitEditorViewProps };
