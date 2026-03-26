"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface EditorTab {
  isModified?: boolean;
  isPinned?: boolean;
  name: string;
  path: string;
}

export type SplitDirection = "horizontal" | "vertical";

export interface TabGroup {
  activeTab: string | null;
  id: string;
  tabs: EditorTab[];
}

export interface SplitNode {
  /** Leaf node: a single tab group */
  children?: SplitNode[];
  direction?: SplitDirection;
  groupId?: string;
  /** Percentage sizes of children (same length as children[]) */
  sizes?: number[];
}

interface TabContextMenuState {
  groupId: string;
  path: string;
  x: number;
  y: number;
}

interface EditorTabsProps {
  activeTab?: string;
  className?: string;
  groupId: string;
  onCloseTab: (path: string, groupId: string) => void;
  onContextAction?: (
    action: TabContextAction,
    path: string,
    groupId: string
  ) => void;
  onDragToSplit?: (
    path: string,
    sourceGroupId: string,
    direction: SplitDirection
  ) => void;
  onPinTab?: (path: string, groupId: string) => void;
  onReorderTab?: (groupId: string, fromIndex: number, toIndex: number) => void;
  onSelectTab: (path: string, groupId: string) => void;
  tabs: EditorTab[];
}

export type TabContextAction =
  | "close"
  | "closeAll"
  | "closeOthers"
  | "closeToRight"
  | "pin"
  | "unpin";

/* -------------------------------------------------------------------------- */
/*  Icons                                                                      */
/* -------------------------------------------------------------------------- */

function CloseIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        d="M6 18L18 6M6 6l12 12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A6 6 0 0 1 5 6.708V2.277a3 3 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        d="M15.75 19.5L8.25 12l7.5-7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
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

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3"
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
  );
}

/* -------------------------------------------------------------------------- */
/*  Context Menu                                                               */
/* -------------------------------------------------------------------------- */

