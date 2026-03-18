import * as React from "react";
import { cn } from "../lib/utils";

interface MessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  model?: string;
  className?: string;
}

export function Message({ role, content, timestamp, model, className }: MessageProps) {
  return (
    <div className={cn(
      "flex gap-3 py-4",
      role === "user" && "flex-row-reverse",
      className
    )}>
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
        role === "user" && "bg-blue-500 text-white",
        role === "assistant" && "bg-zinc-800 text-zinc-200",
        role === "system" && "bg-yellow-500/20 text-yellow-600",
      )}>
        {role === "user" ? "U" : role === "assistant" ? "AI" : "S"}
      </div>
      <div className={cn(
        "flex-1 space-y-1 min-w-0",
        role === "user" && "text-right"
      )}>
        <div className="rounded-lg border p-3">
          <div className="text-sm whitespace-pre-wrap break-words">{content}</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {timestamp && <span>{timestamp}</span>}
          {model && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{model}</span>}
        </div>
      </div>
    </div>
  );
}
