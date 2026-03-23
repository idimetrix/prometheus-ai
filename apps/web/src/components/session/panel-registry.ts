import type { ComponentType } from "react";

export interface PanelDefinition {
  component: ComponentType<{ sessionId: string }>;
  defaultVisible: boolean;
  icon: string;
  id: string;
  label: string;
  minWidth?: number;
}

const registry = new Map<string, PanelDefinition>();

export function registerPanel(panel: PanelDefinition): void {
  registry.set(panel.id, panel);
}

export function getPanel(id: string): PanelDefinition | undefined {
  return registry.get(id);
}

export function getAllPanels(): PanelDefinition[] {
  return Array.from(registry.values());
}

export function getVisiblePanels(): PanelDefinition[] {
  return Array.from(registry.values()).filter((p) => p.defaultVisible);
}
