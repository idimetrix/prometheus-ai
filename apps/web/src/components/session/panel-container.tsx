"use client";

import { useCallback, useState } from "react";
import { getAllPanels, type PanelDefinition } from "./panel-registry";

interface PanelContainerProps {
  panels?: PanelDefinition[];
  sessionId: string;
}

export function PanelContainer({
  sessionId,
  panels: initialPanels,
}: PanelContainerProps) {
  const allPanels = initialPanels ?? getAllPanels();
  const [activePanels, setActivePanels] = useState<string[]>(
    allPanels.filter((p) => p.defaultVisible).map((p) => p.id)
  );
  const [activeTab, setActiveTab] = useState<string>(activePanels[0] ?? "");

  const addPanel = useCallback((id: string) => {
    setActivePanels((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveTab(id);
  }, []);

  const removePanel = useCallback(
    (id: string) => {
      setActivePanels((prev) => {
        const next = prev.filter((p) => p !== id);
        if (activeTab === id) {
          setActiveTab(next[0] ?? "");
        }
        return next;
      });
    },
    [activeTab]
  );

  const activePanelDefs = activePanels
    .map((id) => allPanels.find((p) => p.id === id))
    .filter(Boolean) as PanelDefinition[];

  const ActiveComponent = allPanels.find((p) => p.id === activeTab)?.component;
  const inactivePanels = allPanels.filter((p) => !activePanels.includes(p.id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-zinc-800 border-b px-2">
        {activePanelDefs.map((panel) => (
          <button
            className={`group flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
              activeTab === panel.id
                ? "border-indigo-500 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
            key={panel.id}
            onClick={() => setActiveTab(panel.id)}
            type="button"
          >
            <span>{panel.icon}</span>
            <span>{panel.label}</span>
            <button
              className="ml-1 hidden rounded text-zinc-600 hover:text-zinc-300 group-hover:inline"
              onClick={(e) => {
                e.stopPropagation();
                removePanel(panel.id);
              }}
              type="button"
            >
              x
            </button>
          </button>
        ))}

        {inactivePanels.length > 0 && (
          <div className="relative ml-auto">
            <select
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  addPanel(e.target.value);
                }
                e.target.value = "";
              }}
            >
              <option disabled value="">
                + Add panel
              </option>
              {inactivePanels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {ActiveComponent ? (
          <ActiveComponent sessionId={sessionId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Select a panel to view
          </div>
        )}
      </div>
    </div>
  );
}
