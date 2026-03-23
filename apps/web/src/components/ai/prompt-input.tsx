"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface SlashCommand {
  description: string;
  label: string;
}

interface FileAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

interface AIPromptInputProps {
  attachments?: FileAttachment[];
  className?: string;
  commands?: SlashCommand[];
  disabled?: boolean;
  maxLength?: number;
  onAttach?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
  onSubmit: (value: string) => void;
  onVoiceToggle?: () => void;
  placeholder?: string;
  voiceActive?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function AIPromptInput({
  onSubmit,
  placeholder = "Ask the agent anything...",
  commands = [],
  disabled = false,
  maxLength,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  onVoiceToggle,
  voiceActive = false,
  className = "",
}: AIPromptInputProps) {
  const [value, setValue] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, []);

  // Slash command filtering
  useEffect(() => {
    if (value.startsWith("/") && !value.includes(" ")) {
      const query = value.slice(1).toLowerCase();
      const matches = commands.filter((cmd) =>
        cmd.label.toLowerCase().includes(query)
      );
      setFilteredCommands(matches);
      setShowCommands(matches.length > 0);
    } else {
      setShowCommands(false);
    }
  }, [value, commands]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSubmit(trimmed);
    setValue("");
  }, [value, disabled, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleCommandSelect = useCallback((cmd: SlashCommand) => {
    setValue(`/${cmd.label} `);
    setShowCommands(false);
    textareaRef.current?.focus();
  }, []);

  const handleFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && onAttach) {
        onAttach(e.target.files);
      }
    },
    [onAttach]
  );

  return (
    <div className={`relative ${className}`}>
      {/* Command palette */}
      {showCommands && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
          {filteredCommands.map((cmd) => (
            <button
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-zinc-800"
              key={cmd.label}
              onClick={() => handleCommandSelect(cmd)}
              type="button"
            >
              <span className="font-mono text-blue-400 text-sm">
                /{cmd.label}
              </span>
              <span className="text-xs text-zinc-500">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1 px-3 pt-2">
          {attachments.map((file) => (
            <div
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
              key={file.id}
            >
              <span className="max-w-[120px] truncate">{file.name}</span>
              {onRemoveAttachment && (
                <button
                  className="text-zinc-600 hover:text-zinc-300"
                  onClick={() => onRemoveAttachment(file.id)}
                  type="button"
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 p-2">
        {/* File attachment button */}
        {onAttach && (
          <>
            <button
              aria-label="Attach file"
              className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              onClick={handleFileClick}
              type="button"
            >
              +
            </button>
            <input
              accept="*/*"
              className="hidden"
              multiple
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
          </>
        )}

        <textarea
          className="max-h-48 min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          disabled={disabled}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={textareaRef}
          rows={1}
          value={value}
        />

        {/* Voice input */}
        {onVoiceToggle && (
          <button
            aria-label={voiceActive ? "Stop voice input" : "Start voice input"}
            className={`shrink-0 rounded p-1.5 ${
              voiceActive
                ? "animate-pulse bg-red-900/50 text-red-400"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
            onClick={onVoiceToggle}
            type="button"
          >
            mic
          </button>
        )}

        {/* Submit */}
        <button
          aria-label="Send message"
          className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          disabled={disabled || !value.trim()}
          onClick={handleSubmit}
          type="button"
        >
          Send
        </button>
      </div>

      {/* Character count */}
      {maxLength && (
        <div className="mt-1 text-right text-[10px] text-zinc-600">
          {value.length}/{maxLength}
        </div>
      )}
    </div>
  );
}

export type { AIPromptInputProps, FileAttachment, SlashCommand };
