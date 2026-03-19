"use client";

import { cn } from "@prometheus/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInputEnhanced } from "@/components/chat/chat-input-enhanced";
import { StreamingMessage } from "@/components/chat/streaming-message";
import type { SuggestedAction } from "@/components/chat/suggested-actions";
import {
  DEFAULT_SUGGESTIONS,
  POST_COMPLETION_SUGGESTIONS,
  POST_ERROR_SUGGESTIONS,
  SuggestedActions,
} from "@/components/chat/suggested-actions";
import { ToolCallInline } from "@/components/chat/tool-call-inline";
import type { ChatMessage, ToolCallData } from "@/stores/chat.store";
import { useChatStore } from "@/stores/chat.store";

// ── Types ───────────────────────────────────────────────────────

export type ChatRole = "user" | "assistant" | "system";

interface ChatPanelProps {
  className?: string;
  conversationId: string;
  disabled?: boolean;
  onSendMessage: (content: string) => void;
}

// ── Message row component ───────────────────────────────────────

function MessageRow({ message }: { message: ChatMessage }) {
  return (
    <div className="px-3 py-1.5">
      <StreamingMessage
        agentRole={message.agentRole}
        content={message.content}
        isStreaming={false}
        model={message.model}
        role={message.role}
      />

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-1 mr-8 ml-0">
          {message.toolCalls.map((tc: ToolCallData) => (
            <ToolCallInline key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Streaming row ───────────────────────────────────────────────

function StreamingRow({ content, model }: { content: string; model?: string }) {
  return (
    <div className="px-3 py-1.5">
      <StreamingMessage content={content} isStreaming model={model} />
    </div>
  );
}

// ── Smart suggestions logic ─────────────────────────────────────

function getSuggestions(messages: ChatMessage[]): SuggestedAction[] {
  if (messages.length === 0) {
    return DEFAULT_SUGGESTIONS;
  }

  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return DEFAULT_SUGGESTIONS;
  }

  // After an error, suggest fixes
  if (
    lastMessage.role === "system" ||
    lastMessage.content.toLowerCase().includes("error") ||
    lastMessage.content.toLowerCase().includes("failed")
  ) {
    return POST_ERROR_SUGGESTIONS;
  }

  // After assistant completion, suggest next steps
  if (lastMessage.role === "assistant") {
    const content = lastMessage.content.toLowerCase();
    if (
      content.includes("complete") ||
      content.includes("done") ||
      content.includes("finished")
    ) {
      return POST_COMPLETION_SUGGESTIONS;
    }
  }

  return DEFAULT_SUGGESTIONS;
}

// ── Virtual row content ─────────────────────────────────────────

function VirtualRowContent({
  isStreaming,
  msg,
  activeStreamingMessages,
  streamingIdx,
}: {
  activeStreamingMessages: Array<{ content: string; model?: string }>;
  isStreaming: boolean;
  msg: ChatMessage | undefined;
  streamingIdx: number;
}) {
  if (isStreaming) {
    return (
      <StreamingRow
        content={activeStreamingMessages[streamingIdx]?.content ?? ""}
        model={activeStreamingMessages[streamingIdx]?.model}
      />
    );
  }

  if (msg) {
    return <MessageRow message={msg} />;
  }

  return null;
}

// ── Main component ──────────────────────────────────────────────

export function ChatPanel({
  conversationId,
  onSendMessage,
  disabled = false,
  className,
}: ChatPanelProps) {
  const { conversations, streamingMessages, ensureConversation } =
    useChatStore();

  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  // Ensure conversation exists
  useEffect(() => {
    ensureConversation(conversationId);
  }, [conversationId, ensureConversation]);

  const conversation = conversations.get(conversationId);
  const messages = conversation?.messages ?? [];

  // Get all streaming messages for this conversation
  const activeStreamingMessages = useMemo(
    () => Array.from(streamingMessages.values()).filter((sm) => sm.isStreaming),
    [streamingMessages]
  );

  // Total row count = messages + streaming messages
  const totalCount = messages.length + activeStreamingMessages.length;

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 5,
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (!userScrolledUp && totalCount > 0) {
      virtualizer.scrollToIndex(totalCount - 1, { align: "end" });
    }
  }, [totalCount, userScrolledUp, virtualizer]);

  // Track user scroll position
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) {
      return;
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setUserScrolledUp(!isNearBottom);
  }, []);

  const handleSend = useCallback(
    (content: string) => {
      onSendMessage(content);
      setUserScrolledUp(false);
    },
    [onSendMessage]
  );

  const handleSuggestedAction = useCallback(
    (action: SuggestedAction) => {
      const content = action.command ?? action.label;
      onSendMessage(content);
      setUserScrolledUp(false);
    },
    [onSendMessage]
  );

  const suggestions = getSuggestions(messages);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          Chat
        </h3>
      </div>

      {/* Virtualized message list */}
      <div
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
        ref={parentRef}
      >
        {totalCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <div className="text-xs text-zinc-600">
              No messages yet. Start a conversation.
            </div>
            <SuggestedActions
              onSelect={handleSuggestedAction}
              suggestions={DEFAULT_SUGGESTIONS}
            />
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const isStreaming = virtualRow.index >= messages.length;
              const streamingIdx = virtualRow.index - messages.length;
              const msg = isStreaming ? undefined : messages[virtualRow.index];

              return (
                <div
                  className="absolute top-0 left-0 w-full"
                  data-index={virtualRow.index}
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <VirtualRowContent
                    activeStreamingMessages={activeStreamingMessages}
                    isStreaming={isStreaming}
                    msg={msg}
                    streamingIdx={streamingIdx}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scroll-to-bottom indicator */}
      {userScrolledUp && totalCount > 0 && (
        <div className="flex justify-center border-zinc-800 border-t py-1">
          <button
            className="rounded-full bg-zinc-800 px-3 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
            onClick={() => {
              virtualizer.scrollToIndex(totalCount - 1, { align: "end" });
              setUserScrolledUp(false);
            }}
            type="button"
          >
            Scroll to bottom
          </button>
        </div>
      )}

      {/* Suggested actions */}
      {!disabled && messages.length > 0 && (
        <div className="border-zinc-800 border-t px-3 py-2">
          <SuggestedActions
            onSelect={handleSuggestedAction}
            suggestions={suggestions}
          />
        </div>
      )}

      {/* Enhanced input */}
      <ChatInputEnhanced disabled={disabled} onSend={handleSend} />
    </div>
  );
}
