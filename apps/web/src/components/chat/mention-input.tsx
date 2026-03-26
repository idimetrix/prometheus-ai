"use client";

import { cn } from "@prometheus/ui";
import { Bot, File, FolderOpen, Globe, Link, Search } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ── Types ───────────────────────────────────────────────────────

export type MentionType = "file" | "folder" | "docs" | "web" | "agent";

export interface Mention {
  display: string;
  type: MentionType;
  value: string;
}

export interface MentionCategory {
  description: string;
  icon: React.ReactNode;
  placeholder: string;
  prefix: string;
  type: MentionType;
}

interface MentionInputProps {
  agentRoles?: string[];
  className?: string;
  disabled?: boolean;
  fileResults?: Array<{ path: string; type: "file" | "directory" }>;
  onFileSearch?: (query: string) => void;
  onMentionsChange?: (mentions: Mention[]) => void;
  onSubmit: (content: string, mentions: Mention[]) => void;
  placeholder?: string;
}

// ── Constants ───────────────────────────────────────────────────

const MENTION_CATEGORIES: MentionCategory[] = [
  {
    type: "file",
    prefix: "file:",
    description: "Include file contents in context",
    placeholder: "path/to/file.ts",
    icon: <File className="h-3.5 w-3.5" />,
  },
  {
    type: "folder",
    prefix: "folder:",
    description: "Include file listing of a folder",
    placeholder: "src/components/",
    icon: <FolderOpen className="h-3.5 w-3.5" />,
  },
  {
    type: "docs",
    prefix: "docs:",
    description: "Fetch and include documentation from URL",
    placeholder: "https://react.dev/hooks",
    icon: <Link className="h-3.5 w-3.5" />,
  },
  {
    type: "web",
    prefix: "web:",
    description: "Search the web and include results",
    placeholder: "react useEffect cleanup",
    icon: <Globe className="h-3.5 w-3.5" />,
  },
  {
    type: "agent",
    prefix: "agent:",
    description: "Direct message to a specific agent",
    placeholder: "architect",
    icon: <Bot className="h-3.5 w-3.5" />,
  },
];

const DEFAULT_AGENT_ROLES = [
  "architect",
  "frontend",
  "backend",
  "devops",
  "security",
  "tester",
  "reviewer",
  "designer",
  "database",
  "performance",
  "docs",
  "planner",
];

// ── Fuzzy matching ──────────────────────────────────────────────

function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerText.includes(lowerQuery)) {
    return true;
  }

  // Character-by-character fuzzy match
  let qi = 0;
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      qi++;
    }
  }
  return qi === lowerQuery.length;
}

function fuzzyScore(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Exact prefix match gets highest score
  if (lowerText.startsWith(lowerQuery)) {
    return 100;
  }

  // Substring match
  const idx = lowerText.indexOf(lowerQuery);
  if (idx >= 0) {
    return 80 - idx;
  }

  // Fuzzy character match - lower score
  let qi = 0;
  let score = 0;
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      score += 10;
      qi++;
    }
  }

  return qi === lowerQuery.length ? score : 0;
}

// ── Parse mentions from text ────────────────────────────────────

const MENTION_REGEX = /@(file|folder|docs|web|agent):(\S+)/g;

export function parseMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  let match: RegExpExecArray | null;

  const regex = new RegExp(MENTION_REGEX.source, "g");
  match = regex.exec(text);
  while (match !== null) {
    const type = match[1] as MentionType;
    const value = match[2] ?? "";
    mentions.push({
      type,
      value,
      display: `@${type}:${value}`,
    });
    match = regex.exec(text);
  }

  return mentions;
}

export function stripMentions(text: string): string {
  return text.replace(MENTION_REGEX, "").replace(/\s+/g, " ").trim();
}

// ── Dropdown item component ─────────────────────────────────────

function DropdownItem({
  icon,
  isSelected,
  label,
  onClick,
  sublabel,
}: {
  icon: React.ReactNode;
  isSelected: boolean;
  label: string;
  onClick: () => void;
  sublabel?: string;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800",
        isSelected && "bg-zinc-800"
      )}
      onClick={onClick}
      type="button"
    >
      <span className="shrink-0 text-zinc-400">{icon}</span>
      <span className="min-w-0 truncate text-zinc-200">{label}</span>
      {sublabel && (
        <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
          {sublabel}
        </span>
      )}
    </button>
  );
}

