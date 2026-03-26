"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Model data types (mirrors @prometheus/ai model registry)
// ---------------------------------------------------------------------------

type ModelCapability =
  | "chat"
  | "code"
  | "vision"
  | "reasoning"
  | "speed"
  | "long-context"
  | "embeddings"
  | "review"
  | "architecture"
  | "background"
  | "planning"
  | "complex";

interface ModelOption {
  capabilities: ModelCapability[];
  costIndicator: "free" | "low" | "mid" | "high" | "premium";
  displayName: string;
  id: string;
  provider: string;
  providerDisplayName: string;
  registryKey: string;
}

// ---------------------------------------------------------------------------
// Static model list (matches packages/ai/src/models.ts registry)
// ---------------------------------------------------------------------------

const AVAILABLE_MODELS: ModelOption[] = [
  // Anthropic
  {
    registryKey: "anthropic/claude-sonnet-4-6",
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    providerDisplayName: "Anthropic",
    displayName: "Claude Sonnet 4.6",
    capabilities: ["chat", "code", "vision", "reasoning", "review"],
    costIndicator: "mid",
  },
  {
    registryKey: "anthropic/claude-opus-4-6",
    id: "claude-opus-4-6",
    provider: "anthropic",
    providerDisplayName: "Anthropic",
    displayName: "Claude Opus 4.6",
    capabilities: ["chat", "code", "vision", "reasoning", "complex", "review"],
    costIndicator: "premium",
  },
  // OpenAI
  {
    registryKey: "openai/gpt-4.1",
    id: "gpt-4.1",
    provider: "openai",
    providerDisplayName: "OpenAI",
    displayName: "GPT-4.1",
    capabilities: ["chat", "code", "vision", "long-context", "reasoning"],
    costIndicator: "mid",
  },
  {
    registryKey: "openai/gpt-4.1-mini",
    id: "gpt-4.1-mini",
    provider: "openai",
    providerDisplayName: "OpenAI",
    displayName: "GPT-4.1 Mini",
    capabilities: ["chat", "code", "vision", "long-context"],
    costIndicator: "low",
  },
  {
    registryKey: "openai/gpt-4o",
    id: "gpt-4o",
    provider: "openai",
    providerDisplayName: "OpenAI",
    displayName: "GPT-4o",
    capabilities: ["chat", "code", "vision", "reasoning"],
    costIndicator: "mid",
  },
  {
    registryKey: "openai/gpt-4o-mini",
    id: "gpt-4o-mini",
    provider: "openai",
    providerDisplayName: "OpenAI",
    displayName: "GPT-4o Mini",
    capabilities: ["chat", "code", "vision"],
    costIndicator: "low",
  },
  {
    registryKey: "openai/o3-mini",
    id: "o3-mini",
    provider: "openai",
    providerDisplayName: "OpenAI",
    displayName: "o3-mini",
    capabilities: ["chat", "code", "reasoning"],
    costIndicator: "mid",
  },
  // Google
  {
    registryKey: "gemini/gemini-2.5-flash",
    id: "gemini-2.5-flash",
    provider: "gemini",
    providerDisplayName: "Google",
    displayName: "Gemini 2.5 Flash",
    capabilities: ["chat", "code", "long-context", "vision"],
    costIndicator: "free",
  },
  // DeepSeek
  {
    registryKey: "deepseek/deepseek-chat",
    id: "deepseek-chat",
    provider: "deepseek",
    providerDisplayName: "DeepSeek",
    displayName: "DeepSeek V3",
    capabilities: ["chat", "code"],
    costIndicator: "low",
  },
  {
    registryKey: "deepseek/deepseek-reasoner",
    id: "deepseek-reasoner",
    provider: "deepseek",
    providerDisplayName: "DeepSeek",
    displayName: "DeepSeek R1",
    capabilities: ["chat", "code", "reasoning"],
    costIndicator: "low",
  },
  // Local
  {
    registryKey: "ollama/qwen2.5-coder:32b",
    id: "qwen2.5-coder:32b",
    provider: "ollama",
    providerDisplayName: "Local (Ollama)",
    displayName: "Qwen 2.5 Coder 32B",
    capabilities: ["chat", "code", "reasoning"],
    costIndicator: "free",
  },
  {
    registryKey: "ollama/deepseek-r1:32b",
    id: "deepseek-r1:32b",
    provider: "ollama",
    providerDisplayName: "Local (Ollama)",
    displayName: "DeepSeek R1 32B",
    capabilities: ["chat", "code", "reasoning"],
    costIndicator: "free",
  },
];

