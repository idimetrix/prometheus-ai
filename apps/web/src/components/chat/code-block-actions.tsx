"use client";

import { cn } from "@prometheus/ui";
import {
  Check,
  ClipboardCopy,
  Diff,
  FileDown,
  TextCursorInput,
} from "lucide-react";
import { useCallback, useState } from "react";

// ── Types ───────────────────────────────────────────────────────

interface CodeBlockActionsProps {
  className?: string;
  /** The code content */
  code: string;
  /** File path extracted from the code block's filename annotation */
  filePath?: string;
  /** Language of the code block */
  language?: string;
  /** Callback to apply code to a file */
  onApply?: (code: string, filePath: string) => void;
  /** Callback to show diff view */
  onDiff?: (code: string, filePath: string) => void;
  /** Callback to insert at cursor position in editor */
  onInsert?: (code: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Sub-components ──────────────────────────────────────────────

function ActionButton({
  active,
  children,
  className,
  disabled,
  onClick,
  title,
}: {
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors",
        active
          ? "bg-green-500/20 text-green-300"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200",
        disabled && "cursor-not-allowed opacity-40",
        className
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

// ── Main component ──────────────────────────────────────────────

export function CodeBlockActions({
  code,
  filePath,
  language,
  className,
  onApply,
  onDiff,
  onInsert,
}: CodeBlockActionsProps) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  const handleApply = useCallback(() => {
    if (!(filePath && onApply)) {
      return;
    }
    onApply(code, filePath);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  }, [code, filePath, onApply]);

  const handleDiff = useCallback(() => {
    if (!(filePath && onDiff)) {
      return;
    }
    onDiff(code, filePath);
  }, [code, filePath, onDiff]);

  const handleInsert = useCallback(() => {
    onInsert?.(code);
  }, [code, onInsert]);

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/90 p-1 shadow-lg backdrop-blur-sm",
        className
      )}
    >
      {/* File path indicator */}
      {filePath && (
        <span className="mr-1 max-w-[200px] truncate px-1.5 text-[10px] text-zinc-500">
          {filePath}
        </span>
      )}

      {/* Language badge */}
      {language && (
        <span className="mr-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {language}
        </span>
      )}

      {/* Copy button */}
      <ActionButton
        active={copied}
        onClick={handleCopy}
        title="Copy to clipboard"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            Copied
          </>
        ) : (
          <>
            <ClipboardCopy className="h-3 w-3" />
            Copy
          </>
        )}
      </ActionButton>

      {/* Apply button - only if file path specified */}
      {filePath && onApply && (
        <ActionButton
          active={applied}
          onClick={handleApply}
          title={`Apply to ${filePath}`}
        >
          {applied ? (
            <>
              <Check className="h-3 w-3" />
              Applied
            </>
          ) : (
            <>
              <FileDown className="h-3 w-3" />
              Apply
            </>
          )}
        </ActionButton>
      )}

      {/* Diff button - only if file path specified */}
      {filePath && onDiff && (
        <ActionButton onClick={handleDiff} title={`Show diff for ${filePath}`}>
          <Diff className="h-3 w-3" />
          Diff
        </ActionButton>
      )}

      {/* Insert button */}
      {onInsert && (
        <ActionButton onClick={handleInsert} title="Insert at cursor">
          <TextCursorInput className="h-3 w-3" />
          Insert
        </ActionButton>
      )}
    </div>
  );
}

// ── Wrapper for code blocks in messages ─────────────────────────

interface CodeBlockWithActionsProps {
  children: React.ReactNode;
  /** The raw code content */
  code: string;
  /** File path from ```lang filename="..." */
  filePath?: string;
  /** Code language */
  language?: string;
  /** Callback to apply code to a file */
  onApply?: (code: string, filePath: string) => void;
  /** Callback to show diff view */
  onDiff?: (code: string, filePath: string) => void;
  /** Callback to insert at cursor position */
  onInsert?: (code: string) => void;
}

export function CodeBlockWithActions({
  children,
  code,
  language,
  filePath,
  onApply,
  onDiff,
  onInsert,
}: CodeBlockWithActionsProps) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className="group relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {children}

      {/* Hover actions bar */}
      <div
        className={cn(
          "absolute top-2 right-2 z-10 transition-opacity",
          showActions ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <CodeBlockActions
          code={code}
          filePath={filePath}
          language={language}
          onApply={onApply}
          onDiff={onDiff}
          onInsert={onInsert}
        />
      </div>
    </div>
  );
}