// ── Mention pills (display resolved mentions) ───────────────────

function MentionPill({
  mention,
  onRemove,
}: {
  mention: Mention;
  onRemove: () => void;
}) {
  const colorMap: Record<MentionType, string> = {
    file: "bg-blue-500/10 border-blue-500/20 text-blue-300",
    folder: "bg-amber-500/10 border-amber-500/20 text-amber-300",
    docs: "bg-cyan-500/10 border-cyan-500/20 text-cyan-300",
    web: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
    agent: "bg-violet-500/10 border-violet-500/20 text-violet-300",
  };

  const iconMap: Record<MentionType, React.ReactNode> = {
    file: <File className="h-3 w-3" />,
    folder: <FolderOpen className="h-3 w-3" />,
    docs: <Link className="h-3 w-3" />,
    web: <Globe className="h-3 w-3" />,
    agent: <Bot className="h-3 w-3" />,
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        colorMap[mention.type]
      )}
    >
      {iconMap[mention.type]}
      <span className="max-w-[160px] truncate">{mention.display}</span>
      <button
        className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10"
        onClick={onRemove}
        type="button"
      >
        <span className="text-[10px]">x</span>
      </button>
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────

export function MentionInput({
  onSubmit,
  placeholder = "Message the agent... Type @ for mentions",
  className,
  disabled = false,
  agentRoles = DEFAULT_AGENT_ROLES,
  fileResults = [],
  onFileSearch,
  onMentionsChange,
}: MentionInputProps) {
  const [input, setInput] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownMode, setDropdownMode] = useState<
    "categories" | "file" | "folder" | "agent" | "docs" | "web"
  >("categories");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorMentionStart, setCursorMentionStart] = useState(-1);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync mentions to parent
  useEffect(() => {
    onMentionsChange?.(mentions);
  }, [mentions, onMentionsChange]);

  // Build dropdown items based on mode
  const dropdownItems = useMemo(() => {
    if (dropdownMode === "categories") {
      return MENTION_CATEGORIES.filter((cat) =>
        query
          ? fuzzyMatch(cat.prefix, query) || fuzzyMatch(cat.type, query)
          : true
      ).map((cat) => ({
        icon: cat.icon,
        label: `@${cat.prefix}`,
        sublabel: cat.description,
        value: cat.prefix,
        type: cat.type,
      }));
    }

    if (dropdownMode === "file" || dropdownMode === "folder") {
      const filtered = fileResults
        .filter((f) =>
          dropdownMode === "file" ? f.type === "file" : f.type === "directory"
        )
        .filter((f) => (query ? fuzzyMatch(f.path, query) : true))
        .sort((a, b) => {
          if (!query) {
            return a.path.localeCompare(b.path);
          }
          return fuzzyScore(b.path, query) - fuzzyScore(a.path, query);
        })
        .slice(0, 20);

      return filtered.map((f) => ({
        icon:
          f.type === "directory" ? (
            <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
          ) : (
            <File className="h-3.5 w-3.5 text-blue-400" />
          ),
        label: f.path,
        sublabel: f.type,
        value: f.path,
        type: dropdownMode as MentionType,
      }));
    }

    if (dropdownMode === "agent") {
      return agentRoles
        .filter((role) => (query ? fuzzyMatch(role, query) : true))
        .sort((a, b) => {
          if (!query) {
            return a.localeCompare(b);
          }
          return fuzzyScore(b, query) - fuzzyScore(a, query);
        })
        .map((role) => ({
          icon: <Bot className="h-3.5 w-3.5 text-violet-400" />,
          label: role,
          sublabel: "agent",
          value: role,
          type: "agent" as MentionType,
        }));
    }

    if (dropdownMode === "docs") {
      // Show hint for typing a URL
      return [
        {
          icon: <Link className="h-3.5 w-3.5 text-cyan-400" />,
          label: query || "Type a URL...",
          sublabel: "press Enter to confirm",
          value: query,
          type: "docs" as MentionType,
        },
      ];
    }

    if (dropdownMode === "web") {
      return [
        {
          icon: <Search className="h-3.5 w-3.5 text-emerald-400" />,
          label: query || "Type a search query...",
          sublabel: "press Enter to confirm",
          value: query,
          type: "web" as MentionType,
        },
      ];
    }

    return [];
  }, [dropdownMode, query, fileResults, agentRoles]);

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  const addMention = useCallback(
    (type: MentionType, value: string) => {
      const mention: Mention = {
        type,
        value,
        display: `@${type}:${value}`,
      };
      setMentions((prev) => {
        const exists = prev.some((m) => m.type === type && m.value === value);
        if (exists) {
          return prev;
        }
        return [...prev, mention];
      });

      // Remove the @... text from input
      if (cursorMentionStart >= 0) {
        const before = input.slice(0, cursorMentionStart);
        const cursorPos = textareaRef.current?.selectionStart ?? input.length;
        const after = input.slice(cursorPos);
        setInput(`${before}${after}`);
      }

      setShowDropdown(false);
      setDropdownMode("categories");
      setQuery("");
      setCursorMentionStart(-1);
      textareaRef.current?.focus();
    },
    [input, cursorMentionStart]
  );

  const removeMention = useCallback((index: number) => {
    setMentions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);

      const cursorPos = textareaRef.current?.selectionStart ?? value.length;

      // Find the last @ before cursor
      const textBeforeCursor = value.slice(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");

      if (lastAtIndex >= 0) {
        const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
        const hasNewline = textAfterAt.includes("\n");

        if (!hasNewline) {
          setCursorMentionStart(lastAtIndex);
          setShowDropdown(true);

          // Check if user has typed a category prefix
          const categoryMatch = MENTION_CATEGORIES.find((cat) =>
            textAfterAt.startsWith(cat.prefix)
          );

          if (categoryMatch) {
            setDropdownMode(categoryMatch.type);
            const afterPrefix = textAfterAt.slice(categoryMatch.prefix.length);
            setQuery(afterPrefix);

            // Trigger file search for file/folder types
            if (
              (categoryMatch.type === "file" ||
                categoryMatch.type === "folder") &&
              onFileSearch
            ) {
              onFileSearch(afterPrefix);
            }
          } else {
            setDropdownMode("categories");
            setQuery(textAfterAt);
          }

          return;
        }
      }

      setShowDropdown(false);
      setDropdownMode("categories");
      setQuery("");
      setCursorMentionStart(-1);
    },
    [onFileSearch]
  );

  const handleItemSelect = useCallback(
    (item: { label: string; type: MentionType; value: string }) => {
      if (dropdownMode === "categories") {
        // User selected a category - switch to that mode
        const category = MENTION_CATEGORIES.find((c) => c.type === item.type);
        if (category) {
          setDropdownMode(category.type);
          setQuery("");
          setSelectedIndex(0);

          // Update input text to show the prefix
          if (cursorMentionStart >= 0) {
            const before = input.slice(0, cursorMentionStart);
            const cursorPos =
              textareaRef.current?.selectionStart ?? input.length;
            const after = input.slice(cursorPos);
            const newInput = `${before}@${category.prefix}${after}`;
            setInput(newInput);

            // Set cursor after the prefix
            requestAnimationFrame(() => {
              const newPos = cursorMentionStart + 1 + category.prefix.length;
              textareaRef.current?.setSelectionRange(newPos, newPos);
            });
          }

          if (
            (category.type === "file" || category.type === "folder") &&
            onFileSearch
          ) {
            onFileSearch("");
          }
        }
        return;
      }

      // For docs and web with empty value, don't add
      if ((dropdownMode === "docs" || dropdownMode === "web") && !item.value) {
        return;
      }

      addMention(item.type, item.value);
    },
    [dropdownMode, cursorMentionStart, input, addMention, onFileSearch]
  );

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && mentions.length === 0) {
      return;
    }
    if (disabled) {
      return;
    }

    // Parse any inline mentions from the text
    const inlineMentions = parseMentions(trimmed);
    const allMentions = [...mentions, ...inlineMentions];
    const cleanedContent =
      mentions.length > 0 ? trimmed : stripMentions(trimmed);

    onSubmit(cleanedContent || trimmed, allMentions);
    setInput("");
    setMentions([]);
    setShowDropdown(false);
    setDropdownMode("categories");
    setQuery("");
    setCursorMentionStart(-1);
    textareaRef.current?.focus();
  }, [input, mentions, disabled, onSubmit]);

  const handleKeyDown = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keyboard navigation requires handling many key combinations
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < dropdownItems.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : dropdownItems.length - 1
          );
          return;
        }
        if (
          e.key === "Tab" ||
          (e.key === "Enter" && showDropdown && dropdownItems.length > 0)
        ) {
          e.preventDefault();
          const item = dropdownItems[selectedIndex];
          if (item) {
            handleItemSelect(item);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowDropdown(false);
          setDropdownMode("categories");
          setQuery("");
          setCursorMentionStart(-1);
          return;
        }
      }

      // Send on Enter (no shift, no dropdown)
      if (e.key === "Enter" && !e.shiftKey && !showDropdown) {
        e.preventDefault();
        handleSend();
      }
    },
    [showDropdown, dropdownItems, selectedIndex, handleItemSelect, handleSend]
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className={cn("relative", className)}>
      {/* Mention pills */}
      {mentions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-3">
          {mentions.map((mention, idx) => (
            <MentionPill
              key={`${mention.type}-${mention.value}`}
              mention={mention}
              onRemove={() => removeMention(idx)}
            />
          ))}
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && dropdownItems.length > 0 && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-80 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
          ref={dropdownRef}
        >
          {/* Header */}
          <div className="border-zinc-800 border-b px-3 py-1.5">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              {dropdownMode === "categories"
                ? "Mention types"
                : `Select ${dropdownMode}`}
            </span>
          </div>

          {/* Items */}
          {dropdownItems.map((item, idx) => (
            <DropdownItem
              icon={item.icon}
              isSelected={idx === selectedIndex}
              key={`${item.type}-${item.value}`}
              label={item.label}
              onClick={() => handleItemSelect(item)}
              sublabel={item.sublabel}
            />
          ))}

          {/* Footer hint */}
          <div className="border-zinc-800 border-t px-3 py-1">
            <span className="text-[10px] text-zinc-600">
              Use arrow keys to navigate, Enter to select, Esc to dismiss
            </span>
          </div>
        </div>
      )}

      {/* Input */}
      <textarea
        className={cn(
          "w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none",
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
    </div>
  );
}

