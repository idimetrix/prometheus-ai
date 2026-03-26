"use client";

import { useCallback, useState } from "react";

interface ComponentVersion {
  approved: boolean;
  code: string;
  createdAt: string;
  id: string;
  prompt?: string;
  screenshotUrl?: string;
  version: number;
}

interface VersionHistoryProps {
  activeVersionId?: string;
  onApprove?: (versionId: string) => void;
  onDelete?: (versionId: string) => void;
  onRestore?: (versionId: string) => void;
  onSelectVersion?: (versionId: string) => void;
  versions: ComponentVersion[];
}

interface VersionItemProps {
  diffMode: boolean;
  isActive: boolean;
  isDiffSelected: boolean;
  isLast: boolean;
  onApprove?: (versionId: string) => void;
  onDelete?: (versionId: string) => void;
  onDiffSelect: (versionId: string) => void;
  onRestore?: (versionId: string) => void;
  onSelectVersion?: (versionId: string) => void;
  version: ComponentVersion;
}

function getDotClassName(approved: boolean, isActive: boolean): string {
  if (approved) {
    return "bg-green-500/20 text-green-400";
  }
  if (isActive) {
    return "bg-pink-500/20 text-pink-400";
  }
  return "bg-zinc-800 text-zinc-500";
}

function VersionItem({
  diffMode,
  isActive,
  isDiffSelected,
  isLast,
  onApprove,
  onDelete,
  onDiffSelect,
  onRestore,
  onSelectVersion,
  version,
}: VersionItemProps) {
  return (
    <div
      className={`group relative flex items-start gap-3 rounded-lg p-2.5 transition-colors ${
        isActive
          ? "border border-pink-500/30 bg-pink-500/10"
          : "hover:bg-zinc-800/50"
      } ${isDiffSelected ? "ring-1 ring-pink-500/50" : ""}`}
    >
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute top-10 bottom-0 left-[18px] w-px bg-zinc-800" />
      )}

      {/* Timeline dot */}
      <div
        className={`relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${getDotClassName(version.approved, isActive)}`}
      >
        <span className="font-bold text-[9px]">{version.version}</span>
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <VersionItemHeader version={version} />

        {version.prompt && (
          <p className="truncate text-xs text-zinc-500">{version.prompt}</p>
        )}

        {/* Screenshot thumbnail */}
        {version.screenshotUrl && (
          // biome-ignore lint/performance/noImgElement: preview thumbnail
          <img
            alt={`Version ${version.version} screenshot`}
            className="mt-1 h-20 w-auto rounded border border-zinc-700 object-cover"
            height={80}
            src={version.screenshotUrl}
            width={120}
          />
        )}

        {/* Actions */}
        <VersionItemActions
          diffMode={diffMode}
          isDiffSelected={isDiffSelected}
          onApprove={onApprove}
          onDelete={onDelete}
          onDiffSelect={onDiffSelect}
          onRestore={onRestore}
          onSelectVersion={onSelectVersion}
          version={version}
        />
      </div>
    </div>
  );
}

