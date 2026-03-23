"use client";

import { useEffect, useRef, useState } from "react";

const ROLE_COLORS: Record<string, string> = {
  architect: "bg-violet-500/20 text-violet-400",
  "backend-coder": "bg-blue-500/20 text-blue-400",
  "frontend-coder": "bg-cyan-500/20 text-cyan-400",
  "test-engineer": "bg-green-500/20 text-green-400",
  "security-auditor": "bg-red-500/20 text-red-400",
  discovery: "bg-amber-500/20 text-amber-400",
  "ci-loop": "bg-orange-500/20 text-orange-400",
};

export interface AgentMessage {
  from: string;
  id: string;
  message: string;
  timestamp: string;
}

interface InterAgentLogProps {
  messages: AgentMessage[];
}

export function InterAgentLog({ messages }: InterAgentLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isNearBottom);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          Agent Communication
        </h3>
      </div>

      <div
        className="flex-1 overflow-y-auto p-2"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {messages.length === 0 ? (
          <div className="py-4 text-center text-xs text-zinc-600">
            No inter-agent messages yet
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg) => (
              <div
                className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2"
                key={msg.id}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-600">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 font-medium text-[10px] ${
                      ROLE_COLORS[msg.from] ?? "bg-zinc-500/20 text-zinc-400"
                    }`}
                  >
                    {msg.from}
                  </span>
                </div>
                <div className="mt-1 text-xs text-zinc-300">{msg.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!autoScroll && messages.length > 0 && (
        <button
          className="border-zinc-800 border-t bg-zinc-900/80 px-3 py-1 text-center text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          type="button"
        >
          Scroll to latest
        </button>
      )}
    </div>
  );
}
