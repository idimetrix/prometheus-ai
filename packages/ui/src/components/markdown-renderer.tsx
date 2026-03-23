"use client";

import { type ComponentPropsWithoutRef, type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils";

const LANGUAGE_REGEX = /language-(\w+)/;

interface MarkdownRendererProps {
  className?: string;
  content: string;
}

function CodeBlockWrapper({
  children,
  className,
  language,
}: {
  children: ReactNode;
  className?: string;
  language: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text =
      typeof children === "string"
        ? children
        : ((children as { props?: { children?: string } })?.props?.children ??
          "");
    await navigator.clipboard.writeText(String(text));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        "group relative my-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950",
        className
      )}
    >
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
          {language}
        </span>
        <button
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="overflow-x-auto p-3">
        <pre className="font-mono text-sm text-zinc-200">{children}</pre>
      </div>
    </div>
  );
}

export function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
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
        "prose-blockquote:border-zinc-700 prose-blockquote:text-zinc-400",
        className
      )}
    >
      <ReactMarkdown
        components={{
          a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
            <a href={href} rel="noopener noreferrer" target="_blank" {...props}>
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const match = LANGUAGE_REGEX.exec(codeClassName ?? "");
            const isBlock =
              typeof children === "string" && children.includes("\n");

            if (match || isBlock) {
              const language = match?.[1] ?? "text";
              return (
                <CodeBlockWrapper language={language}>
                  <code className={codeClassName} {...props}>
                    {children}
                  </code>
                </CodeBlockWrapper>
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
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          table: ({
            children,
            ...props
          }: ComponentPropsWithoutRef<"table">) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full border-collapse text-sm" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({
            children,
            ...props
          }: ComponentPropsWithoutRef<"thead">) => (
            <thead
              className="border-zinc-800 border-b bg-zinc-900/50"
              {...props}
            >
              {children}
            </thead>
          ),
          th: ({ children, ...props }: ComponentPropsWithoutRef<"th">) => (
            <th
              className="px-3 py-2 text-left font-medium text-xs text-zinc-400"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }: ComponentPropsWithoutRef<"td">) => (
            <td
              className="border-zinc-800 border-t px-3 py-2 text-xs text-zinc-300"
              {...props}
            >
              {children}
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
