"use client";
import { type KeyboardEvent, useRef, useState } from "react";
import { cn } from "../lib/utils";

interface PromptInputProps {
  className?: string;
  disabled?: boolean;
  onSubmit: (value: string) => void;
  placeholder?: string;
}

export function PromptInput({
  onSubmit,
  placeholder = "Describe your task...",
  disabled = false,
  className,
}: PromptInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSubmit(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-lg border bg-background p-2",
        className
      )}
    >
      <textarea
        className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />
      <button
        className="shrink-0 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled || !value.trim()}
        onClick={handleSubmit}
        type="button"
      >
        Send
      </button>
    </div>
  );
}
