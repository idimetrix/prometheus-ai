import * as React from "react";
import { cn } from "../lib/utils";

interface CheckpointProps {
  id: string;
  label: string;
  timestamp: string;
  onRestore?: (id: string) => void;
  className?: string;
}

export function Checkpoint({ id, label, timestamp, onRestore, className }: CheckpointProps) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border border-dashed border-blue-500/30 bg-blue-500/5 px-3 py-2",
      className
    )}>
      <span className="text-blue-500 text-sm">⊙</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-blue-600 truncate">{label}</div>
        <div className="text-xs text-muted-foreground">{timestamp}</div>
      </div>
      {onRestore && (
        <button
          onClick={() => onRestore(id)}
          className="text-xs text-blue-500 hover:text-blue-400 shrink-0"
        >
          Restore
        </button>
      )}
    </div>
  );
}
