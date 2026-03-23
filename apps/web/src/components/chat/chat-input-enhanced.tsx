"use client";

import { cn } from "@prometheus/ui";
import {
  AtSign,
  ChevronDown,
  ClipboardList,
  Eye,
  File,
  FileUp,
  FolderOpen,
  Hash,
  Link,
  MessageSquare,
  Paperclip,
  Send,
  Slash,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Attachment, ChatMode, ContextChip } from "@/stores/chat.store";
import { useChatStore } from "@/stores/chat.store";

// ── Types ───────────────────────────────────────────────────────

interface ChatInputEnhancedProps {
  className?: string;
  disabled?: boolean;
  fileSearchResults?: Array<{
    label: string;
    path: string;
    type: "file" | "directory";
  }>;
  onFileSearch?: (query: string) => void;
  onSend: (content: string) => void;
  onSymbolSearch?: (query: string) => void;
  placeholder?: string;
  symbolSearchResults?: Array<{
    label: string;
    symbol: string;
    type: "symbol";
  }>;
}

interface SlashCommand {
  command: string;
  description: string;
  icon: React.ReactNode;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/task",
    description: "Create a new task",
    icon: <Zap className="h-3.5 w-3.5" />,
  },
  {
    command: "/ask",
    description: "Ask a question without executing",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
  {
    command: "/plan",
    description: "Create a step-by-step plan",
    icon: <ClipboardList className="h-3.5 w-3.5" />,
  },
  {
    command: "/review",
    description: "Review code changes",
    icon: <Eye className="h-3.5 w-3.5" />,
  },
  {
    command: "/test",
    description: "Generate or run tests",
    icon: <Hash className="h-3.5 w-3.5" />,
  },
  {
    command: "/fix",
    description: "Fix lint or type errors",
    icon: <Zap className="h-3.5 w-3.5" />,
  },
  {
    command: "/explain",
    description: "Explain selected code",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
];

const MODE_OPTIONS: Array<{
  icon: React.ReactNode;
  label: string;
  value: ChatMode;
}> = [
  { label: "Task", value: "task", icon: <Zap className="h-3.5 w-3.5" /> },
  {
    label: "Ask",
    value: "ask",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
  {
    label: "Plan",
    value: "plan",
    icon: <ClipboardList className="h-3.5 w-3.5" />,
  },
  { label: "Watch", value: "watch", icon: <Eye className="h-3.5 w-3.5" /> },
  {
    label: "Fleet",
    value: "fleet",
    icon: <Users className="h-3.5 w-3.5" />,
  },
];

const DEFAULT_MODE = {
  icon: <Zap className="h-3.5 w-3.5" />,
  label: "Task",
  value: "task" as ChatMode,
};

// ── Helpers ─────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Context chip display ────────────────────────────────────────

function ContextChipPill({
  chip,
  onRemove,
}: {
  chip: ContextChip;
  onRemove: () => void;
}) {
  const iconMap = {
    file: <File className="h-3 w-3" />,
    symbol: <Hash className="h-3 w-3" />,
    directory: <FolderOpen className="h-3 w-3" />,
    url: <Link className="h-3 w-3" />,
  };

  const colorMap = {
    file: "bg-blue-500/10 border-blue-500/20 text-blue-300",
    symbol: "bg-violet-500/10 border-violet-500/20 text-violet-300",
    directory: "bg-amber-500/10 border-amber-500/20 text-amber-300",
    url: "bg-cyan-500/10 border-cyan-500/20 text-cyan-300",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        colorMap[chip.type]
      )}
    >
      {iconMap[chip.type]}
      <span className="max-w-[120px] truncate">{chip.label}</span>
      <button
        className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10"
        onClick={onRemove}
        type="button"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// ── Attachment preview ──────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const sizeDisplay = formatFileSize(attachment.size);

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5">
      {attachment.previewUrl ? (
        <div
          aria-label={attachment.name}
          className="h-8 w-8 shrink-0 rounded bg-center bg-cover"
          role="img"
          style={{ backgroundImage: `url(${attachment.previewUrl})` }}
        />
      ) : (
        <FileUp className="h-4 w-4 text-zinc-500" />
      )}
      <div className="min-w-0">
        <div className="max-w-[120px] truncate text-[11px] text-zinc-300">
          {attachment.name}
        </div>
        <div className="text-[10px] text-zinc-600">{sizeDisplay}</div>
      </div>
      <button
        className="absolute -top-1.5 -right-1.5 rounded-full border border-zinc-700 bg-zinc-800 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={onRemove}
        type="button"
      >
        <X className="h-3 w-3 text-zinc-400" />
      </button>
    </div>
  );
}

// ── Mention popup ───────────────────────────────────────────────

