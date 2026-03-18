import { cn } from "../lib/utils";

interface MessageProps {
  className?: string;
  content: string;
  model?: string;
  role: "user" | "assistant" | "system";
  timestamp?: string;
}

export function Message({
  role,
  content,
  timestamp,
  model,
  className,
}: MessageProps) {
  return (
    <div
      className={cn(
        "flex gap-3 py-4",
        role === "user" && "flex-row-reverse",
        className
      )}
    >
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
      <div
        className={cn(
          "min-w-0 flex-1 space-y-1",
          role === "user" && "text-right"
        )}
      >
        <div className="rounded-lg border p-3">
          <div className="whitespace-pre-wrap break-words text-sm">
            {content}
          </div>
        </div>
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
