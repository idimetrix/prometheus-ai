import { cn } from "../lib/utils";

interface CheckpointProps {
  className?: string;
  id: string;
  label: string;
  onRestore?: (id: string) => void;
  timestamp: string;
}

export function Checkpoint({
  id,
  label,
  timestamp,
  onRestore,
  className,
}: CheckpointProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-blue-500/30 border-dashed bg-blue-500/5 px-3 py-2",
        className
      )}
    >
      <span className="text-blue-500 text-sm">⊙</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-blue-600 text-sm">
          {label}
        </div>
        <div className="text-muted-foreground text-xs">{timestamp}</div>
      </div>
      {onRestore && (
        <button
          className="shrink-0 text-blue-500 text-xs hover:text-blue-400"
          onClick={() => onRestore(id)}
          type="button"
        >
          Restore
        </button>
      )}
    </div>
  );
}
