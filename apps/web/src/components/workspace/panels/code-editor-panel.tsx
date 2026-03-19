"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useSessionStore } from "@/stores/session.store";

const CodeMirrorEditor = dynamic(
  () =>
    import("./codemirror-editor").then((mod) => ({
      default: mod.CodeMirrorEditor,
    })),
  { ssr: false, loading: () => <div className="h-full bg-zinc-950" /> }
);

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function getExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? (parts.pop() ?? "") : "";
}

export function CodeEditorPanel() {
  const openFiles = useSessionStore((s) => s.openFiles);
  const activeFilePath = useSessionStore((s) => s.activeFilePath);
  const setActiveFile = useSessionStore((s) => s.setActiveFile);
  const closeFile = useSessionStore((s) => s.closeFile);
  const events = useSessionStore((s) => s.events);

  const fileContent = useMemo(() => {
    if (!activeFilePath) {
      return null;
    }

    const codeEvent = events
      .slice()
      .reverse()
      .find(
        (e) =>
          (e.type === "code_change" || e.type === "file_diff") &&
          e.data.path === activeFilePath &&
          typeof e.data.content === "string"
      );

    if (codeEvent && typeof codeEvent.data.content === "string") {
      return codeEvent.data.content;
    }

    return null;
  }, [activeFilePath, events]);

  const extension = useMemo(() => {
    if (!activeFilePath) {
      return "";
    }
    return getExtension(activeFilePath);
  }, [activeFilePath]);

  if (openFiles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-950">
        <div className="text-sm text-zinc-600">No files open</div>
        <div className="mt-1 text-xs text-zinc-700">
          Files modified by agents will appear here
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Tab bar */}
      <div className="flex border-zinc-800 border-b bg-zinc-900/50">
        {openFiles.map((path) => (
          <div
            className={`group flex items-center gap-1.5 border-zinc-800 border-r px-3 py-1.5 text-xs ${
              path === activeFilePath
                ? "border-b-2 border-b-violet-500 bg-zinc-950 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={path}
          >
            <button
              className="truncate border-0 bg-transparent p-0 text-inherit"
              onClick={() => setActiveFile(path)}
              title={path}
              type="button"
            >
              {getFileName(path)}
            </button>
            <button
              className="ml-1 hidden rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300 group-hover:inline-flex"
              onClick={() => closeFile(path)}
              title="Close file"
              type="button"
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* File path bar */}
      {activeFilePath && (
        <div className="border-zinc-800 border-b px-3 py-1 text-[11px] text-zinc-600">
          {activeFilePath}
        </div>
      )}

      {/* Code content */}
      <div className="flex-1 overflow-hidden">
        {fileContent === null ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            {activeFilePath
              ? "No content available for this file"
              : "Select a file to view"}
          </div>
        ) : (
          <CodeMirrorEditor
            extension={extension}
            readOnly
            value={fileContent}
          />
        )}
      </div>
    </div>
  );
}
