"use client";

interface SuggestedAction {
  description?: string;
  icon?: string;
  id: string;
  label: string;
  variant?: "default" | "primary" | "danger";
}

interface SuggestedActionsProps {
  actions: SuggestedAction[];
  onAction: (actionId: string) => void;
}

const VARIANT_CLASSES: Record<string, string> = {
  default:
    "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white",
  primary:
    "border-indigo-500/30 bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20",
  danger: "border-red-500/30 bg-red-600/10 text-red-400 hover:bg-red-600/20",
};

export function SuggestedActions({ actions, onAction }: SuggestedActionsProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 p-3">
      {actions.map((action) => (
        <button
          className={`rounded-full border px-3 py-1.5 font-medium text-xs transition-colors ${
            VARIANT_CLASSES[action.variant ?? "default"]
          }`}
          key={action.id}
          onClick={() => onAction(action.id)}
          title={action.description}
          type="button"
        >
          {action.icon && <span className="mr-1">{action.icon}</span>}
          {action.label}
        </button>
      ))}
    </div>
  );
}
