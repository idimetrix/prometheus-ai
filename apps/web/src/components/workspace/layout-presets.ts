export interface LayoutPreset {
  description: string;
  id: string;
  name: string;
  panels: {
    left?: { id: string; size: number };
    center: { id: string; size: number };
    right?: { id: string; size: number };
    bottom?: { id: string; size: number };
  };
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: "development",
    name: "Development",
    description: "Editor + terminal with preview sidebar",
    panels: {
      left: { id: "chat", size: 25 },
      center: { id: "editor", size: 50 },
      right: { id: "preview", size: 25 },
      bottom: { id: "terminal", size: 50 },
    },
  },
  {
    id: "review",
    name: "Review",
    description: "Diff viewer + chat side by side",
    panels: {
      center: { id: "diff", size: 60 },
      right: { id: "chat", size: 40 },
    },
  },
  {
    id: "debug",
    name: "Debug",
    description: "Terminal + console + editor",
    panels: {
      left: { id: "editor", size: 25 },
      center: { id: "terminal", size: 50 },
      right: { id: "console", size: 25 },
    },
  },
  {
    id: "design",
    name: "Design",
    description: "Preview + chat side by side",
    panels: {
      center: { id: "preview", size: 60 },
      right: { id: "chat", size: 40 },
    },
  },
];

const STORAGE_KEY = "prometheus-workspace-layout";

export function saveLayoutToStorage(presetId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, presetId);
  } catch {
    // Storage not available
  }
}

export function loadLayoutFromStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getPresetById(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id);
}
