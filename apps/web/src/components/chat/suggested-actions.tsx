"use client";

import { cn } from "@prometheus/ui";
import {
  Bug,
  CheckCircle,
  Eye,
  FileCode,
  FlaskConical,
  GitPullRequest,
  Play,
  RefreshCw,
  Sparkles,
  Terminal,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────

export interface SuggestedAction {
  command?: string;
  description?: string;
  icon?: string;
  label: string;
}

interface SuggestedActionsProps {
  className?: string;
  onSelect: (action: SuggestedAction) => void;
  suggestions: SuggestedAction[];
}

// ── Icon mapping ────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  test: <FlaskConical className="h-3 w-3" />,
  pr: <GitPullRequest className="h-3 w-3" />,
  run: <Play className="h-3 w-3" />,
  retry: <RefreshCw className="h-3 w-3" />,
  improve: <Sparkles className="h-3 w-3" />,
  terminal: <Terminal className="h-3 w-3" />,
  fix: <Bug className="h-3 w-3" />,
  code: <FileCode className="h-3 w-3" />,
  check: <CheckCircle className="h-3 w-3" />,
  review: <Eye className="h-3 w-3" />,
};

function getIcon(action: SuggestedAction): React.ReactNode {
  if (action.icon && ICON_MAP[action.icon]) {
    return ICON_MAP[action.icon];
  }

  // Auto-detect icon from label
  const label = action.label.toLowerCase();
  if (label.includes("test")) {
    return ICON_MAP.test;
  }
  if (label.includes("pr") || label.includes("pull request")) {
    return ICON_MAP.pr;
  }
  if (label.includes("run")) {
    return ICON_MAP.run;
  }
  if (label.includes("retry") || label.includes("again")) {
    return ICON_MAP.retry;
  }
  if (
    label.includes("fix") ||
    label.includes("lint") ||
    label.includes("error")
  ) {
    return ICON_MAP.fix;
  }
  if (label.includes("review")) {
    return ICON_MAP.review;
  }
  if (label.includes("check") || label.includes("verify")) {
    return ICON_MAP.check;
  }

  return <Sparkles className="h-3 w-3" />;
}

// ── Default suggestions by context ──────────────────────────────

export const DEFAULT_SUGGESTIONS: SuggestedAction[] = [
  { label: "Run tests", icon: "test", command: "/test" },
  { label: "Review changes", icon: "review", command: "/review" },
  { label: "Fix lint errors", icon: "fix", command: "/fix" },
  { label: "Create PR", icon: "pr", command: "/pr" },
];

export const POST_ERROR_SUGGESTIONS: SuggestedAction[] = [
  { label: "Fix this error", icon: "fix" },
  { label: "Explain the error", icon: "review" },
  { label: "Retry last step", icon: "retry" },
];

export const POST_COMPLETION_SUGGESTIONS: SuggestedAction[] = [
  { label: "Run tests", icon: "test" },
  { label: "Review changes", icon: "review" },
  { label: "Create PR", icon: "pr" },
  { label: "Improve further", icon: "improve" },
];

// ── Component ───────────────────────────────────────────────────

export function SuggestedActions({
  suggestions,
  onSelect,
  className,
}: SuggestedActionsProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {suggestions.map((action) => (
        <button
          className="group flex items-center gap-1.5 rounded-full border border-zinc-700/50 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-400 transition-all hover:border-violet-500/30 hover:bg-violet-500/5 hover:text-violet-300"
          key={action.label}
          onClick={() => onSelect(action)}
          title={action.description}
          type="button"
        >
          <span className="text-zinc-500 transition-colors group-hover:text-violet-400">
            {getIcon(action)}
          </span>
          {action.label}
        </button>
      ))}
    </div>
  );
}
