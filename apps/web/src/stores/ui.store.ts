"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "high-contrast" | "light" | "system";

export interface PanelSizes {
  codePanel: number;
  fileTree: number;
  sidebar: number;
  terminal: number;
}

/* -------------------------------------------------------------------------- */
/*  Layout Persistence Types                                                   */
/* -------------------------------------------------------------------------- */

export interface PanelVisibility {
  chat: boolean;
  console: boolean;
  editor: boolean;
  fileTree: boolean;
  preview: boolean;
  terminal: boolean;
}

export interface SplitEditorConfig {
  /** JSON-serializable split tree structure */
  groups: Record<
    string,
    {
      activeTab: string | null;
      id: string;
      tabs: Array<{ isPinned?: boolean; name: string; path: string }>;
    }
  >;
  root: unknown;
}

export interface LayoutConfig {
  panelSizes: PanelSizes;
  panelVisibility: PanelVisibility;
  sidebarCollapsed: boolean;
  splitEditor?: SplitEditorConfig;
}

export interface LayoutPresetEntry {
  config: LayoutConfig;
  createdAt: number;
  id: string;
  isBuiltIn: boolean;
  name: string;
  updatedAt: number;
}

const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  chat: true,
  console: false,
  editor: true,
  fileTree: true,
  preview: false,
  terminal: true,
};

const DEFAULT_PANEL_SIZES: PanelSizes = {
  sidebar: 240,
  terminal: 300,
  fileTree: 250,
  codePanel: 400,
};

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  panelSizes: DEFAULT_PANEL_SIZES,
  panelVisibility: DEFAULT_PANEL_VISIBILITY,
  sidebarCollapsed: false,
};

/* -------------------------------------------------------------------------- */
/*  Built-in Presets                                                           */
/* -------------------------------------------------------------------------- */

const BUILT_IN_PRESETS: LayoutPresetEntry[] = [
  {
    id: "builtin-default",
    name: "Default",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: DEFAULT_LAYOUT_CONFIG,
  },
  {
    id: "builtin-focused",
    name: "Focused Coding",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      panelSizes: {
        sidebar: 200,
        terminal: 200,
        fileTree: 200,
        codePanel: 600,
      },
      panelVisibility: {
        chat: false,
        console: false,
        editor: true,
        fileTree: true,
        preview: false,
        terminal: true,
      },
      sidebarCollapsed: true,
    },
  },
  {
    id: "builtin-review",
    name: "Code Review",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      panelSizes: { sidebar: 0, terminal: 250, fileTree: 220, codePanel: 500 },
      panelVisibility: {
        chat: true,
        console: false,
        editor: true,
        fileTree: true,
        preview: false,
        terminal: false,
      },
      sidebarCollapsed: false,
    },
  },
  {
    id: "builtin-debug",
    name: "Debug",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      panelSizes: {
        sidebar: 240,
        terminal: 400,
        fileTree: 220,
        codePanel: 400,
      },
      panelVisibility: {
        chat: false,
        console: true,
        editor: true,
        fileTree: true,
        preview: false,
        terminal: true,
      },
      sidebarCollapsed: false,
    },
  },
  {
    id: "builtin-presentation",
    name: "Presentation",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      panelSizes: { sidebar: 0, terminal: 0, fileTree: 0, codePanel: 800 },
      panelVisibility: {
        chat: false,
        console: false,
        editor: true,
        fileTree: false,
        preview: false,
        terminal: false,
      },
      sidebarCollapsed: true,
    },
  },
  {
    id: "builtin-fullstack",
    name: "Full Stack",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      panelSizes: {
        sidebar: 240,
        terminal: 300,
        fileTree: 250,
        codePanel: 400,
      },
      panelVisibility: {
        chat: true,
        console: true,
        editor: true,
        fileTree: true,
        preview: true,
        terminal: true,
      },
      sidebarCollapsed: false,
    },
  },
];

const MAX_CUSTOM_PRESETS = 5;

/* -------------------------------------------------------------------------- */
/*  Auto-save debounce constant                                                */
/* -------------------------------------------------------------------------- */

const AUTO_SAVE_DEBOUNCE_MS = 2000;

/* -------------------------------------------------------------------------- */
/*  Store Types                                                                */
/* -------------------------------------------------------------------------- */

