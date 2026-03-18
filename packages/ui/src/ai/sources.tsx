import * as React from "react";
import { cn } from "../lib/utils";

interface Source {
  type: "file" | "url" | "memory";
  path: string;
  label?: string;
  relevance?: number;
}

interface SourcesProps {
  sources: Source[];
  onSourceClick?: (source: Source) => void;
  className?: string;
}

export function Sources({ sources, onSourceClick, className }: SourcesProps) {
  if (sources.length === 0) return null;

  const icons: Record<Source["type"], string> = {
    file: "📄",
    url: "🔗",
    memory: "🧠",
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className="text-xs font-medium text-muted-foreground">Sources</div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source, i) => (
          <button
            key={i}
            onClick={() => onSourceClick?.(source)}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted transition-colors"
          >
            <span>{icons[source.type]}</span>
            <span className="truncate max-w-[200px]">{source.label ?? source.path}</span>
            {source.relevance !== undefined && (
              <span className="text-muted-foreground ml-1">{Math.round(source.relevance * 100)}%</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
