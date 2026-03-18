import { cn } from "../lib/utils";

interface Source {
  label?: string;
  path: string;
  relevance?: number;
  type: "file" | "url" | "memory";
}

interface SourcesProps {
  className?: string;
  onSourceClick?: (source: Source) => void;
  sources: Source[];
}

export function Sources({ sources, onSourceClick, className }: SourcesProps) {
  if (sources.length === 0) {
    return null;
  }

  const icons: Record<Source["type"], string> = {
    file: "📄",
    url: "🔗",
    memory: "🧠",
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className="font-medium text-muted-foreground text-xs">Sources</div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source, i) => (
          <button
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted"
            key={i}
            onClick={() => onSourceClick?.(source)}
            type="button"
          >
            <span>{icons[source.type]}</span>
            <span className="max-w-[200px] truncate">
              {source.label ?? source.path}
            </span>
            {source.relevance !== undefined && (
              <span className="ml-1 text-muted-foreground">
                {Math.round(source.relevance * 100)}%
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