function VersionItemHeader({ version }: { version: ComponentVersion }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium text-xs text-zinc-300">
        Version {version.version}
      </span>
      {version.approved && (
        <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">
          Approved
        </span>
      )}
      <span className="ml-auto text-[10px] text-zinc-600">
        {new Date(version.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}

function VersionItemActions({
  diffMode,
  isDiffSelected,
  onApprove,
  onDelete,
  onDiffSelect,
  onRestore,
  onSelectVersion,
  version,
}: {
  diffMode: boolean;
  isDiffSelected: boolean;
  onApprove?: (versionId: string) => void;
  onDelete?: (versionId: string) => void;
  onDiffSelect: (versionId: string) => void;
  onRestore?: (versionId: string) => void;
  onSelectVersion?: (versionId: string) => void;
  version: ComponentVersion;
}) {
  return (
    <div className="mt-1 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
      {diffMode ? (
        <button
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            isDiffSelected
              ? "bg-pink-500/20 text-pink-400"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          onClick={() => onDiffSelect(version.id)}
          type="button"
        >
          {isDiffSelected ? "Selected" : "Select for diff"}
        </button>
      ) : (
        <>
          <button
            className="rounded px-2 py-0.5 text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={() => onSelectVersion?.(version.id)}
            type="button"
          >
            View
          </button>
          <button
            className="rounded px-2 py-0.5 text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={() => onRestore?.(version.id)}
            type="button"
          >
            Restore
          </button>
          {!version.approved && (
            <button
              className="rounded px-2 py-0.5 text-[10px] text-green-500 transition-colors hover:text-green-400"
              onClick={() => onApprove?.(version.id)}
              type="button"
            >
              Approve
            </button>
          )}
          <button
            className="rounded px-2 py-0.5 text-[10px] text-red-500 transition-colors hover:text-red-400"
            onClick={() => onDelete?.(version.id)}
            type="button"
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

export function VersionHistory({
  activeVersionId,
  onApprove,
  onDelete,
  onRestore,
  onSelectVersion,
  versions,
}: VersionHistoryProps) {
  const [diffMode, setDiffMode] = useState(false);
  const [diffVersionA, setDiffVersionA] = useState<string | null>(null);
  const [diffVersionB, setDiffVersionB] = useState<string | null>(null);

  const getDiffVersions = useCallback(() => {
    if (!(diffVersionA && diffVersionB)) {
      return null;
    }
    const a = versions.find((v) => v.id === diffVersionA);
    const b = versions.find((v) => v.id === diffVersionB);
    return a && b ? { a, b } : null;
  }, [diffVersionA, diffVersionB, versions]);

  const diffPair = diffMode ? getDiffVersions() : null;

  function handleDiffSelect(versionId: string) {
    if (!diffVersionA) {
      setDiffVersionA(versionId);
    } else if (!diffVersionB && versionId !== diffVersionA) {
      setDiffVersionB(versionId);
    } else {
      setDiffVersionA(versionId);
      setDiffVersionB(null);
    }
  }

  if (versions.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-xs text-zinc-500">
        No versions yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm text-zinc-300">
          Version History
        </span>
        <div className="flex items-center gap-2">
          <button
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              diffMode
                ? "bg-pink-500/20 text-pink-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => {
              setDiffMode(!diffMode);
              setDiffVersionA(null);
              setDiffVersionB(null);
            }}
            type="button"
          >
            {diffMode ? "Exit Diff" : "Compare"}
          </button>
          <span className="text-xs text-zinc-600">
            {versions.length} version{versions.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Diff view */}
      {diffMode && diffPair && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
            <span className="text-red-400">v{diffPair.a.version}</span>
            <span>vs</span>
            <span className="text-green-400">v{diffPair.b.version}</span>
          </div>
          <pre className="max-h-[200px] overflow-auto text-xs text-zinc-400 leading-relaxed">
            <code>{diffPair.b.code}</code>
          </pre>
        </div>
      )}

      {diffMode && !diffPair && (
        <div className="text-center text-xs text-zinc-500">
          {diffVersionA
            ? "Select a second version to compare"
            : "Select two versions to compare"}
        </div>
      )}

      {/* Version timeline */}
      <div className="flex flex-col gap-0.5">
        {versions.map((version, idx) => (
          <VersionItem
            diffMode={diffMode}
            isActive={version.id === activeVersionId}
            isDiffSelected={
              version.id === diffVersionA || version.id === diffVersionB
            }
            isLast={idx === versions.length - 1}
            key={version.id}
            onApprove={onApprove}
            onDelete={onDelete}
            onDiffSelect={handleDiffSelect}
            onRestore={onRestore}
            onSelectVersion={onSelectVersion}
            version={version}
          />
        ))}
      </div>
    </div>
  );
}
