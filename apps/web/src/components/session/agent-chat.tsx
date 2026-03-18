"use client";

import { useCallback, useRef, useState } from "react";

interface AgentChatProps {
  onSendMessage: (content: string) => void;
  sessionId: string;
}

export function AgentChat({
  sessionId: _sessionId,
  onSendMessage,
}: AgentChatProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    onSendMessage(trimmed);
    setInput("");
    inputRef.current?.focus();
  }, [input, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex flex-col border-zinc-800 border-t">
      <div className="p-3">
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the agent... (Shift+Enter for newline)"
            ref={inputRef}
            rows={2}
            value={input}
          />
          <button
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-sm text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!input.trim()}
            onClick={handleSend}
            type="button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
