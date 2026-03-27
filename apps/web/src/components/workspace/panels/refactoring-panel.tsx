"use client";

import { Badge, Button, Card, ScrollArea } from "@prometheus/ui";
import {
  ArrowRight,
  Check,
  Code2,
  FileCode,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RefactoringComplexity = "trivial" | "low" | "medium" | "high";
type RefactoringStatus = "suggested" | "applying" | "applied" | "dismissed";

interface RefactoringSuggestion {
  affectedFiles: string[];
  complexity: RefactoringComplexity;
  description: string;
  details: string;
  id: string;
  status: RefactoringStatus;
  type: string;
}

interface RefactoringPanelProps {
  className?: string;
  onApply?: (id: string) => void;
  onDismiss?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPLEXITY_CONFIG: Record<
  RefactoringComplexity,
  { color: string; label: string }
> = {
  trivial: { label: "Trivial", color: "bg-green-500/20 text-green-400" },
  low: { label: "Low", color: "bg-blue-500/20 text-blue-400" },
  medium: { label: "Medium", color: "bg-yellow-500/20 text-yellow-400" },
  high: { label: "High", color: "bg-red-500/20 text-red-400" },
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SUGGESTIONS: RefactoringSuggestion[] = [
  {
    id: "ref_001",
    type: "Extract Function",
    description: "Extract duplicated validation logic into a shared utility",
    details:
      "The validation pattern for user input is repeated in 3 route handlers. Extracting it into a shared `validateUserInput` function reduces duplication and makes future changes easier.",
    affectedFiles: [
      "src/routers/users.ts",
      "src/routers/sessions.ts",
      "src/routers/projects.ts",
    ],
    complexity: "low",
    status: "suggested",
  },
  {
    id: "ref_002",
    type: "Inline Variable",
    description: "Inline single-use intermediate variable in query builder",
    details:
      "The variable `queryConditions` is assigned once and used immediately in the next line. Inlining it improves readability without sacrificing clarity.",
    affectedFiles: ["src/routers/workspaces.ts"],
    complexity: "trivial",
    status: "suggested",
  },
  {
    id: "ref_003",
    type: "Rename Symbol",
    description: "Rename `handleData` to `processWebhookPayload` for clarity",
    details:
      "The function name `handleData` is too generic. Renaming to `processWebhookPayload` better communicates its purpose and makes the codebase more searchable.",
    affectedFiles: [
      "src/routes/webhooks/github-app.ts",
      "src/routes/webhooks/slack.ts",
    ],
    complexity: "trivial",
    status: "suggested",
  },
  {
    id: "ref_004",
    type: "Simplify Conditional",
    description: "Replace nested if-else chain with early returns",
    details:
      "The authorization check in the middleware uses a deeply nested if-else structure (4 levels deep). Converting to guard clauses with early returns reduces cognitive complexity from 12 to 4.",
    affectedFiles: ["src/middleware/auth.ts"],
    complexity: "medium",
    status: "suggested",
  },
  {
    id: "ref_005",
    type: "Extract Component",
    description:
      "Extract repeated card layout into a reusable ProjectCard component",
    details:
      "The project card markup is duplicated across the dashboard, search results, and favorites pages with minor variations. Creating a shared component with configurable props eliminates duplication.",
    affectedFiles: [
      "src/components/dashboard/project-list.tsx",
      "src/components/search/results.tsx",
      "src/components/favorites/favorites-grid.tsx",
    ],
    complexity: "medium",
    status: "suggested",
  },
  {
    id: "ref_006",
    type: "Type Narrowing",
    description: "Replace type assertions with proper type guards",
    details:
      "Several places use `as unknown as T` patterns that bypass type checking. Replacing with discriminated unions and type guard functions ensures runtime safety.",
    affectedFiles: ["src/lib/api-client.ts", "src/utils/transform.ts"],
    complexity: "high",
    status: "suggested",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RefactoringPanel({
  className,
  onApply,
  onDismiss,
}: RefactoringPanelProps) {
  const [suggestions, setSuggestions] =
    useState<RefactoringSuggestion[]>(MOCK_SUGGESTIONS);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeCount = suggestions.filter(
    (s) => s.status === "suggested"
  ).length;

  const handleApply = useCallback(
    (id: string) => {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: "applied" as const } : s
        )
      );
      onApply?.(id);
    },
    [onApply]
  );

  const handleDismiss = useCallback(
    (id: string) => {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: "dismissed" as const } : s
        )
      );
      onDismiss?.(id);
    },
    [onDismiss]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <Card
      className={`flex flex-col border-zinc-800 bg-zinc-950 ${className ?? ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-violet-400" />
          <h3 className="font-medium text-sm text-zinc-200">Refactoring</h3>
          {activeCount > 0 && (
            <Badge
              className="bg-violet-500/20 text-violet-400"
              variant="secondary"
            >
              {activeCount}
            </Badge>
          )}
        </div>
        <Button className="h-7 text-xs" size="sm" variant="ghost">
          <RefreshCw className="mr-1 h-3 w-3" />
          Rescan
        </Button>
      </div>

      {/* Suggestions list */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {suggestions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <Sparkles className="h-6 w-6 text-zinc-700" />
              <p className="text-sm text-zinc-600">
                No refactoring suggestions
              </p>
              <p className="text-xs text-zinc-700">
                Run analysis to find improvement opportunities
              </p>
            </div>
          ) : (
            suggestions.map((suggestion) => {
              const complexity = COMPLEXITY_CONFIG[suggestion.complexity];
              const isExpanded = expandedId === suggestion.id;
              const isActive = suggestion.status === "suggested";

              return (
                <div
                  className={`rounded-lg border p-3 transition-colors ${
                    isActive
                      ? "border-zinc-800 bg-zinc-900/50"
                      : "border-zinc-800/50 bg-zinc-900/20 opacity-50"
                  }`}
                  key={suggestion.id}
                >
                  {/* Header row */}
                  <button
                    className="flex w-full items-start gap-2 text-left"
                    onClick={() => toggleExpand(suggestion.id)}
                    type="button"
                  >
                    <Code2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge
                          className="bg-zinc-800 text-zinc-400"
                          variant="secondary"
                        >
                          {suggestion.type}
                        </Badge>
                        <Badge className={complexity.color} variant="secondary">
                          {complexity.label}
                        </Badge>
                        {suggestion.status === "applied" && (
                          <Badge
                            className="bg-green-500/20 text-green-400"
                            variant="secondary"
                          >
                            Applied
                          </Badge>
                        )}
                        {suggestion.status === "dismissed" && (
                          <Badge
                            className="bg-zinc-700/20 text-zinc-500"
                            variant="secondary"
                          >
                            Dismissed
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-zinc-300">
                        {suggestion.description}
                      </p>
                    </div>
                    <ArrowRight
                      className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-3 border-zinc-800 border-t pt-3">
                      <p className="mb-2 text-[11px] text-zinc-400 leading-relaxed">
                        {suggestion.details}
                      </p>

                      {/* Affected files */}
                      <div className="mb-3">
                        <span className="mb-1 block text-[10px] text-zinc-600 uppercase tracking-wider">
                          Affected Files
                        </span>
                        <div className="space-y-0.5">
                          {suggestion.affectedFiles.map((file) => (
                            <div
                              className="flex items-center gap-1.5"
                              key={file}
                            >
                              <FileCode className="h-2.5 w-2.5 text-zinc-600" />
                              <span className="font-mono text-[10px] text-zinc-500">
                                {file}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      {isActive && (
                        <div className="flex items-center gap-2">
                          <Button
                            className="h-7 bg-violet-500/10 text-violet-400 text-xs hover:bg-violet-500/20"
                            onClick={() => handleApply(suggestion.id)}
                            size="sm"
                            variant="ghost"
                          >
                            <Check className="mr-1 h-3 w-3" />
                            Apply
                          </Button>
                          <Button
                            className="h-7 text-xs text-zinc-500 hover:text-zinc-300"
                            onClick={() => handleDismiss(suggestion.id)}
                            size="sm"
                            variant="ghost"
                          >
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
