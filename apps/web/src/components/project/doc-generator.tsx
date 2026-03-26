"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocType =
  | "api-docs"
  | "readme"
  | "architecture"
  | "setup-guide"
  | "contributing";

interface DocOption {
  description: string;
  id: DocType;
  label: string;
}

interface GenerationProgress {
  currentFile: string;
  filesAnalyzed: number;
  stage: "analyzing" | "generating" | "formatting" | "complete";
  totalFiles: number;
}

interface GeneratedDoc {
  content: string;
  filePath: string;
  title: string;
  type: DocType;
}

interface DocGeneratorProps {
  projectId: string;
  projectName: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOC_OPTIONS: DocOption[] = [
  {
    id: "api-docs",
    label: "API Documentation",
    description: "Generate OpenAPI/tRPC endpoint documentation",
  },
  {
    id: "readme",
    label: "README",
    description: "Project overview, features, and quickstart",
  },
  {
    id: "architecture",
    label: "Architecture Overview",
    description: "System design, components, and data flow",
  },
  {
    id: "setup-guide",
    label: "Setup Guide",
    description: "Development environment setup instructions",
  },
  {
    id: "contributing",
    label: "Contributing Guide",
    description: "How to contribute, code standards, and PR process",
  },
];

const STAGE_LABELS: Record<GenerationProgress["stage"], string> = {
  analyzing: "Analyzing files...",
  generating: "Generating documentation...",
  formatting: "Formatting output...",
  complete: "Complete",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DocTypeSelector({
  selected,
  onToggle,
}: {
  selected: Set<DocType>;
  onToggle: (type: DocType) => void;
}) {
  return (
    <div className="space-y-2">
      {DOC_OPTIONS.map((opt) => (
        <label
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 px-4 py-3 transition-colors hover:border-zinc-700 has-[:checked]:border-violet-800/50 has-[:checked]:bg-violet-950/20"
          key={opt.id}
        >
          <input
            checked={selected.has(opt.id)}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500"
            onChange={() => onToggle(opt.id)}
            type="checkbox"
          />
          <div>
            <span className="font-medium text-sm text-zinc-200">
              {opt.label}
            </span>
            <p className="text-xs text-zinc-500">{opt.description}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

function ProgressIndicator({ progress }: { progress: GenerationProgress }) {
  const percentage = Math.round(
    (progress.filesAnalyzed / Math.max(1, progress.totalFiles)) * 100
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-300">
          {STAGE_LABELS[progress.stage]}
        </span>
        <span className="font-mono text-xs text-zinc-500">{percentage}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-violet-600 transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {progress.currentFile && (
        <div className="flex items-center gap-2">
          <svg
            aria-hidden="true"
            className="h-3 w-3 animate-spin text-violet-400"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z"
              fill="currentColor"
            />
          </svg>
          <span className="truncate font-mono text-[10px] text-zinc-500">
            {progress.currentFile}
          </span>
        </div>
      )}

      <span className="text-[10px] text-zinc-600">
        {progress.filesAnalyzed} / {progress.totalFiles} files analyzed
      </span>
    </div>
  );
}

function DocPreview({
  doc,
  onEdit,
  onApply,
}: {
  doc: GeneratedDoc;
  onEdit: (content: string) => void;
  onApply: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(doc.content);

  const handleSaveEdit = useCallback(() => {
    onEdit(editContent);
    setIsEditing(false);
  }, [editContent, onEdit]);

  return (
    <div className="rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-2">
        <div>
          <h4 className="font-medium text-sm text-zinc-200">{doc.title}</h4>
          <span className="font-mono text-[10px] text-zinc-500">
            {doc.filePath}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:bg-zinc-700"
            onClick={() => setIsEditing(!isEditing)}
            type="button"
          >
            {isEditing ? "Preview" : "Edit"}
          </button>
          <button
            className="rounded bg-violet-600 px-2 py-1 text-[10px] text-white transition-colors hover:bg-violet-500"
            onClick={onApply}
            type="button"
          >
            Apply
          </button>
        </div>
      </div>

      <div className="max-h-96 overflow-auto p-4">
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              className="w-full rounded border border-zinc-700 bg-zinc-900 p-3 font-mono text-xs text-zinc-300 focus:border-violet-600 focus:outline-none"
              onChange={(e) => setEditContent(e.target.value)}
              rows={20}
              value={editContent}
            />
            <button
              className="rounded bg-violet-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-violet-500"
              onClick={handleSaveEdit}
              type="button"
            >
              Save Changes
            </button>
          </div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-300">
              {doc.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleOption({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 px-4 py-3 transition-colors hover:border-zinc-700">
      <input
        checked={enabled}
        className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500"
        onChange={onToggle}
        type="checkbox"
      />
      <div>
        <span className="font-medium text-sm text-zinc-200">
          Auto-regenerate on PR merge
        </span>
        <p className="text-xs text-zinc-500">
          Automatically regenerate selected documentation when a PR is merged
        </p>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function DocGenerator({
  projectId: _projectId,
  projectName,
}: DocGeneratorProps) {
  const [selectedTypes, setSelectedTypes] = useState<Set<DocType>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);
  const [autoRegenerate, setAutoRegenerate] = useState(false);

  const handleToggleType = useCallback((type: DocType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (selectedTypes.size === 0) {
      return;
    }

    setIsGenerating(true);
    setGeneratedDocs([]);

    const totalSteps = selectedTypes.size * 10;
    let step = 0;

    // Simulate progressive generation
    for (const docType of selectedTypes) {
      const option = DOC_OPTIONS.find((o) => o.id === docType);
      if (!option) {
        continue;
      }

      // Analyzing stage
      setProgress({
        currentFile: `src/${docType}/...`,
        filesAnalyzed: step,
        totalFiles: totalSteps,
        stage: "analyzing",
      });

      await new Promise((resolve) => setTimeout(resolve, 800));
      step += 5;

      // Generating stage
      setProgress({
        currentFile: `Generating ${option.label}...`,
        filesAnalyzed: step,
        totalFiles: totalSteps,
        stage: "generating",
      });

      await new Promise((resolve) => setTimeout(resolve, 600));
      step += 3;

      // Formatting stage
      setProgress({
        currentFile: `Formatting ${option.label}...`,
        filesAnalyzed: step,
        totalFiles: totalSteps,
        stage: "formatting",
      });

      await new Promise((resolve) => setTimeout(resolve, 400));
      step += 2;

      // Add generated doc
      const filePaths: Record<DocType, string> = {
        "api-docs": "docs/API.md",
        readme: "README.md",
        architecture: "docs/ARCHITECTURE.md",
        "setup-guide": "docs/SETUP.md",
        contributing: "CONTRIBUTING.md",
      };

      setGeneratedDocs((prev) => [
        ...prev,
        {
          type: docType,
          title: option.label,
          content: `# ${option.label}\n\nGenerated documentation for ${projectName}.\n\n## Overview\n\nThis document was automatically generated by Prometheus.\n\n---\n\n*Last generated: ${new Date().toISOString()}*`,
          filePath: filePaths[docType],
        },
      ]);
    }

    setProgress({
      currentFile: "",
      filesAnalyzed: totalSteps,
      totalFiles: totalSteps,
      stage: "complete",
    });

    setIsGenerating(false);
  }, [selectedTypes, projectName]);

  const handleEditDoc = useCallback((docType: DocType, content: string) => {
    setGeneratedDocs((prev) =>
      prev.map((d) => (d.type === docType ? { ...d, content } : d))
    );
  }, []);

  const handleApplyDoc = useCallback((_doc: GeneratedDoc) => {
    // In production: call API to write file to repo
  }, []);

  const handleApplyAll = useCallback(() => {
    // In production: call API to write all files to repo
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="font-semibold text-lg text-zinc-100">
          Generate Documentation
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Select the types of documentation to generate for {projectName}.
        </p>
      </div>

      {/* Document type selection */}
      {!isGenerating && generatedDocs.length === 0 && (
        <div className="space-y-4">
          <DocTypeSelector
            onToggle={handleToggleType}
            selected={selectedTypes}
          />

          <ScheduleOption
            enabled={autoRegenerate}
            onToggle={() => setAutoRegenerate(!autoRegenerate)}
          />

          <button
            className="w-full rounded-lg bg-violet-600 px-4 py-2.5 font-medium text-sm text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            disabled={selectedTypes.size === 0}
            onClick={handleGenerate}
            type="button"
          >
            Generate Documentation ({selectedTypes.size} selected)
          </button>
        </div>
      )}

      {/* Progress */}
      {isGenerating && progress && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <ProgressIndicator progress={progress} />
        </div>
      )}

      {/* Generated docs preview */}
      {generatedDocs.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm text-zinc-200">
              Generated Documentation
            </h3>
            {!isGenerating && (
              <div className="flex items-center gap-2">
                <button
                  className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-medium text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
                  onClick={() => {
                    setGeneratedDocs([]);
                    setProgress(null);
                  }}
                  type="button"
                >
                  Start Over
                </button>
                <button
                  className="rounded bg-violet-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-violet-500"
                  onClick={handleApplyAll}
                  type="button"
                >
                  Apply All
                </button>
              </div>
            )}
          </div>

          {generatedDocs.map((doc) => (
            <DocPreview
              doc={doc}
              key={doc.type}
              onApply={() => handleApplyDoc(doc)}
              onEdit={(content) => handleEditDoc(doc.type, content)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