function TabContextMenu({
  x,
  y,
  path,
  groupId,
  isPinned,
  onAction,
  onClose,
}: {
  groupId: string;
  isPinned: boolean;
  onAction: (action: TabContextAction, path: string, groupId: string) => void;
  onClose: () => void;
  path: string;
  x: number;
  y: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  const items: Array<{ action: TabContextAction; label: string }> = [
    {
      action: isPinned ? "unpin" : "pin",
      label: isPinned ? "Unpin Tab" : "Pin Tab",
    },
    { action: "close", label: "Close" },
    { action: "closeOthers", label: "Close Others" },
    { action: "closeToRight", label: "Close to the Right" },
    { action: "closeAll", label: "Close All" },
  ];

  return (
    <div
      className="fixed z-50 min-w-[160px] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
      ref={ref}
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          className="flex w-full items-center px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
          key={item.action}
          onClick={() => {
            onAction(item.action, path, groupId);
            onClose();
          }}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab Overflow Dropdown                                                      */
/* -------------------------------------------------------------------------- */

function TabOverflowDropdown({
  tabs,
  activeTab,
  groupId,
  onSelectTab,
}: {
  activeTab: string | undefined;
  groupId: string;
  onSelectTab: (path: string, groupId: string) => void;
  tabs: EditorTab[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="relative shrink-0">
      <button
        className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
        onClick={() => setIsOpen(!isOpen)}
        title={`${tabs.length} more tab${tabs.length > 1 ? "s" : ""}`}
        type="button"
      >
        <span>{tabs.length}</span>
        <ChevronDownIcon />
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsOpen(false);
              }
            }}
            role="presentation"
          />
          <div className="absolute right-0 z-50 mt-1 max-h-60 w-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
            {tabs.map((tab) => (
              <button
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  tab.path === activeTab
                    ? "bg-violet-500/10 text-violet-300"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
                key={tab.path}
                onClick={() => {
                  onSelectTab(tab.path, groupId);
                  setIsOpen(false);
                }}
                type="button"
              >
                {tab.isPinned && (
                  <PinIcon className="h-2.5 w-2.5 text-zinc-500" />
                )}
                {tab.isModified && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" />
                )}
                <span className="truncate">{tab.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Drag-and-Drop Helpers                                                      */
/* -------------------------------------------------------------------------- */

const DRAG_EDGE_THRESHOLD = 40; // px from edge to trigger split drop zone

function getDragEdge(e: React.DragEvent, rect: DOMRect): SplitDirection | null {
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (x < DRAG_EDGE_THRESHOLD) {
    return "horizontal";
  }
  if (x > rect.width - DRAG_EDGE_THRESHOLD) {
    return "horizontal";
  }
  if (y < DRAG_EDGE_THRESHOLD) {
    return "vertical";
  }
  if (y > rect.height - DRAG_EDGE_THRESHOLD) {
    return "vertical";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function EditorTabs({
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  onContextAction,
  onReorderTab,
  onDragToSplit,
  onPinTab,
  groupId,
  className = "",
}: EditorTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(
    null
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [splitDropZone, setSplitDropZone] = useState<SplitDirection | null>(
    null
  );

  // Sorted: pinned tabs first
  const sortedTabs = useMemo(() => {
    const pinned = tabs.filter((t) => t.isPinned);
    const unpinned = tabs.filter((t) => !t.isPinned);
    return [...pinned, ...unpinned];
  }, [tabs]);

  // Max visible tabs before overflow
  const MAX_VISIBLE = 12;
  const visibleTabs = sortedTabs.slice(0, MAX_VISIBLE);
  const overflowTabs = sortedTabs.slice(MAX_VISIBLE);

  // Scroll overflow detection
  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    setShowLeftArrow(el.scrollLeft > 0);
    setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener("scroll", checkOverflow);
      const resizeObserver = new ResizeObserver(checkOverflow);
      resizeObserver.observe(el);
      return () => {
        el.removeEventListener("scroll", checkOverflow);
        resizeObserver.disconnect();
      };
    }
  }, [checkOverflow]);

  // Ctrl+W to close current tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "w" && activeTab) {
        e.preventDefault();
        onCloseTab(activeTab, groupId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, onCloseTab, groupId]);

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      if (e.button === 1) {
        e.preventDefault();
        onCloseTab(path, groupId);
      }
    },
    [onCloseTab, groupId]
  );

  const handleCloseClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      onCloseTab(path, groupId);
    },
    [onCloseTab, groupId]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, path, groupId });
    },
    [groupId]
  );

  const handleContextAction = useCallback(
    (action: TabContextAction, path: string, gid: string) => {
      if (action === "pin" || action === "unpin") {
        onPinTab?.(path, gid);
      } else {
        onContextAction?.(action, path, gid);
      }
    },
    [onContextAction, onPinTab]
  );

  // Drag-to-reorder handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number, path: string) => {
      setDragIndex(index);
      e.dataTransfer.setData("text/plain", path);
      e.dataTransfer.setData("application/x-tab-group", groupId);
      e.dataTransfer.effectAllowed = "move";
    },
    [groupId]
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);

    // Check if near edge for split
    const rect = (e.currentTarget as HTMLElement)
      .closest("[data-tab-bar]")
      ?.getBoundingClientRect();
    if (rect) {
      const edge = getDragEdge(e, rect);
      setSplitDropZone(edge);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const sourcePath = e.dataTransfer.getData("text/plain");
      const sourceGroupId = e.dataTransfer.getData("application/x-tab-group");

      // If dropping near an edge to create a split
      if (splitDropZone && sourceGroupId === groupId && onDragToSplit) {
        onDragToSplit(sourcePath, groupId, splitDropZone);
      } else if (
        sourceGroupId === groupId &&
        dragIndex !== null &&
        dragIndex !== toIndex &&
        onReorderTab
      ) {
        onReorderTab(groupId, dragIndex, toIndex);
      }

      setDragIndex(null);
      setDragOverIndex(null);
      setSplitDropZone(null);
    },
    [dragIndex, groupId, onDragToSplit, onReorderTab, splitDropZone]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
    setSplitDropZone(null);
  }, []);

  const scrollLeft = useCallback(() => {
    scrollRef.current?.scrollBy({ left: -120, behavior: "smooth" });
  }, []);

  const scrollRight = useCallback(() => {
    scrollRef.current?.scrollBy({ left: 120, behavior: "smooth" });
  }, []);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className={`flex items-center border-zinc-800 border-b bg-zinc-900/30 ${className}`}
        data-tab-bar
      >
        {/* Scroll left arrow */}
        {showLeftArrow && (
          <button
            className="shrink-0 px-1 text-zinc-500 hover:text-zinc-300"
            onClick={scrollLeft}
            type="button"
          >
            <ChevronLeftIcon />
          </button>
        )}

        {/* Scrollable tab area */}
        <div
          className="scrollbar-none flex flex-1 items-center overflow-x-auto"
          ref={scrollRef}
        >
          {visibleTabs.map((tab, index) => {
            const isActive = tab.path === activeTab;
            const isDragging = dragIndex === index;
            const isDragOver = dragOverIndex === index && dragIndex !== index;

            return (
              <button
                className={`group flex shrink-0 items-center gap-1.5 border-zinc-800 border-r px-3 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "border-b-2 border-b-violet-500 bg-zinc-900 text-zinc-200"
                    : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
                } ${isDragging ? "opacity-50" : ""} ${isDragOver ? "border-l-2 border-l-violet-400" : ""}`}
                draggable
                key={tab.path}
                onAuxClick={(e) => handleMiddleClick(e, tab.path)}
                onClick={() => onSelectTab(tab.path, groupId)}
                onContextMenu={(e) => handleContextMenu(e, tab.path)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragStart={(e) => handleDragStart(e, index, tab.path)}
                onDrop={(e) => handleDrop(e, index)}
                type="button"
              >
                {/* Pinned indicator */}
                {tab.isPinned && (
                  <PinIcon className="h-2.5 w-2.5 shrink-0 text-zinc-500" />
                )}

                {/* Modified dot */}
                {tab.isModified && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" />
                )}

                {/* Tab name */}
                <span className="max-w-[120px] truncate">{tab.name}</span>

                {/* Close button (hidden for pinned tabs) */}
                {!tab.isPinned && (
                  <span
                    className={`ml-1 shrink-0 rounded p-0.5 hover:bg-zinc-700 ${
                      isActive
                        ? "text-zinc-400 hover:text-zinc-200"
                        : "text-zinc-600 opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={(e) => handleCloseClick(e, tab.path)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onCloseTab(tab.path, groupId);
                      }
                    }}
                    role="button"
                    tabIndex={-1}
                  >
                    <CloseIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scroll right arrow */}
        {showRightArrow && (
          <button
            className="shrink-0 px-1 text-zinc-500 hover:text-zinc-300"
            onClick={scrollRight}
            type="button"
          >
            <ChevronRightIcon />
          </button>
        )}

        {/* Overflow dropdown */}
        <TabOverflowDropdown
          activeTab={activeTab}
          groupId={groupId}
          onSelectTab={onSelectTab}
          tabs={overflowTabs}
        />

        {/* Split drop zone indicator */}
        {splitDropZone && (
          <div
            className={`pointer-events-none absolute inset-0 border-2 border-violet-500/40 ${
              splitDropZone === "horizontal"
                ? "border-r-violet-500 border-l-violet-500"
                : "border-t-violet-500 border-b-violet-500"
            }`}
          />
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <TabContextMenu
          groupId={contextMenu.groupId}
          isPinned={
            tabs.find((t) => t.path === contextMenu.path)?.isPinned ?? false
          }
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
          path={contextMenu.path}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Split Editor Manager                                                       */
/* -------------------------------------------------------------------------- */

export interface SplitEditorState {
  groups: Record<string, TabGroup>;
  root: SplitNode;
}

/** Creates an initial split editor state with a single group */
export function createInitialSplitState(): SplitEditorState {
  const groupId = "group-1";
  return {
    root: { groupId },
    groups: {
      [groupId]: { id: groupId, tabs: [], activeTab: null },
    },
  };
}

/** Adds a tab to a group, or the first group if not specified */
export function addTabToGroup(
  state: SplitEditorState,
  tab: EditorTab,
  groupId?: string
): SplitEditorState {
  const targetGroupId = groupId ?? Object.keys(state.groups)[0];
  if (!targetGroupId) {
    return state;
  }

  const group = state.groups[targetGroupId];
  if (!group) {
    return state;
  }

  // Don't add duplicate tabs
  if (group.tabs.some((t) => t.path === tab.path)) {
    return {
      ...state,
      groups: {
        ...state.groups,
        [targetGroupId]: { ...group, activeTab: tab.path },
      },
    };
  }

  return {
    ...state,
    groups: {
      ...state.groups,
      [targetGroupId]: {
        ...group,
        tabs: [...group.tabs, tab],
        activeTab: tab.path,
      },
    },
  };
}

/** Removes a tab from a group. Cleans up empty groups if not the last one. */
export function removeTabFromGroup(
  state: SplitEditorState,
  path: string,
  groupId: string
): SplitEditorState {
  const group = state.groups[groupId];
  if (!group) {
    return state;
  }

  const newTabs = group.tabs.filter((t) => t.path !== path);
  const newActive =
    group.activeTab === path ? (newTabs.at(-1)?.path ?? null) : group.activeTab;

  const newGroups = {
    ...state.groups,
    [groupId]: { ...group, tabs: newTabs, activeTab: newActive },
  };

  // If the group is now empty and there are other groups, remove it
  const groupIds = Object.keys(newGroups);
  if (newTabs.length === 0 && groupIds.length > 1) {
    const { [groupId]: _removed, ...rest } = newGroups;
    return {
      groups: rest,
      root: removeGroupFromNode(state.root, groupId) ?? {
        groupId:
          groupIds.find((id) => id !== groupId) ?? groupIds[0] ?? "group-1",
      },
    };
  }

  return { ...state, groups: newGroups };
}

function removeGroupFromNode(
  node: SplitNode,
  groupId: string
): SplitNode | null {
  if (node.groupId === groupId) {
    return null;
  }

  if (node.children) {
    const newChildren: SplitNode[] = [];
    const newSizes: number[] = [];

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child) {
        const result = removeGroupFromNode(child, groupId);
        if (result) {
          newChildren.push(result);
          newSizes.push(node.sizes?.[i] ?? 50);
        }
      }
    }

    if (newChildren.length === 0) {
      return null;
    }
    if (newChildren.length === 1) {
      return newChildren[0] ?? null;
    }

    // Normalize sizes
    const total = newSizes.reduce((s, v) => s + v, 0);
    const normalizedSizes = newSizes.map((s) => (s / total) * 100);

    return { ...node, children: newChildren, sizes: normalizedSizes };
  }

  return node;
}

/** Creates a new split from an existing group */
export function splitGroup(
  state: SplitEditorState,
  sourceGroupId: string,
  tabPath: string,
  direction: SplitDirection
): SplitEditorState {
  const sourceGroup = state.groups[sourceGroupId];
  if (!sourceGroup) {
    return state;
  }

  const tab = sourceGroup.tabs.find((t) => t.path === tabPath);
  if (!tab) {
    return state;
  }

  const newGroupId = `group-${Date.now()}`;
  const newGroup: TabGroup = {
    id: newGroupId,
    tabs: [tab],
    activeTab: tab.path,
  };

  // Remove tab from source
  const updatedSourceTabs = sourceGroup.tabs.filter((t) => t.path !== tabPath);
  const updatedSourceActive =
    sourceGroup.activeTab === tabPath
      ? (updatedSourceTabs.at(-1)?.path ?? null)
      : sourceGroup.activeTab;

  const newGroups = {
    ...state.groups,
    [sourceGroupId]: {
      ...sourceGroup,
      tabs: updatedSourceTabs,
      activeTab: updatedSourceActive,
    },
    [newGroupId]: newGroup,
  };

  // Update tree structure
  const newRoot = insertSplitInNode(
    state.root,
    sourceGroupId,
    newGroupId,
    direction
  );

  return { root: newRoot, groups: newGroups };
}

function insertSplitInNode(
  node: SplitNode,
  targetGroupId: string,
  newGroupId: string,
  direction: SplitDirection
): SplitNode {
  if (node.groupId === targetGroupId) {
    return {
      direction,
      children: [{ groupId: targetGroupId }, { groupId: newGroupId }],
      sizes: [50, 50],
    };
  }

  if (node.children) {
    return {
      ...node,
      children: node.children.map((child) =>
        insertSplitInNode(child, targetGroupId, newGroupId, direction)
      ),
    };
  }

  return node;
}

/** Reorder tabs within a group */
export function reorderTabsInGroup(
  state: SplitEditorState,
  groupId: string,
  fromIndex: number,
  toIndex: number
): SplitEditorState {
  const group = state.groups[groupId];
  if (!group) {
    return state;
  }

  const newTabs = [...group.tabs];
  const [moved] = newTabs.splice(fromIndex, 1);
  if (moved) {
    newTabs.splice(toIndex, 0, moved);
  }

  return {
    ...state,
    groups: {
      ...state.groups,
      [groupId]: { ...group, tabs: newTabs },
    },
  };
}

/** Toggle pin status of a tab */
export function togglePinTab(
  state: SplitEditorState,
  path: string,
  groupId: string
): SplitEditorState {
  const group = state.groups[groupId];
  if (!group) {
    return state;
  }

  const newTabs = group.tabs.map((t) =>
    t.path === path ? { ...t, isPinned: !t.isPinned } : t
  );

  return {
    ...state,
    groups: {
      ...state.groups,
      [groupId]: { ...group, tabs: newTabs },
    },
  };
}

/** Handle context menu actions */
export function handleTabContextAction(
  state: SplitEditorState,
  action: TabContextAction,
  path: string,
  groupId: string
): SplitEditorState {
  const group = state.groups[groupId];
  if (!group) {
    return state;
  }

  switch (action) {
    case "close":
      return removeTabFromGroup(state, path, groupId);

    case "closeAll": {
      // Close all unpinned tabs
      const pinnedOnly = group.tabs.filter((t) => t.isPinned);
      const newActive = pinnedOnly.at(-1)?.path ?? null;
      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: pinnedOnly, activeTab: newActive },
        },
      };
    }

    case "closeOthers": {
      const kept = group.tabs.filter((t) => t.path === path || t.isPinned);
      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: kept, activeTab: path },
        },
      };
    }

    case "closeToRight": {
      const idx = group.tabs.findIndex((t) => t.path === path);
      if (idx === -1) {
        return state;
      }
      const kept = group.tabs.filter((t, i) => i <= idx || t.isPinned);
      return {
        ...state,
        groups: {
          ...state.groups,
          [groupId]: { ...group, tabs: kept, activeTab: path },
        },
      };
    }

    case "pin":
    case "unpin":
      return togglePinTab(state, path, groupId);

    default:
      return state;
  }
}