// ── Resolved mention display (for chat messages) ────────────────

export interface ResolvedMention {
  content: string;
  isError?: boolean;
  mention: Mention;
}

export function ResolvedMentionBlock({
  resolved,
}: {
  resolved: ResolvedMention;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const iconMap: Record<MentionType, React.ReactNode> = {
    file: <File className="h-3.5 w-3.5 text-blue-400" />,
    folder: <FolderOpen className="h-3.5 w-3.5 text-amber-400" />,
    docs: <Link className="h-3.5 w-3.5 text-cyan-400" />,
    web: <Globe className="h-3.5 w-3.5 text-emerald-400" />,
    agent: <Bot className="h-3.5 w-3.5 text-violet-400" />,
  };

  const bgMap: Record<MentionType, string> = {
    file: "border-blue-500/20 bg-blue-500/5",
    folder: "border-amber-500/20 bg-amber-500/5",
    docs: "border-cyan-500/20 bg-cyan-500/5",
    web: "border-emerald-500/20 bg-emerald-500/5",
    agent: "border-violet-500/20 bg-violet-500/5",
  };

  return (
    <div
      className={cn(
        "my-1 rounded-lg border",
        resolved.isError
          ? "border-red-500/20 bg-red-500/5"
          : bgMap[resolved.mention.type]
      )}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        {iconMap[resolved.mention.type]}
        <span className="font-mono text-xs text-zinc-300">
          {resolved.mention.display}
        </span>
        <span className="ml-auto text-[10px] text-zinc-600">
          {isExpanded ? "collapse" : "expand"}
        </span>
      </button>

      {isExpanded && (
        <div className="border-zinc-800 border-t px-3 py-2">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-400">
            {resolved.content}
          </pre>
        </div>
      )}
    </div>
  );
}
