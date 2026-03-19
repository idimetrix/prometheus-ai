"use client";

import { Command } from "cmdk";
import {
  BarChart3,
  Clock,
  Code,
  Cpu,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  Zap,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// --- Recently Used Storage ---

const RECENTLY_USED_KEY = "prometheus:recently-used-commands";
const MAX_RECENT = 5;

interface RecentCommand {
  id: string;
  label: string;
  timestamp: number;
}

function getRecentCommands(): RecentCommand[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(RECENTLY_USED_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as RecentCommand[];
  } catch {
    return [];
  }
}

function addRecentCommand(id: string, label: string): void {
  const recent = getRecentCommands().filter((c) => c.id !== id);
  recent.unshift({ id, label, timestamp: Date.now() });
  localStorage.setItem(
    RECENTLY_USED_KEY,
    JSON.stringify(recent.slice(0, MAX_RECENT))
  );
}

// --- Command Definitions ---

interface CommandDef {
  action: (router: ReturnType<typeof useRouter>) => void;
  icon: React.ReactNode;
  id: string;
  label: string;
  shortcut?: string;
}

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-foreground text-sm transition-colors aria-selected:bg-accent";

const allCommands: CommandDef[] = [
  {
    id: "new-project",
    label: "New Project",
    shortcut: undefined,
    icon: <Plus className="h-4 w-4 text-green-500" />,
    action: (router) => router.push("/dashboard/projects/new"),
  },
  {
    id: "new-task",
    label: "New Task",
    shortcut: undefined,
    icon: <Zap className="h-4 w-4 text-amber-500" />,
    action: (router) => router.push("/new"),
  },
  {
    id: "dashboard",
    label: "Dashboard",
    shortcut: "G D",
    icon: <LayoutDashboard className="h-4 w-4 text-muted-foreground" />,
    action: (router) => router.push("/dashboard"),
  },
  {
    id: "projects",
    label: "Projects",
    shortcut: "G P",
    icon: <FolderOpen className="h-4 w-4 text-muted-foreground" />,
    action: (router) => router.push("/dashboard/projects"),
  },
  {
    id: "sessions",
    label: "Sessions",
    shortcut: "G S",
    icon: <Code className="h-4 w-4 text-muted-foreground" />,
    action: (router) => router.push("/dashboard/sessions" as Route),
  },
  {
    id: "fleet",
    label: "Fleet Manager",
    shortcut: "G F",
    icon: <Cpu className="h-4 w-4 text-muted-foreground" />,
    action: (router) => router.push("/dashboard/fleet"),
  },
  {
    id: "analytics",
    label: "Analytics",
    shortcut: "G A",
    icon: <BarChart3 className="h-4 w-4 text-muted-foreground" />,
    action: (router) => router.push("/dashboard/analytics"),
  },
  {
    id: "settings",
    label: "Settings",
    shortcut: "G ,",
    icon: <Settings className="h-4 w-4 text-muted-foreground" />,
    action: (router) => router.push("/dashboard/settings"),
  },
  {
    id: "keyboard-shortcuts",
    label: "Keyboard Shortcuts",
    shortcut: "?",
    icon: <HelpCircle className="h-4 w-4 text-muted-foreground" />,
    action: () =>
      window.dispatchEvent(new CustomEvent("prometheus:show-shortcuts")),
  },
];

const commandMap = new Map(allCommands.map((c) => [c.id, c]));

// --- Component ---

interface CommandPaletteProps {
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [recentCommands, setRecentCommands] = useState<RecentCommand[]>([]);

  // Load recent commands when palette opens
  useEffect(() => {
    if (isOpen) {
      setRecentCommands(getRecentCommands());
    }
  }, [isOpen]);

  useEffect(() => {
    if (controlledOpen !== undefined) {
      return;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [controlledOpen, isOpen, setIsOpen]);

  useEffect(() => {
    const handlePalette = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.open === false) {
        setIsOpen(false);
      } else {
        setIsOpen(true);
      }
    };
    window.addEventListener("prometheus:command-palette", handlePalette);
    return () =>
      window.removeEventListener("prometheus:command-palette", handlePalette);
  }, [setIsOpen]);

  const runCommand = useCallback(
    (id: string, label: string, fn: () => void) => {
      addRecentCommand(id, label);
      setIsOpen(false);
      fn();
    },
    [setIsOpen]
  );

  if (!isOpen) {
    return null;
  }

  const _recentIds = new Set(recentCommands.map((c) => c.id));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
      />

      <div className="relative w-full max-w-lg rounded-xl border border-border bg-popover shadow-2xl">
        <Command
          className="flex flex-col"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setIsOpen(false);
            }
          }}
        >
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Type a command or search..."
              ref={inputRef}
            />
            <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-auto p-2">
            <Command.Empty className="py-6 text-center text-muted-foreground text-sm">
              No matching commands
            </Command.Empty>

            {recentCommands.length > 0 && (
              <>
                <Command.Group heading="Recently Used">
                  {recentCommands.map((recent) => {
                    const cmd = commandMap.get(recent.id);
                    if (!cmd) {
                      return null;
                    }
                    return (
                      <Command.Item
                        className={ITEM_CLASS}
                        key={`recent-${recent.id}`}
                        onSelect={() =>
                          runCommand(cmd.id, cmd.label, () =>
                            cmd.action(router)
                          )
                        }
                        value={`recent ${cmd.label}`}
                      >
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1">{cmd.label}</span>
                        {cmd.shortcut && (
                          <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {cmd.shortcut}
                          </kbd>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
                <Command.Separator className="my-1 h-px bg-border" />
              </>
            )}

            <Command.Group heading="Quick Actions">
              {allCommands
                .filter((c) => c.id === "new-project" || c.id === "new-task")
                .map((cmd) => (
                  <Command.Item
                    className={ITEM_CLASS}
                    key={cmd.id}
                    onSelect={() =>
                      runCommand(cmd.id, cmd.label, () => cmd.action(router))
                    }
                  >
                    {cmd.icon}
                    <span className="flex-1">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
            </Command.Group>

            <Command.Separator className="my-1 h-px bg-border" />

            <Command.Group heading="Navigation">
              {allCommands
                .filter(
                  (c) =>
                    c.id !== "new-project" &&
                    c.id !== "new-task" &&
                    c.id !== "keyboard-shortcuts"
                )
                .map((cmd) => (
                  <Command.Item
                    className={ITEM_CLASS}
                    key={cmd.id}
                    onSelect={() =>
                      runCommand(cmd.id, cmd.label, () => cmd.action(router))
                    }
                  >
                    {cmd.icon}
                    <span className="flex-1">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
            </Command.Group>

            <Command.Separator className="my-1 h-px bg-border" />

            <Command.Group heading="Help">
              {allCommands
                .filter((c) => c.id === "keyboard-shortcuts")
                .map((cmd) => (
                  <Command.Item
                    className={ITEM_CLASS}
                    key={cmd.id}
                    onSelect={() =>
                      runCommand(cmd.id, cmd.label, () => cmd.action(router))
                    }
                  >
                    {cmd.icon}
                    <span className="flex-1">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
            </Command.Group>
          </Command.List>

          <div className="flex items-center gap-4 border-t px-4 py-2 text-[10px] text-muted-foreground">
            <span>
              <kbd className="rounded border bg-muted px-1 py-0.5">
                &uarr;&darr;
              </kbd>{" "}
              Navigate
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1 py-0.5">&crarr;</kbd>{" "}
              Select
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1 py-0.5">Esc</kbd>{" "}
              Close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
