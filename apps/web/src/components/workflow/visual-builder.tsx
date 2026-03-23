"use client";

/**
 * Visual workflow builder -- drag-and-drop agent workflow composition.
 *
 * Provides a canvas area with a sidebar of available block types.
 * Users build workflows by adding blocks in sequence, configuring
 * each block, and then running the pipeline.
 *
 * This is a UI skeleton; actual execution integration comes later.
 */

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlockKind =
  | "prompt"
  | "code_generate"
  | "test"
  | "review"
  | "deploy"
  | "notify"
  | "approve"
  | "condition";

export interface WorkflowBlock {
  config: Record<string, string>;
  description: string;
  id: string;
  kind: BlockKind;
  title: string;
}

interface BlockTemplate {
  description: string;
  icon: string;
  kind: BlockKind;
  title: string;
}

// ---------------------------------------------------------------------------
// Block catalogue
// ---------------------------------------------------------------------------

const BLOCK_TEMPLATES: BlockTemplate[] = [
  {
    kind: "prompt",
    title: "Prompt",
    description: "Send a prompt to an AI agent",
    icon: "M",
  },
  {
    kind: "code_generate",
    title: "Code Generate",
    description: "Generate code from a specification",
    icon: "</>",
  },
  {
    kind: "test",
    title: "Test",
    description: "Run test suite and collect results",
    icon: "T",
  },
  {
    kind: "review",
    title: "Review",
    description: "AI code review pass",
    icon: "R",
  },
  {
    kind: "deploy",
    title: "Deploy",
    description: "Deploy to staging or production",
    icon: "D",
  },
  {
    kind: "notify",
    title: "Notify",
    description: "Send notification (Slack, email)",
    icon: "N",
  },
  {
    kind: "approve",
    title: "Approve",
    description: "Wait for human approval",
    icon: "A",
  },
  {
    kind: "condition",
    title: "Condition",
    description: "Branch based on a condition",
    icon: "?",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1;

function createBlock(template: BlockTemplate): WorkflowBlock {
  const id = `block_${nextId++}`;
  return {
    id,
    kind: template.kind,
    title: template.title,
    description: template.description,
    config: {},
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BlockSidebar({ onAdd }: { onAdd: (template: BlockTemplate) => void }) {
  return (
    <aside className="w-56 shrink-0 space-y-2 overflow-y-auto border-border border-r p-3">
      <h3 className="mb-2 font-semibold text-sm">Blocks</h3>
      {BLOCK_TEMPLATES.map((template) => (
        <button
          className="flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left text-sm transition-colors hover:bg-accent"
          key={template.kind}
          onClick={() => onAdd(template)}
          type="button"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary/10 font-mono text-primary text-xs">
            {template.icon}
          </span>
          <span>
            <span className="block font-medium text-xs">{template.title}</span>
            <span className="block text-[11px] text-muted-foreground">
              {template.description}
            </span>
          </span>
        </button>
      ))}
    </aside>
  );
}

function BlockCard({
  block,
  index,
  onRemove,
  onConfigChange,
}: {
  block: WorkflowBlock;
  index: number;
  onRemove: (id: string) => void;
  onConfigChange: (id: string, key: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 font-mono text-[11px] text-primary">
            {index + 1}
          </span>
          <span className="font-medium text-sm">{block.title}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {block.kind}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="Toggle config"
            className="rounded px-1.5 py-0.5 text-muted-foreground text-xs hover:bg-muted"
            onClick={() => setExpanded(!expanded)}
            type="button"
          >
            {expanded ? "Hide" : "Config"}
          </button>
          <button
            aria-label="Remove block"
            className="rounded px-1.5 py-0.5 text-destructive text-xs hover:bg-destructive/10"
            onClick={() => onRemove(block.id)}
            type="button"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Config form (expanded) */}
      {expanded && (
        <div className="space-y-2 border-border border-t px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {block.description}
          </p>
          <label className="block text-xs">
            <span className="text-muted-foreground">Instructions</span>
            <input
              className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-sm"
              onChange={(e) =>
                onConfigChange(block.id, "instructions", e.target.value)
              }
              placeholder="Enter block-specific instructions..."
              type="text"
              value={block.config.instructions ?? ""}
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Timeout (seconds)</span>
            <input
              className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-sm"
              onChange={(e) =>
                onConfigChange(block.id, "timeout", e.target.value)
              }
              placeholder="300"
              type="number"
              value={block.config.timeout ?? ""}
            />
          </label>
        </div>
      )}

      {/* Connector arrow */}
      <div className="flex justify-center py-1">
        <div className="h-4 w-px bg-border" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VisualBuilder() {
  const [blocks, setBlocks] = useState<WorkflowBlock[]>([]);

  const handleAdd = useCallback((template: BlockTemplate) => {
    setBlocks((prev) => [...prev, createBlock(template)]);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleConfigChange = useCallback(
    (id: string, key: string, value: string) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, config: { ...b.config, [key]: value } } : b
        )
      );
    },
    []
  );

  const handleRun = useCallback(() => {
    // TODO: Send pipeline to orchestrator API
    const _pipeline = blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      title: b.title,
      config: b.config,
    }));
  }, [blocks]);

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-border bg-background">
      {/* Sidebar */}
      <BlockSidebar onAdd={handleAdd} />

      {/* Canvas */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-border border-b px-4 py-2">
          <h2 className="font-semibold text-sm">Workflow Builder</h2>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {blocks.length} block{blocks.length === 1 ? "" : "s"}
            </span>
            <button
              className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
              disabled={blocks.length === 0}
              onClick={handleRun}
              type="button"
            >
              Run Workflow
            </button>
          </div>
        </div>

        {/* Block list (vertical layout v1) */}
        <div className="flex-1 overflow-y-auto p-4">
          {blocks.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              Add blocks from the sidebar to build your workflow.
            </div>
          ) : (
            <div className="mx-auto max-w-md space-y-1">
              {blocks.map((block, index) => (
                <BlockCard
                  block={block}
                  index={index}
                  key={block.id}
                  onConfigChange={handleConfigChange}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
