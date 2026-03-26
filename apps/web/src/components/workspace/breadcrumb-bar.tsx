"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session.store";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface BreadcrumbSegment {
  active: boolean;
  id: string;
  label: string;
  type: "project" | "path" | "agent" | "file" | "symbol";
}

interface DropdownItem {
  id: string;
  isActive: boolean;
  label: string;
}

interface BreadcrumbDropdownProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  items: DropdownItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Separator                                                                  */
/* -------------------------------------------------------------------------- */

function ChevronSeparator() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3 shrink-0 text-zinc-600"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        d="M8.25 4.5l7.5 7.5-7.5 7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Dropdown                                                                   */
/* -------------------------------------------------------------------------- */

function BreadcrumbDropdown({
  items,
  onSelect,
  onClose,
  anchorRef,
}: BreadcrumbDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Position dropdown below the anchor
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose, anchorRef]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, items.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter": {
          e.preventDefault();
          const item = items[focusedIndex];
          if (item) {
            onSelect(item.id);
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        default:
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [items, focusedIndex, onSelect, onClose]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute top-full left-0 z-50 mt-1 max-h-60 min-w-[180px] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
      ref={dropdownRef}
      role="listbox"
    >
      {items.map((item, idx) => (
        <button
          aria-selected={idx === focusedIndex}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
            item.isActive ? "text-violet-300" : "text-zinc-300"
          } ${idx === focusedIndex ? "bg-zinc-800" : "hover:bg-zinc-800/60"}`}
          key={item.id}
          onClick={() => onSelect(item.id)}
          role="option"
          type="button"
        >
          {item.isActive && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
          )}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Breadcrumb Segment Button                                                  */
/* -------------------------------------------------------------------------- */

function BreadcrumbButton({
  segment,
  isLast,
  dropdownItems,
  onSelect,
}: {
  dropdownItems: DropdownItem[];
  isLast: boolean;
  onSelect: (segmentType: string, id: string) => void;
  segment: BreadcrumbSegment;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    if (dropdownItems.length > 0) {
      setIsOpen((prev) => !prev);
    }
  }, [dropdownItems.length]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(segment.type, id);
      setIsOpen(false);
    },
    [onSelect, segment.type]
  );

  return (
    <div className="relative flex items-center">
      <button
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors ${
          isLast ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
        } ${isOpen ? "bg-zinc-800 text-zinc-200" : "hover:bg-zinc-800/50"} ${
          dropdownItems.length > 0 ? "cursor-pointer" : "cursor-default"
        }`}
        onClick={handleClick}
        ref={buttonRef}
        type="button"
      >
        <span className="max-w-[140px] truncate">{segment.label}</span>
        {dropdownItems.length > 0 && (
          <svg
            aria-hidden="true"
            className={`h-2.5 w-2.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {isOpen && (
        <BreadcrumbDropdown
          anchorRef={buttonRef}
          items={dropdownItems}
          onClose={() => setIsOpen(false)}
          onSelect={handleSelect}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function buildPathSegments(
  filePath: string,
  _fileTree: Array<{ name: string; path: string; type: string }>
): BreadcrumbSegment[] {
  const parts = filePath.split("/").filter(Boolean);
  const segments: BreadcrumbSegment[] = [];

  let currentPath = "";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    segments.push({
      id: currentPath,
      label: part,
      active: true,
      type: currentPath === filePath ? "file" : "path",
    });
  }

  return segments;
}

function getSiblingsForPath(
  path: string,
  fileTree: Array<{
    children?: Array<{ name: string; path: string; type: string }>;
    name: string;
    path: string;
    type: string;
  }>
): DropdownItem[] {
  // Find parent directory
  const parentPath = path.split("/").slice(0, -1).join("/");

  function findChildren(
    nodes: typeof fileTree,
    targetPath: string
  ): DropdownItem[] {
    if (!targetPath) {
      return nodes.map((n) => ({
        id: n.path,
        label: n.name,
        isActive: n.path === path,
      }));
    }

    for (const node of nodes) {
      if (node.path === targetPath && node.children) {
        return node.children.map((c) => ({
          id: c.path,
          label: c.name,
          isActive: c.path === path,
        }));
      }
      if (node.children) {
        const found = findChildren(node.children, targetPath);
        if (found.length > 0) {
          return found;
        }
      }
    }

    return [];
  }

  return findChildren(fileTree, parentPath);
}

/* -------------------------------------------------------------------------- */
/*  Symbols (functions, classes, etc.)                                          */
/* -------------------------------------------------------------------------- */

const SYMBOL_REGEX =
  /(?:export\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g;

function extractSymbols(content: string): DropdownItem[] {
  const symbols: DropdownItem[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
  while ((match = SYMBOL_REGEX.exec(content)) !== null) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      symbols.push({ id: name, label: name, isActive: false });
    }
  }

  return symbols;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface BreadcrumbBarProps {
  /** Optional: current file content for symbol extraction */
  fileContent?: string;
  /** Optional: callback when a breadcrumb selection changes navigation */
  onNavigate?: (type: string, id: string) => void;
  /** Optional: list of user's projects for the project dropdown */
  projects?: Array<{ id: string; name: string }>;
}

export function BreadcrumbBar({
  projects,
  fileContent,
  onNavigate,
}: BreadcrumbBarProps) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeFilePath = useSessionStore((s) => s.activeFilePath);
  const agents = useSessionStore((s) => s.agents);
  const fileTree = useSessionStore((s) => s.fileTree);

  const activeAgent = agents.find((a) => a.status === "working");

  // Build segments
  const segments: BreadcrumbSegment[] = [];

  // Project segment
  segments.push({
    id: "project",
    label: "Project",
    active: true,
    type: "project",
  });

  // Session segment
  if (activeSessionId) {
    segments.push({
      id: activeSessionId,
      label: activeSessionId.slice(0, 8),
      active: true,
      type: "path",
    });
  }

  // Agent segment
  if (activeAgent) {
    segments.push({
      id: activeAgent.id,
      label: activeAgent.role,
      active: true,
      type: "agent",
    });
  }

  // File path segments
  if (activeFilePath) {
    const pathSegments = buildPathSegments(activeFilePath, fileTree);
    for (const seg of pathSegments) {
      segments.push(seg);
    }
  }

  // Symbol segment if we have file content
  const symbols = fileContent ? extractSymbols(fileContent) : [];
  if (symbols.length > 0) {
    segments.push({
      id: "symbols",
      label: "Symbols",
      active: false,
      type: "symbol",
    });
  }

  // Build dropdown items per segment
  const getDropdownItems = useCallback(
    (segment: BreadcrumbSegment): DropdownItem[] => {
      switch (segment.type) {
        case "project":
          return (
            projects?.map((p) => ({
              id: p.id,
              label: p.name,
              isActive: false,
            })) ?? []
          );

        case "path":
          if (activeFilePath) {
            return getSiblingsForPath(segment.id, fileTree);
          }
          return [];

        case "file":
          if (activeFilePath) {
            return getSiblingsForPath(segment.id, fileTree);
          }
          return [];

        case "symbol":
          return symbols;

        case "agent":
          return agents.map((a) => ({
            id: a.id,
            label: a.role,
            isActive: a.id === activeAgent?.id,
          }));

        default:
          return [];
      }
    },
    [activeAgent?.id, activeFilePath, agents, fileTree, projects, symbols]
  );

  const handleSelect = useCallback(
    (type: string, id: string) => {
      onNavigate?.(type, id);
    },
    [onNavigate]
  );

  return (
    <nav
      aria-label="Breadcrumb"
      className="scrollbar-none flex items-center gap-1 overflow-x-auto border-zinc-800 border-b bg-zinc-900/30 px-3 py-1.5"
    >
      {segments.map((segment, idx) => (
        <div className="flex items-center gap-1" key={segment.id}>
          {idx > 0 && <ChevronSeparator />}
          <BreadcrumbButton
            dropdownItems={getDropdownItems(segment)}
            isLast={idx === segments.length - 1}
            onSelect={handleSelect}
            segment={segment}
          />
        </div>
      ))}
    </nav>
  );
}
