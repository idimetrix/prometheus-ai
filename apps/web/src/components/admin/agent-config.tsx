"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPreference {
  modelId: string;
  priority: number;
  provider: string;
}

export interface ToolPermission {
  allowed: boolean;
  role: string;
  toolName: string;
}

export interface AgentConfiguration {
  maxTokens: number;
  modelPreferences: ModelPreference[];
  systemPromptOverride?: string;
  temperature: number;
  toolPermissions: ToolPermission[];
}

export interface AgentConfigPanelProps {
  config?: AgentConfiguration;
  onSave?: (config: AgentConfiguration) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AgentConfiguration = {
  modelPreferences: [],
  toolPermissions: [],
  temperature: 0.7,
  maxTokens: 4096,
  systemPromptOverride: undefined,
};

// ---------------------------------------------------------------------------
// AgentConfigPanel
// ---------------------------------------------------------------------------

export function AgentConfigPanel({
  config = DEFAULT_CONFIG,
  onSave,
}: AgentConfigPanelProps) {
  const [temperature, setTemperature] = useState(config.temperature);
  const [maxTokens, setMaxTokens] = useState(config.maxTokens);
  const [systemPrompt, setSystemPrompt] = useState(
    config.systemPromptOverride ?? ""
  );
  const [toolPermissions, setToolPermissions] = useState(
    config.toolPermissions
  );
  const [isDirty, setIsDirty] = useState(false);

  const handleTemperatureChange = useCallback((value: number) => {
    setTemperature(value);
    setIsDirty(true);
  }, []);

  const handleMaxTokensChange = useCallback((value: number) => {
    setMaxTokens(value);
    setIsDirty(true);
  }, []);

  const handleSystemPromptChange = useCallback((value: string) => {
    setSystemPrompt(value);
    setIsDirty(true);
  }, []);

  const handleTogglePermission = useCallback((index: number) => {
    setToolPermissions((prev) =>
      prev.map((perm, i) =>
        i === index ? { ...perm, allowed: !perm.allowed } : perm
      )
    );
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    onSave?.({
      modelPreferences: config.modelPreferences,
      toolPermissions,
      temperature,
      maxTokens,
      systemPromptOverride: systemPrompt || undefined,
    });
    setIsDirty(false);
  }, [
    onSave,
    config.modelPreferences,
    toolPermissions,
    temperature,
    maxTokens,
    systemPrompt,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg text-zinc-100">
          Agent Configuration
        </h2>
        <button
          className={`rounded px-4 py-1.5 font-medium text-sm transition-colors ${
            isDirty
              ? "bg-violet-600 text-white hover:bg-violet-500"
              : "cursor-not-allowed bg-zinc-800 text-zinc-500"
          }`}
          disabled={!isDirty}
          onClick={handleSave}
          type="button"
        >
          Save Changes
        </button>
      </div>

      {/* Temperature */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-3 font-medium text-sm text-zinc-200">
          Model Parameters
        </h3>
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                className="text-sm text-zinc-400"
                htmlFor="temperature-range"
              >
                Temperature
              </label>
              <span className="font-mono text-sm text-zinc-300">
                {temperature.toFixed(2)}
              </span>
            </div>
            <input
              className="w-full accent-violet-500"
              id="temperature-range"
              max="2"
              min="0"
              onChange={(e) =>
                handleTemperatureChange(Number.parseFloat(e.target.value))
              }
              step="0.01"
              type="range"
              value={temperature}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-sm text-zinc-400"
              htmlFor="max-tokens-input"
            >
              Max Tokens
            </label>
            <input
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500"
              id="max-tokens-input"
              max={128_000}
              min={256}
              onChange={(e) =>
                handleMaxTokensChange(Number.parseInt(e.target.value, 10))
              }
              step={256}
              type="number"
              value={maxTokens}
            />
          </div>
        </div>
      </div>

      {/* System Prompt Override */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-3 font-medium text-sm text-zinc-200">
          System Prompt Override
        </h3>
        <textarea
          aria-label="System prompt override"
          className="h-32 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-200 outline-none focus:border-violet-500"
          onChange={(e) => handleSystemPromptChange(e.target.value)}
          placeholder="Leave empty to use the default system prompt..."
          value={systemPrompt}
        />
      </div>

      {/* Tool Permissions */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-3 font-medium text-sm text-zinc-200">
          Tool Permissions by Role
        </h3>
        {toolPermissions.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            No tool permissions configured
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {toolPermissions.map((perm, index) => (
              <div
                className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2"
                key={`${perm.role}-${perm.toolName}`}
              >
                <div className="flex items-center gap-3">
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                    {perm.role}
                  </span>
                  <span className="text-sm text-zinc-200">{perm.toolName}</span>
                </div>
                <button
                  className={`rounded px-3 py-1 font-medium text-xs transition-colors ${
                    perm.allowed
                      ? "bg-green-500/20 text-green-300"
                      : "bg-red-500/20 text-red-300"
                  }`}
                  onClick={() => handleTogglePermission(index)}
                  type="button"
                >
                  {perm.allowed ? "Allowed" : "Denied"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