// ---------------------------------------------------------------------------
// Capability badge colors
// ---------------------------------------------------------------------------

const CAPABILITY_COLORS: Partial<Record<ModelCapability, string>> = {
  speed: "bg-green-500/10 text-green-400",
  reasoning: "bg-violet-500/10 text-violet-400",
  vision: "bg-blue-500/10 text-blue-400",
  code: "bg-amber-500/10 text-amber-400",
  "long-context": "bg-cyan-500/10 text-cyan-400",
  complex: "bg-rose-500/10 text-rose-400",
};

const COST_LABELS: Record<
  ModelOption["costIndicator"],
  { label: string; color: string }
> = {
  free: { label: "Free", color: "text-green-400" },
  low: { label: "$", color: "text-zinc-400" },
  mid: { label: "$$", color: "text-yellow-400" },
  high: { label: "$$$", color: "text-orange-400" },
  premium: { label: "$$$$", color: "text-red-400" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  onSelect: (modelKey: string) => void;
  selectedModel?: string;
  /** Session ID to persist selection for */
  sessionId?: string;
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const currentModel = useMemo(
    () =>
      AVAILABLE_MODELS.find((m) => m.registryKey === selectedModel) ??
      AVAILABLE_MODELS[0],
    [selectedModel]
  );

  // Group models by provider
  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of AVAILABLE_MODELS) {
      const existing = groups.get(model.providerDisplayName) ?? [];
      existing.push(model);
      groups.set(model.providerDisplayName, existing);
    }
    return groups;
  }, []);

  const handleSelect = useCallback(
    (model: ModelOption) => {
      onSelect(model.registryKey);
      setIsOpen(false);

      // Persist selection to localStorage
      try {
        localStorage.setItem("prometheus:selected-model", model.registryKey);
      } catch {
        // Storage not available
      }
    },
    [onSelect]
  );

  // Highlighted capability badges for display
  const displayCapabilities: ModelCapability[] = [
    "speed",
    "reasoning",
    "vision",
    "code",
    "long-context",
    "complex",
  ];

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-violet-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium">{currentModel?.displayName}</span>
        <span
          className={`text-[10px] ${COST_LABELS[currentModel?.costIndicator ?? "mid"].color}`}
        >
          {COST_LABELS[currentModel?.costIndicator ?? "mid"].label}
        </span>
        <svg
          aria-hidden="true"
          className={`h-3 w-3 text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="m19.5 8.25-7.5 7.5-7.5-7.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            aria-label="Close model selector"
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsOpen(false);
              }
            }}
            role="button"
            tabIndex={-1}
          />

          <div className="absolute top-full right-0 z-50 mt-1 w-80 rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
            <div className="border-zinc-800 border-b px-3 py-2">
              <span className="font-medium text-xs text-zinc-400">
                Select Model
              </span>
            </div>

            <div className="max-h-96 overflow-auto p-1.5">
              {Array.from(groupedModels.entries()).map(
                ([providerName, models]) => (
                  <div key={providerName}>
                    <div className="px-2 py-1.5">
                      <span className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                        {providerName}
                      </span>
                    </div>

                    {models.map((model) => {
                      const isSelected =
                        model.registryKey === currentModel?.registryKey;

                      return (
                        <button
                          className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? "border border-violet-500/30 bg-violet-500/10"
                              : "border border-transparent hover:bg-zinc-800"
                          }`}
                          key={model.registryKey}
                          onClick={() => handleSelect(model)}
                          type="button"
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`font-medium text-xs ${isSelected ? "text-violet-300" : "text-zinc-200"}`}
                            >
                              {model.displayName}
                            </span>
                            <span
                              className={`text-[10px] ${COST_LABELS[model.costIndicator].color}`}
                            >
                              {COST_LABELS[model.costIndicator].label}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {model.capabilities
                              .filter((c) => displayCapabilities.includes(c))
                              .map((cap) => (
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[9px] ${CAPABILITY_COLORS[cap] ?? "bg-zinc-800 text-zinc-400"}`}
                                  key={cap}
                                >
                                  {cap}
                                </span>
                              ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
