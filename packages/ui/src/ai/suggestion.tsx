import * as React from "react";
import { cn } from "../lib/utils";

interface SuggestionProps {
  suggestions: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
  className?: string;
}

export function Suggestion({ suggestions, onSelect, className }: SuggestionProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSelect(s.value)}
          className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
