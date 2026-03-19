"use client";

import { type ComponentPropsWithoutRef, type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils";

// ── Types ───────────────────────────────────────────────────────

interface ToolCallRenderData {
  args: Record<string, unknown>;
  durationMs?: number;
  id: string;
  name: string;
  result?: unknown;
  status: "pending" | "running" | "completed" | "error";
}

interface MessageProps {
  className?: string;
  content: string;
  model?: string;
  onApplyToEditor?: (code: string, language: string) => void;
  renderToolCall?: (toolCall: ToolCallRenderData) => ReactNode;
  role: "user" | "assistant" | "system";
  timestamp?: string;
  toolCalls?: ToolCallRenderData[];
}

// ── Language detection ──────────────────────────────────────────

const LANGUAGE_REGEX = /language-(\w+)/;

const LANGUAGE_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  js: "JavaScript",
  jsx: "JSX",
  javascript: "JavaScript",
  py: "Python",
  python: "Python",
  rs: "Rust",
  rust: "Rust",
  go: "Go",
  rb: "Ruby",
  ruby: "Ruby",
  java: "Java",
  css: "CSS",
  html: "HTML",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  markdown: "Markdown",
  sql: "SQL",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  dockerfile: "Dockerfile",
  graphql: "GraphQL",
  toml: "TOML",
  xml: "XML",
  text: "Text",
};

function getLanguageLabel(language: string): string {
  return LANGUAGE_LABELS[language.toLowerCase()] ?? language;
}

// ── Interactive code block ──────────────────────────────────────

function InteractiveCodeBlock({
  children,
  className,
  language,
  onApplyToEditor,
}: {
  children: ReactNode;
  className?: string;
  language: string;
  onApplyToEditor?: (code: string, language: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const extractText = (): string => {
    if (typeof children === "string") {
      return children;
    }
    const props = children as { props?: { children?: string } } | null;
    return String(props?.props?.children ?? "");
  };

  const handleCopy = async () => {
    const text = extractText();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    const text = extractText();
    onApplyToEditor?.(text, language);
  };

  return (
    <div
      className={cn(
        "group relative my-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
          {getLanguageLabel(language)}
        </span>
        <div className="flex items-center gap-2">
          {onApplyToEditor && (
            <button
              className="text-xs text-zinc-500 transition-colors hover:text-violet-300"
              onClick={handleApply}
              type="button"
            >
              Apply to Editor
            </button>
          )}
          <button
            className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={handleCopy}
            type="button"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Code content */}
      <div className="overflow-x-auto p-3">
        <pre className="font-mono text-sm text-zinc-200">{children}</pre>
      </div>
    </div>
  );
}

// ── Rich message content renderer ───────────────────────────────

function RichContent({
  content,
  onApplyToEditor,
}: {
  content: string;
  onApplyToEditor?: (code: string, language: string) => void;
}) {
  return (
    <div
      className={cn(
        "prose prose-invert prose-sm max-w-none",
        "prose-headings:font-semibold prose-headings:text-zinc-200",
        "prose-p:text-zinc-300 prose-p:leading-relaxed",
        "prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline",
        "prose-strong:text-zinc-200",
        "prose-code:text-violet-300 prose-code:before:content-none prose-code:after:content-none",
        "prose-li:text-zinc-300",
        "prose-blockquote:border-zinc-700 prose-blockquote:text-zinc-400"
      )}
    >
      <ReactMarkdown
        components={{
          a: ({
            href,
            children: linkChildren,
            ...props
          }: ComponentPropsWithoutRef<"a">) => (
            <a href={href} rel="noopener noreferrer" target="_blank" {...props}>
              {linkChildren}
            </a>
          ),
          code: ({
            className: codeClassName,
            children: codeChildren,
            ...props
          }) => {
            const match = LANGUAGE_REGEX.exec(codeClassName ?? "");
            const isBlock =
              typeof codeChildren === "string" && codeChildren.includes("\n");

            if (match || isBlock) {
              const language = match?.[1] ?? "text";
              return (
                <InteractiveCodeBlock
                  language={language}
                  onApplyToEditor={onApplyToEditor}
                >
                  <code className={codeClassName} {...props}>
                    {codeChildren}
                  </code>
                </InteractiveCodeBlock>
              );
            }

            return (
              <code
                className={cn(
                  "rounded bg-zinc-800 px-1 py-0.5 font-mono text-violet-300 text-xs",
                  codeClassName
                )}
                {...props}
              >
                {codeChildren}
              </code>
            );
          },
          pre: ({ children: preChildren }) => <>{preChildren}</>,
          table: ({
            children: tableChildren,
            ...props
          }: ComponentPropsWithoutRef<"table">) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full border-collapse text-sm" {...props}>
                {tableChildren}
              </table>
            </div>
          ),
          thead: ({
            children: theadChildren,
            ...props
          }: ComponentPropsWithoutRef<"thead">) => (
            <thead
              className="border-zinc-800 border-b bg-zinc-900/50"
              {...props}
            >
              {theadChildren}
            </thead>
          ),
          th: ({
            children: thChildren,
            ...props
          }: ComponentPropsWithoutRef<"th">) => (
            <th
              className="px-3 py-2 text-left font-medium text-xs text-zinc-400"
              {...props}
            >
              {thChildren}
            </th>
          ),
          td: ({
            children: tdChildren,
            ...props
          }: ComponentPropsWithoutRef<"td">) => (
            <td
              className="border-zinc-800 border-t px-3 py-2 text-xs text-zinc-300"
              {...props}
            >
              {tdChildren}
            </td>
          ),
        }}
        rehypePlugins={[rehypeRaw]}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

export function Message({
  role,
  content,
  timestamp,
  model,
  className,
  toolCalls,
  renderToolCall,
  onApplyToEditor,
}: MessageProps) {
  return (
    <div
      className={cn(
        "flex gap-3 py-4",
        role === "user" && "flex-row-reverse",
        className
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-medium text-xs",
          role === "user" && "bg-blue-500 text-white",
          role === "assistant" && "bg-zinc-800 text-zinc-200",
          role === "system" && "bg-yellow-500/20 text-yellow-600"
        )}
      >
        {(
          { user: "U", assistant: "AI", system: "S" } as Record<string, string>
        )[role] ?? (role[0] ?? "?").toUpperCase()}
      </div>

      {/* Message body */}
      <div
        className={cn(
          "min-w-0 flex-1 space-y-1",
          role === "user" && "text-right"
        )}
      >
        {/* Content */}
        <div className="rounded-lg border p-3">
          {role === "user" ? (
            <div className="whitespace-pre-wrap break-words text-sm">
              {content}
            </div>
          ) : (
            <RichContent content={content} onApplyToEditor={onApplyToEditor} />
          )}
        </div>

        {/* Tool calls */}
        {toolCalls && toolCalls.length > 0 && renderToolCall && (
          <div className="space-y-1">
            {toolCalls.map((tc) => (
              <div key={tc.id}>{renderToolCall(tc)}</div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          {timestamp && <span>{timestamp}</span>}
          {model && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {model}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