interface UIState {
  activeModals: string[];
  activePresetId: string;
  closeAllModals: () => void;
  closeModal: (modalId: string) => void;
  commandPaletteOpen: boolean;
  customPresets: LayoutPresetEntry[];
  deleteCustomPreset: (presetId: string) => void;
  getAllPresets: () => LayoutPresetEntry[];
  getCurrentLayoutConfig: () => LayoutConfig;
  isModalOpen: (modalId: string) => boolean;
  openModal: (modalId: string) => void;
  panelSizes: PanelSizes;
  panelVisibility: PanelVisibility;
  projectLayouts: Record<string, string>;
  resetLayout: () => void;
  restorePreset: (presetId: string) => void;
  saveCurrentAsPreset: (name: string) => LayoutPresetEntry | null;
  setCommandPaletteOpen: (open: boolean) => void;
  setPanelSize: (panel: keyof PanelSizes, size: number) => void;
  setPanelSizes: (sizes: Partial<PanelSizes>) => void;
  setPanelVisibility: (panel: keyof PanelVisibility, visible: boolean) => void;
  setProjectLayout: (projectId: string, presetId: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSplitEditorConfig: (config: SplitEditorConfig | undefined) => void;
  setTheme: (theme: Theme) => void;
  sidebarCollapsed: boolean;
  splitEditorConfig?: SplitEditorConfig;
  theme: Theme;
  toggleCommandPalette: () => void;
  togglePanel: (panel: keyof PanelVisibility) => void;
  toggleSidebar: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Auto-save timer                                                            */
/* -------------------------------------------------------------------------- */

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoSave(config: LayoutConfig, projectId?: string): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = setTimeout(() => {
    try {
      const key = projectId
        ? `prometheus-layout-${projectId}`
        : "prometheus-layout-default";
      localStorage.setItem(key, JSON.stringify(config));
    } catch {
      // localStorage not available
    }
  }, AUTO_SAVE_DEBOUNCE_MS);
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      sidebarCollapsed: false,
      panelSizes: DEFAULT_PANEL_SIZES,
      panelVisibility: DEFAULT_PANEL_VISIBILITY,
      activeModals: [],
      commandPaletteOpen: false,
      customPresets: [],
      activePresetId: "builtin-default",
      splitEditorConfig: undefined,
      projectLayouts: {},

      setTheme: (theme) => set({ theme }),

      toggleSidebar: () =>
        set((state) => {
          const collapsed = !state.sidebarCollapsed;
          scheduleAutoSave({
            ...state.getCurrentLayoutConfig(),
            sidebarCollapsed: collapsed,
          });
          return { sidebarCollapsed: collapsed };
        }),

      setSidebarCollapsed: (collapsed) => {
        set({ sidebarCollapsed: collapsed });
        scheduleAutoSave(get().getCurrentLayoutConfig());
      },

      setPanelSize: (panel, size) =>
        set((state) => {
          const panelSizes = { ...state.panelSizes, [panel]: size };
          scheduleAutoSave({ ...state.getCurrentLayoutConfig(), panelSizes });
          return { panelSizes };
        }),

      setPanelSizes: (sizes) =>
        set((state) => {
          const panelSizes = { ...state.panelSizes, ...sizes };
          scheduleAutoSave({ ...state.getCurrentLayoutConfig(), panelSizes });
          return { panelSizes };
        }),

      setPanelVisibility: (panel, visible) =>
        set((state) => {
          const panelVisibility = {
            ...state.panelVisibility,
            [panel]: visible,
          };
          scheduleAutoSave({
            ...state.getCurrentLayoutConfig(),
            panelVisibility,
          });
          return { panelVisibility };
        }),

      togglePanel: (panel) =>
        set((state) => {
          const panelVisibility = {
            ...state.panelVisibility,
            [panel]: !state.panelVisibility[panel],
          };
          scheduleAutoSave({
            ...state.getCurrentLayoutConfig(),
            panelVisibility,
          });
          return { panelVisibility };
        }),

      setSplitEditorConfig: (config) => {
        set({ splitEditorConfig: config });
        scheduleAutoSave(get().getCurrentLayoutConfig());
      },

      getCurrentLayoutConfig: () => {
        const state = get();
        return {
          panelSizes: state.panelSizes,
          panelVisibility: state.panelVisibility,
          sidebarCollapsed: state.sidebarCollapsed,
          splitEditor: state.splitEditorConfig,
        };
      },

      saveCurrentAsPreset: (name) => {
        const state = get();
        if (state.customPresets.length >= MAX_CUSTOM_PRESETS) {
          return null;
        }

        const preset: LayoutPresetEntry = {
          id: `custom-${Date.now()}`,
          name,
          isBuiltIn: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          config: state.getCurrentLayoutConfig(),
        };

        set((s) => ({
          customPresets: [...s.customPresets, preset],
          activePresetId: preset.id,
        }));

        return preset;
      },

      deleteCustomPreset: (presetId) =>
        set((state) => ({
          customPresets: state.customPresets.filter((p) => p.id !== presetId),
          activePresetId:
            state.activePresetId === presetId
              ? "builtin-default"
              : state.activePresetId,
        })),

      restorePreset: (presetId) => {
        const state = get();
        const allPresets = [...BUILT_IN_PRESETS, ...state.customPresets];
        const preset = allPresets.find((p) => p.id === presetId);
        if (!preset) {
          return;
        }

        set({
          panelSizes: preset.config.panelSizes,
          panelVisibility: preset.config.panelVisibility,
          sidebarCollapsed: preset.config.sidebarCollapsed,
          splitEditorConfig: preset.config.splitEditor,
          activePresetId: presetId,
        });
      },

      resetLayout: () =>
        set({
          panelSizes: DEFAULT_PANEL_SIZES,
          panelVisibility: DEFAULT_PANEL_VISIBILITY,
          sidebarCollapsed: false,
          splitEditorConfig: undefined,
          activePresetId: "builtin-default",
        }),

      getAllPresets: () => {
        const state = get();
        return [...BUILT_IN_PRESETS, ...state.customPresets];
      },

      setProjectLayout: (projectId, presetId) =>
        set((state) => ({
          projectLayouts: { ...state.projectLayouts, [projectId]: presetId },
        })),

      openModal: (modalId) =>
        set((state) => ({
          activeModals: state.activeModals.includes(modalId)
            ? state.activeModals
            : [...state.activeModals, modalId],
        })),

      closeModal: (modalId) =>
        set((state) => ({
          activeModals: state.activeModals.filter((id) => id !== modalId),
        })),

      isModalOpen: (modalId) => get().activeModals.includes(modalId),

      closeAllModals: () => set({ activeModals: [] }),

      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      toggleCommandPalette: () =>
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
    }),
    {
      name: "prometheus-ui",
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        panelSizes: state.panelSizes,
        panelVisibility: state.panelVisibility,
        customPresets: state.customPresets,
        activePresetId: state.activePresetId,
        splitEditorConfig: state.splitEditorConfig,
        projectLayouts: state.projectLayouts,
      }),
    }
  )
);
