"use client";

import { create } from "zustand";

// ── Types ───────────────────────────────────────────────────────

export interface StreamingMessage {
  content: string;
  id: string;
  isStreaming: boolean;
  model?: string;
  role: "assistant";
  tokens: number;
}

export interface ContextChip {
  label: string;
  type: "file" | "symbol" | "directory" | "url";
  value: string;
}

export interface Attachment {
  file: File;
  id: string;
  name: string;
  previewUrl?: string;
  size: number;
  type: string;
}

export interface ChatMessage {
  agentRole?: string;
  attachments?: Attachment[];
  content: string;
  contextChips?: ContextChip[];
  id: string;
  model?: string;
  role: "user" | "assistant" | "system";
  timestamp: string;
  toolCalls?: ToolCallData[];
}

export interface ToolCallData {
  args: Record<string, unknown>;
  durationMs?: number;
  id: string;
  name: string;
  result?: unknown;
  status: "pending" | "running" | "completed" | "error";
}

export interface Conversation {
  createdAt: string;
  id: string;
  messages: ChatMessage[];
  title?: string;
  updatedAt: string;
}

export type ChatMode = "task" | "ask" | "plan" | "watch" | "fleet";

// ── Store ───────────────────────────────────────────────────────

interface ChatState {
  activeConversationId: string | null;

  // Actions
  addAttachment: (file: File) => void;
  addContextChip: (chip: ContextChip) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  addToolCall: (
    conversationId: string,
    messageId: string,
    toolCall: ToolCallData
  ) => void;
  appendStreamingContent: (messageId: string, token: string) => void;
  attachments: Attachment[];
  clearConversation: (conversationId: string) => void;
  contextChips: ContextChip[];
  conversations: Map<string, Conversation>;
  ensureConversation: (conversationId: string) => void;
  finalizeStreamingMessage: (messageId: string, conversationId: string) => void;
  mode: ChatMode;
  removeAttachment: (id: string) => void;
  removeContextChip: (value: string) => void;
  sendMessage: (conversationId: string, content: string) => void;
  setActiveConversation: (id: string | null) => void;
  setMode: (mode: ChatMode) => void;
  startStreamingMessage: (messageId: string, model?: string) => void;
  streamingMessages: Map<string, StreamingMessage>;
  updateToolCall: (
    conversationId: string,
    messageId: string,
    toolCallId: string,
    updates: Partial<ToolCallData>
  ) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: new Map(),
  activeConversationId: null,
  streamingMessages: new Map(),
  attachments: [],
  contextChips: [],
  mode: "task",

  setActiveConversation: (id) => set({ activeConversationId: id }),

  setMode: (mode) => set({ mode }),

