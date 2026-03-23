"use client";

import { cn } from "@prometheus/ui";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileDiff,
  FileText,
  Globe,
  Loader2,
  Search,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import type { ToolCallData } from "@/stores/chat.store";

// ── Types ───────────────────────────────────────────────────────

interface ToolCallInlineProps {
  className?: string;
  toolCall: ToolCallData;
}

// ── Language icon mapping ───────────────────────────────────────

const FILE_EXTENSION_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  py: "Python",
  rs: "Rust",
  go: "Go",
  rb: "Ruby",
  java: "Java",
  css: "CSS",
  html: "HTML",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
};

function getFileLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return FILE_EXTENSION_LABELS[ext] ?? ext.toUpperCase();
}

function formatToolResult(result: unknown): string | null {
  if (!result) {
    return null;
  }
  if (typeof result === "string") {
    return result;
  }
  return JSON.stringify(result, null, 2);
}

function formatLineRange(
  startLine: number | undefined,
  endLine: number | undefined
): string | null {
  if (startLine !== undefined && endLine !== undefined) {
    return `L${startLine}-${endLine}`;
  }
  if (startLine !== undefined) {
    return `L${startLine}+`;
  }
  return null;
}

// ── Status indicator ────────────────────────────────────────────

function StatusIndicator({ status }: { status: ToolCallData["status"] }) {
  switch (status) {
    case "pending":
      return (
        <span className="flex items-center gap-1 text-[10px] text-zinc-500">
          <Clock className="h-3 w-3" />
          Pending
        </span>
      );
    case "running":
      return (
        <span className="flex items-center gap-1 text-[10px] text-violet-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="flex items-center gap-1 text-[10px] text-green-400">
          <CheckCircle2 className="h-3 w-3" />
          Done
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-[10px] text-red-400">
          <AlertCircle className="h-3 w-3" />
          Error
        </span>
      );
    default:
      return null;
  }
}

// ── Copy button ─────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      className="flex items-center gap-1 text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
      onClick={handleCopy}
      type="button"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          Copy
        </>
      )}
    </button>
  );
}

// ── Duration display ────────────────────────────────────────────

function DurationDisplay({ durationMs }: { durationMs?: number }) {
  if (durationMs === undefined) {
    return null;
  }
  const display =
    durationMs < 1000
      ? `${durationMs}ms`
      : `${(durationMs / 1000).toFixed(1)}s`;

  return (
    <span className="flex items-center gap-1 text-[10px] text-zinc-600">
      <Clock className="h-2.5 w-2.5" />
      {display}
    </span>
  );
}

// ── Collapsible card wrapper ────────────────────────────────────

function ToolCard({
  children,
  className,
  copyText,
  durationMs,
  icon,
  status,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  copyText?: string;
  durationMs?: number;
  icon: React.ReactNode;
  status: ToolCallData["status"];
  title: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <button
          className="flex items-center gap-1.5 text-zinc-400 transition-colors hover:text-zinc-200"
          onClick={() => setCollapsed(!collapsed)}
          type="button"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {icon}
          <span className="font-medium text-xs">{title}</span>
        </button>
        <div className="ml-auto flex items-center gap-3">
          <DurationDisplay durationMs={durationMs} />
          <StatusIndicator status={status} />
          {copyText && <CopyButton text={copyText} />}
        </div>
      </div>

      {/* Content */}
      {!collapsed && <div className="p-3">{children}</div>}
    </div>
  );
}

// ── File Read Card ──────────────────────────────────────────────

