import { cn } from "../lib/utils";

interface SuggestionProps {
  className?: string;
  onSelect: (value: string) => void;
  suggestions: Array<{ label: string; value: string }>;
}

export function Suggestion({
  suggestions,
  onSelect,
  className,
}: SuggestionProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {suggestions.map((s, i) => (
        <button
          className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
          key={i}
          onClick={() => onSelect(s.value)}
          type="button"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