  ensureConversation: (conversationId) => {
    const { conversations } = get();
    if (conversations.has(conversationId)) {
      return;
    }
    const now = new Date().toISOString();
    const updated = new Map(conversations);
    updated.set(conversationId, {
      id: conversationId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
    set({ conversations: updated });
  },

  sendMessage: (conversationId, content) => {
    const { conversations, attachments, contextChips } = get();
    const conversation = conversations.get(conversationId);
    const now = new Date().toISOString();

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: now,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      contextChips: contextChips.length > 0 ? [...contextChips] : undefined,
    };

    const updated = new Map(conversations);
    if (conversation) {
      updated.set(conversationId, {
        ...conversation,
        messages: [...conversation.messages, message],
        updatedAt: now,
      });
    } else {
      updated.set(conversationId, {
        id: conversationId,
        messages: [message],
        createdAt: now,
        updatedAt: now,
      });
    }

    set({
      conversations: updated,
      attachments: [],
      contextChips: [],
    });
  },

  addMessage: (conversationId, message) => {
    const { conversations } = get();
    const conversation = conversations.get(conversationId);
    const now = new Date().toISOString();

    const updated = new Map(conversations);
    if (conversation) {
      updated.set(conversationId, {
        ...conversation,
        messages: [...conversation.messages, message],
        updatedAt: now,
      });
    } else {
      updated.set(conversationId, {
        id: conversationId,
        messages: [message],
        createdAt: now,
        updatedAt: now,
      });
    }

    set({ conversations: updated });
  },

  startStreamingMessage: (messageId, model) => {
    const { streamingMessages } = get();
    const updated = new Map(streamingMessages);
    updated.set(messageId, {
      id: messageId,
      content: "",
      role: "assistant",
      model,
      isStreaming: true,
      tokens: 0,
    });
    set({ streamingMessages: updated });
  },

  appendStreamingContent: (messageId, token) => {
    const { streamingMessages } = get();
    const msg = streamingMessages.get(messageId);
    if (!msg) {
      return;
    }
    const updated = new Map(streamingMessages);
    updated.set(messageId, {
      ...msg,
      content: msg.content + token,
      tokens: msg.tokens + 1,
    });
    set({ streamingMessages: updated });
  },

  finalizeStreamingMessage: (messageId, conversationId) => {
    const { streamingMessages, conversations } = get();
    const streaming = streamingMessages.get(messageId);
    if (!streaming) {
      return;
    }

    const conversation = conversations.get(conversationId);
    const now = new Date().toISOString();

    const finalMessage: ChatMessage = {
      id: messageId,
      role: "assistant",
      content: streaming.content,
      model: streaming.model,
      timestamp: now,
    };

    const updatedStreaming = new Map(streamingMessages);
    updatedStreaming.delete(messageId);

    const updatedConversations = new Map(conversations);
    if (conversation) {
      updatedConversations.set(conversationId, {
        ...conversation,
        messages: [...conversation.messages, finalMessage],
        updatedAt: now,
      });
    } else {
      updatedConversations.set(conversationId, {
        id: conversationId,
        messages: [finalMessage],
        createdAt: now,
        updatedAt: now,
      });
    }

    set({
      streamingMessages: updatedStreaming,
      conversations: updatedConversations,
    });
  },

  addToolCall: (conversationId, messageId, toolCall) => {
    const { conversations } = get();
    const conversation = conversations.get(conversationId);
    if (!conversation) {
      return;
    }

    const updatedMessages = conversation.messages.map((msg) => {
      if (msg.id === messageId) {
        return {
          ...msg,
          toolCalls: [...(msg.toolCalls ?? []), toolCall],
        };
      }
      return msg;
    });

    const updated = new Map(conversations);
    updated.set(conversationId, {
      ...conversation,
      messages: updatedMessages,
      updatedAt: new Date().toISOString(),
    });
    set({ conversations: updated });
  },

  updateToolCall: (conversationId, messageId, toolCallId, updates) => {
    const { conversations } = get();
    const conversation = conversations.get(conversationId);
    if (!conversation) {
      return;
    }

    const updatedMessages = conversation.messages.map((msg) => {
      if (msg.id === messageId && msg.toolCalls) {
        return {
          ...msg,
          toolCalls: msg.toolCalls.map((tc) =>
            tc.id === toolCallId ? { ...tc, ...updates } : tc
          ),
        };
      }
      return msg;
    });

    const updated = new Map(conversations);
    updated.set(conversationId, {
      ...conversation,
      messages: updatedMessages,
      updatedAt: new Date().toISOString(),
    });
    set({ conversations: updated });
  },

  addAttachment: (file) => {
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type,
      file,
      previewUrl: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined,
    };
    set((state) => ({
      attachments: [...state.attachments, attachment],
    }));
  },

  removeAttachment: (id) => {
    set((state) => {
      const attachment = state.attachments.find((a) => a.id === id);
      if (attachment?.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      return {
        attachments: state.attachments.filter((a) => a.id !== id),
      };
    });
  },

  addContextChip: (chip) => {
    set((state) => {
      const exists = state.contextChips.some((c) => c.value === chip.value);
      if (exists) {
        return state;
      }
      return { contextChips: [...state.contextChips, chip] };
    });
  },

  removeContextChip: (value) => {
    set((state) => ({
      contextChips: state.contextChips.filter((c) => c.value !== value),
    }));
  },

  clearConversation: (conversationId) => {
    const { conversations } = get();
    const updated = new Map(conversations);
    const conversation = updated.get(conversationId);
    if (conversation) {
      updated.set(conversationId, {
        ...conversation,
        messages: [],
        updatedAt: new Date().toISOString(),
      });
    }
    set({ conversations: updated });
  },
}));