function MentionPopup({
  items,
  onSelect,
  selectedIndex,
}: {
  items: Array<{ label: string; type: ContextChip["type"]; value: string }>;
  onSelect: (item: {
    label: string;
    type: ContextChip["type"];
    value: string;
  }) => void;
  selectedIndex: number;
}) {
  if (items.length === 0) {
    return null;
  }

  const iconMap = {
    file: <File className="h-3 w-3 text-blue-400" />,
    symbol: <Hash className="h-3 w-3 text-violet-400" />,
    directory: <FolderOpen className="h-3 w-3 text-amber-400" />,
    url: <Link className="h-3 w-3 text-cyan-400" />,
  };

  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 max-h-48 w-72 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
      {items.map((item, idx) => (
        <button
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800",
            idx === selectedIndex && "bg-zinc-800"
          )}
          key={item.value}
          onClick={() => onSelect(item)}
          type="button"
        >
          {iconMap[item.type]}
          <span className="min-w-0 truncate text-zinc-300">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Slash command popup ─────────────────────────────────────────

function SlashCommandPopup({
  commands,
  onSelect,
  selectedIndex,
}: {
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
  selectedIndex: number;
}) {
  if (commands.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 max-h-48 w-72 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
      {commands.map((cmd, idx) => (
        <button
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-zinc-800",
            idx === selectedIndex && "bg-zinc-800"
          )}
          key={cmd.command}
          onClick={() => onSelect(cmd)}
          type="button"
        >
          <span className="text-zinc-500">{cmd.icon}</span>
          <span className="font-mono text-violet-300 text-xs">
            {cmd.command}
          </span>
          <span className="ml-auto text-[10px] text-zinc-600">
            {cmd.description}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Drag zone wrapper ───────────────────────────────────────────

function DropZone({
  children,
  className,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  children: React.ReactNode;
  className?: string;
  onDragLeave: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  return (
    <section
      aria-label="File drop zone"
      className={className}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </section>
  );
}

// ── Main component ──────────────────────────────────────────────

export function ChatInputEnhanced({
  onSend,
  placeholder = "Message the agent... (Shift+Enter for newline)",
  className,
  disabled = false,
  fileSearchResults = [],
  symbolSearchResults = [],
  onFileSearch,
  onSymbolSearch,
}: ChatInputEnhancedProps) {
  const [input, setInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [showSlashPopup, setShowSlashPopup] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [slashQuery, setSlashQuery] = useState("");
  const [popupSelectedIndex, setPopupSelectedIndex] = useState(0);
  const [showModeSelector, setShowModeSelector] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    attachments,
    contextChips,
    mode,
    addAttachment,
    removeAttachment,
    addContextChip,
    removeContextChip,
    setMode,
  } = useChatStore();

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  // Build mention items from search results
  const mentionItems = [
    ...fileSearchResults.map((f) => ({
      label: f.label,
      value: f.path,
      type: f.type as ContextChip["type"],
    })),
    ...symbolSearchResults.map((s) => ({
      label: s.label,
      value: s.symbol,
      type: "symbol" as const,
    })),
  ].filter((item) =>
    mentionQuery
      ? item.label.toLowerCase().includes(mentionQuery.toLowerCase())
      : true
  );

  // Filter slash commands
  const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
    slashQuery
      ? cmd.command.toLowerCase().includes(slashQuery.toLowerCase())
      : true
  );

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setInput("");
    setShowMentionPopup(false);
    setShowSlashPopup(false);
    textareaRef.current?.focus();
  }, [input, disabled, onSend]);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);

      // Check for @mention trigger
      const lastAtIndex = value.lastIndexOf("@");
      if (lastAtIndex >= 0) {
        const textAfterAt = value.slice(lastAtIndex + 1);
        const hasSpace = textAfterAt.includes(" ");
        if (
          !hasSpace &&
          lastAtIndex === value.length - 1 - textAfterAt.length + 1
        ) {
          setShowMentionPopup(true);
          setMentionQuery(textAfterAt);
          setPopupSelectedIndex(0);
          onFileSearch?.(textAfterAt);
          onSymbolSearch?.(textAfterAt);
          return;
        }
      }

      // Check for /slash command trigger
      if (value.startsWith("/")) {
        const hasSpace = value.includes(" ");
        if (!hasSpace) {
          setShowSlashPopup(true);
          setSlashQuery(value);
          setPopupSelectedIndex(0);
          setShowMentionPopup(false);
          return;
        }
      }

      setShowMentionPopup(false);
      setShowSlashPopup(false);
    },
    [onFileSearch, onSymbolSearch]
  );

  const handleMentionSelect = useCallback(
    (item: { label: string; type: ContextChip["type"]; value: string }) => {
      addContextChip({
        type: item.type,
        value: item.value,
        label: item.label,
      });

      // Remove the @query from input
      const lastAtIndex = input.lastIndexOf("@");
      if (lastAtIndex >= 0) {
        setInput(input.slice(0, lastAtIndex));
      }
      setShowMentionPopup(false);
      textareaRef.current?.focus();
    },
    [input, addContextChip]
  );

  const handleSlashSelect = useCallback(
    (command: SlashCommand) => {
      const modeMap: Record<string, ChatMode> = {
        "/task": "task",
        "/ask": "ask",
        "/plan": "plan",
      };

      const mappedMode = modeMap[command.command];
      if (mappedMode) {
        setMode(mappedMode);
        setInput("");
      } else {
        setInput(`${command.command} `);
      }

      setShowSlashPopup(false);
      textareaRef.current?.focus();
    },
    [setMode]
  );

  const handlePopupKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const items = showMentionPopup ? mentionItems : filteredCommands;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPopupSelectedIndex((prev) =>
          prev < items.length - 1 ? prev + 1 : 0
        );
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPopupSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : items.length - 1
        );
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (showMentionPopup && mentionItems[popupSelectedIndex]) {
          handleMentionSelect(mentionItems[popupSelectedIndex]);
        } else if (showSlashPopup && filteredCommands[popupSelectedIndex]) {
          handleSlashSelect(filteredCommands[popupSelectedIndex]);
        }
        return true;
      }
      if (e.key === "Escape") {
        setShowMentionPopup(false);
        setShowSlashPopup(false);
        return true;
      }
      return false;
    },
    [
      showMentionPopup,
      mentionItems,
      filteredCommands,
      popupSelectedIndex,
      showSlashPopup,
      handleMentionSelect,
      handleSlashSelect,
    ]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((showMentionPopup || showSlashPopup) && handlePopupKeyDown(e)) {
        return;
      }

      // Send on Enter (no shift)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showMentionPopup, showSlashPopup, handlePopupKeyDown, handleSend]
  );

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        addAttachment(file);
      }
    },
    [addAttachment]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      for (const file of files) {
        addAttachment(file);
      }
      e.target.value = "";
    },
    [addAttachment]
  );

  const tokenEstimate = estimateTokens(input);
  const currentMode =
    MODE_OPTIONS.find((m) => m.value === mode) ?? DEFAULT_MODE;

  return (
    <DropZone
      className={cn("relative border-zinc-800 border-t", className)}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-violet-500 border-dashed bg-violet-500/10">
          <div className="flex items-center gap-2 text-sm text-violet-300">
            <FileUp className="h-5 w-5" />
            Drop files here
          </div>
        </div>
      )}

      {/* Mention popup */}
      {showMentionPopup && (
        <div className="relative px-3">
          <MentionPopup
            items={mentionItems}
            onSelect={handleMentionSelect}
            selectedIndex={popupSelectedIndex}
          />
        </div>
      )}

      {/* Slash command popup */}
      {showSlashPopup && (
        <div className="relative px-3">
          <SlashCommandPopup
            commands={filteredCommands}
            onSelect={handleSlashSelect}
            selectedIndex={popupSelectedIndex}
          />
        </div>
      )}

      <div className="p-3">
        {/* Context chips row */}
        {contextChips.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {contextChips.map((chip) => (
              <ContextChipPill
                chip={chip}
                key={chip.value}
                onRemove={() => removeContextChip(chip.value)}
              />
            ))}
          </div>
        )}

        {/* Attachments row */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <AttachmentPreview
                attachment={att}
                key={att.id}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <textarea
              className={cn(
                "w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 pr-20 text-sm text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none",
                disabled && "cursor-not-allowed opacity-50"
              )}
              disabled={disabled}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              ref={textareaRef}
              rows={1}
              value={input}
            />

            {/* Inline actions */}
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              {input.length > 0 && (
                <span className="mr-1 text-[10px] text-zinc-600 tabular-nums">
                  ~{tokenEstimate} tokens
                </span>
              )}

              <label className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300">
                <Paperclip className="h-3.5 w-3.5" />
                <input
                  accept="*/*"
                  className="hidden"
                  multiple
                  onChange={handleFileInputChange}
                  type="file"
                />
              </label>

              <button
                className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
                onClick={() => {
                  setInput(`${input}@`);
                  handleInputChange(`${input}@`);
                  textareaRef.current?.focus();
                }}
                title="Mention file or symbol"
                type="button"
              >
                <AtSign className="h-3.5 w-3.5" />
              </button>

              <button
                className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
                onClick={() => {
                  setInput("/");
                  handleInputChange("/");
                  textareaRef.current?.focus();
                }}
                title="Slash commands"
                type="button"
              >
                <Slash className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Mode selector */}
          <div className="relative">
            <button
              className="flex h-full items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-300 transition-colors hover:border-zinc-600"
              onClick={() => setShowModeSelector(!showModeSelector)}
              type="button"
            >
              {currentMode.icon}
              <span className="hidden sm:inline">{currentMode.label}</span>
              <ChevronDown className="h-3 w-3 text-zinc-500" />
            </button>

            {showModeSelector && (
              <div className="absolute right-0 bottom-full z-50 mb-2 w-36 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                {MODE_OPTIONS.map((opt) => (
                  <button
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800",
                      mode === opt.value && "bg-zinc-800 text-violet-300"
                    )}
                    key={opt.value}
                    onClick={() => {
                      setMode(opt.value);
                      setShowModeSelector(false);
                    }}
                    type="button"
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Send button */}
          <button
            className="shrink-0 self-end rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!input.trim() || disabled}
            onClick={handleSend}
            type="button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* Character count */}
        {input.length > 0 && (
          <div className="mt-1 flex justify-end">
            <span className="text-[10px] text-zinc-600 tabular-nums">
              {input.length} chars
            </span>
          </div>
        )}
      </div>
    </DropZone>
  );
}