function FileReadCard({ toolCall }: { toolCall: ToolCallData }) {
  const filePath =
    (toolCall.args.path as string) ??
    (toolCall.args.file_path as string) ??
    "unknown";
  const startLine = toolCall.args.start_line as number | undefined;
  const endLine = toolCall.args.end_line as number | undefined;
  const language = getFileLanguage(filePath);
  const content = formatToolResult(toolCall.result);

  const lineRange = formatLineRange(startLine, endLine);

  return (
    <ToolCard
      copyText={content ?? filePath}
      durationMs={toolCall.durationMs}
      icon={<FileText className="h-3.5 w-3.5 text-blue-400" />}
      status={toolCall.status}
      title="Read File"
    >
      <div className="space-y-2">
        {/* File path */}
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-zinc-300">
            {filePath}
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {language}
          </span>
          {lineRange && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {lineRange}
            </span>
          )}
        </div>

        {/* Preview */}
        {content && (
          <div className="max-h-48 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2">
            <pre className="font-mono text-[11px] text-zinc-400 leading-relaxed">
              {content.length > 2000 ? `${content.slice(0, 2000)}...` : content}
            </pre>
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ── Terminal Exec Card ──────────────────────────────────────────

function TerminalExecCard({ toolCall }: { toolCall: ToolCallData }) {
  const command =
    (toolCall.args.command as string) ??
    (toolCall.args.cmd as string) ??
    "unknown";
  const result = toolCall.result as {
    exit_code?: number;
    exitCode?: number;
    output?: string;
    stdout?: string;
    stderr?: string;
  } | null;

  const exitCode = result?.exit_code ?? result?.exitCode;
  const output = result?.output ?? result?.stdout ?? "";
  const stderr = result?.stderr ?? "";

  return (
    <ToolCard
      copyText={command}
      durationMs={toolCall.durationMs}
      icon={<Terminal className="h-3.5 w-3.5 text-green-400" />}
      status={toolCall.status}
      title="Terminal"
    >
      <div className="space-y-2">
        {/* Command */}
        <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <span className="select-none text-green-500 text-xs">$</span>
          <code className="flex-1 font-mono text-xs text-zinc-200">
            {command}
          </code>
          {exitCode !== undefined && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10px]",
                exitCode === 0
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              )}
            >
              exit {exitCode}
            </span>
          )}
        </div>

        {/* Output */}
        {output && (
          <div className="max-h-40 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2">
            <pre className="font-mono text-[11px] text-zinc-400 leading-relaxed">
              {output.length > 3000 ? `${output.slice(0, 3000)}...` : output}
            </pre>
          </div>
        )}

        {/* Stderr */}
        {stderr && (
          <div className="max-h-24 overflow-auto rounded border border-red-900/30 bg-red-950/20 p-2">
            <pre className="font-mono text-[11px] text-red-400 leading-relaxed">
              {stderr.length > 1000 ? `${stderr.slice(0, 1000)}...` : stderr}
            </pre>
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ── File Edit / Write Card ──────────────────────────────────────

function FileEditCard({ toolCall }: { toolCall: ToolCallData }) {
  const filePath =
    (toolCall.args.path as string) ??
    (toolCall.args.file_path as string) ??
    "unknown";
  const oldContent = (toolCall.args.old_string as string) ?? null;
  const newContent =
    (toolCall.args.new_string as string) ??
    (toolCall.args.content as string) ??
    null;
  const language = getFileLanguage(filePath);
  const isWrite = toolCall.name === "file_write" || !oldContent;

  return (
    <ToolCard
      copyText={newContent ?? filePath}
      durationMs={toolCall.durationMs}
      icon={<FileDiff className="h-3.5 w-3.5 text-amber-400" />}
      status={toolCall.status}
      title={isWrite ? "Write File" : "Edit File"}
    >
      <div className="space-y-2">
        {/* File path */}
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-zinc-300">
            {filePath}
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {language}
          </span>
        </div>

        {/* Before (for edits) */}
        {oldContent && (
          <div className="space-y-1">
            <span className="font-medium text-[10px] text-red-400">Before</span>
            <div className="max-h-32 overflow-auto rounded border border-red-900/30 bg-red-950/10 p-2">
              <pre className="font-mono text-[11px] text-red-300/80 leading-relaxed">
                {oldContent.length > 1500
                  ? `${oldContent.slice(0, 1500)}...`
                  : oldContent}
              </pre>
            </div>
          </div>
        )}

        {/* After */}
        {newContent && (
          <div className="space-y-1">
            <span className="font-medium text-[10px] text-green-400">
              {isWrite ? "Content" : "After"}
            </span>
            <div className="max-h-32 overflow-auto rounded border border-green-900/30 bg-green-950/10 p-2">
              <pre className="font-mono text-[11px] text-green-300/80 leading-relaxed">
                {newContent.length > 1500
                  ? `${newContent.slice(0, 1500)}...`
                  : newContent}
              </pre>
            </div>
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ── Search Card ─────────────────────────────────────────────────

function SearchCard({ toolCall }: { toolCall: ToolCallData }) {
  const query =
    (toolCall.args.query as string) ??
    (toolCall.args.pattern as string) ??
    "unknown";
  const results = toolCall.result as Array<{
    file?: string;
    path?: string;
    snippet?: string;
    line?: number;
  }> | null;

  return (
    <ToolCard
      copyText={query}
      durationMs={toolCall.durationMs}
      icon={<Search className="h-3.5 w-3.5 text-cyan-400" />}
      status={toolCall.status}
      title="Search"
    >
      <div className="space-y-2">
        {/* Query */}
        <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <Search className="h-3 w-3 text-zinc-500" />
          <code className="font-mono text-xs text-zinc-300">{query}</code>
        </div>

        {/* Results */}
        {Array.isArray(results) && results.length > 0 && (
          <div className="max-h-48 space-y-1 overflow-auto">
            {results.slice(0, 10).map((result) => {
              const resultPath = result.file ?? result.path ?? "unknown";
              return (
                <div
                  className="flex items-start gap-2 rounded border border-zinc-800/50 bg-zinc-900/30 px-2 py-1.5"
                  key={`${resultPath}-${result.line ?? "n"}-${result.snippet?.slice(0, 20) ?? "s"}`}
                >
                  <FileText className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[11px] text-zinc-300">
                        {resultPath}
                      </span>
                      {result.line !== undefined && (
                        <span className="text-[10px] text-zinc-600">
                          L{result.line}
                        </span>
                      )}
                    </div>
                    {result.snippet && (
                      <pre className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
                        {result.snippet}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
            {results.length > 10 && (
              <div className="px-2 text-[10px] text-zinc-600">
                ...and {results.length - 10} more results
              </div>
            )}
          </div>
        )}

        {Array.isArray(results) && results.length === 0 && (
          <div className="px-2 py-1 text-[11px] text-zinc-600">
            No results found
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ── Browser Card ────────────────────────────────────────────────

function BrowserCard({ toolCall }: { toolCall: ToolCallData }) {
  const url = (toolCall.args.url as string) ?? "unknown";
  const result = toolCall.result as { title?: string; content?: string } | null;

  return (
    <ToolCard
      copyText={url}
      durationMs={toolCall.durationMs}
      icon={<Globe className="h-3.5 w-3.5 text-purple-400" />}
      status={toolCall.status}
      title="Browser"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <Globe className="h-3 w-3 text-zinc-500" />
          <a
            className="truncate font-mono text-violet-400 text-xs hover:underline"
            href={url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {url}
          </a>
        </div>

        {result?.title && (
          <div className="text-xs text-zinc-300">{result.title}</div>
        )}

        {result?.content && (
          <div className="max-h-32 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2">
            <pre className="font-mono text-[11px] text-zinc-400 leading-relaxed">
              {result.content.length > 2000
                ? `${result.content.slice(0, 2000)}...`
                : result.content}
            </pre>
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ── Generic fallback card ───────────────────────────────────────

function GenericToolCard({ toolCall }: { toolCall: ToolCallData }) {
  const argsStr = JSON.stringify(toolCall.args, null, 2);
  const resultStr = toolCall.result
    ? JSON.stringify(toolCall.result, null, 2)
    : null;

  return (
    <ToolCard
      copyText={argsStr}
      durationMs={toolCall.durationMs}
      icon={<Terminal className="h-3.5 w-3.5 text-zinc-400" />}
      status={toolCall.status}
      title={toolCall.name}
    >
      <div className="space-y-2">
        <div className="space-y-1">
          <span className="font-medium text-[10px] text-zinc-500">Args</span>
          <div className="max-h-32 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2">
            <pre className="font-mono text-[11px] text-zinc-400 leading-relaxed">
              {argsStr}
            </pre>
          </div>
        </div>

        {resultStr && (
          <div className="space-y-1">
            <span className="font-medium text-[10px] text-zinc-500">
              Result
            </span>
            <div className="max-h-32 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2">
              <pre className="font-mono text-[11px] text-zinc-400 leading-relaxed">
                {resultStr.length > 2000
                  ? `${resultStr.slice(0, 2000)}...`
                  : resultStr}
              </pre>
            </div>
          </div>
        )}
      </div>
    </ToolCard>
  );
}

// ── Main component ──────────────────────────────────────────────

const TOOL_CARD_MAP: Record<
  string,
  (props: { toolCall: ToolCallData }) => React.ReactNode
> = {
  file_read: FileReadCard,
  read_file: FileReadCard,
  terminal_exec: TerminalExecCard,
  bash: TerminalExecCard,
  run_command: TerminalExecCard,
  file_edit: FileEditCard,
  file_write: FileEditCard,
  edit_file: FileEditCard,
  write_file: FileEditCard,
  search_text: SearchCard,
  search_semantic: SearchCard,
  grep: SearchCard,
  ripgrep: SearchCard,
  browser_open: BrowserCard,
  web_fetch: BrowserCard,
};

export function ToolCallInline({ toolCall, className }: ToolCallInlineProps) {
  const CardComponent = TOOL_CARD_MAP[toolCall.name];

  if (CardComponent) {
    return (
      <div className={className}>
        <CardComponent toolCall={toolCall} />
      </div>
    );
  }

  return (
    <div className={className}>
      <GenericToolCard toolCall={toolCall} />
    </div>
  );
}
