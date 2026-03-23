"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light" | "system";

export interface PanelSizes {
  codePanel: number;
  fileTree: number;
  sidebar: number;
  terminal: number;
}

interface UIState {
  activeModals: string[];
  closeAllModals: () => void;
  closeModal: (modalId: string) => void;
  commandPaletteOpen: boolean;
  isModalOpen: (modalId: string) => boolean;
  openModal: (modalId: string) => void;
  panelSizes: PanelSizes;
  setCommandPaletteOpen: (open: boolean) => void;
  setPanelSize: (panel: keyof PanelSizes, size: number) => void;
  setPanelSizes: (sizes: Partial<PanelSizes>) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  setTheme: (theme: Theme) => void;
  sidebarCollapsed: boolean;
  theme: Theme;
  toggleCommandPalette: () => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      sidebarCollapsed: false,
      panelSizes: {
        sidebar: 240,
        terminal: 300,
        fileTree: 250,
        codePanel: 400,
      },
      activeModals: [],
      commandPaletteOpen: false,

      setTheme: (theme) => set({ theme }),

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      setPanelSize: (panel, size) =>
        set((state) => ({
          panelSizes: { ...state.panelSizes, [panel]: size },
        })),

      setPanelSizes: (sizes) =>
        set((state) => ({
          panelSizes: { ...state.panelSizes, ...sizes },
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
      }),
    }
  )
);
