"use client";

import { Badge, Card, CardContent } from "@prometheus/ui";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types (MOON-052: Agent Reasoning Transparency)
// ---------------------------------------------------------------------------

type ReasoningPhase = "observe" | "analyze" | "plan" | "act";

/** Alternative considered at a decision point */
export interface DecisionAlternative {
  /** Why this alternative was not chosen */
  discardReason: string;
  /** Name of the alternative approach */
  name: string;
}

/** A decision point where the agent chose between alternatives */
export interface DecisionPoint {
  /** Other options that were considered */
  alternatives: DecisionAlternative[];
  /** What the agent decided to do */
  chosen: string;
  /** Confidence in this decision (0-1) */
  confidence: number;
  /** Unique identifier */
  id: string;
  /** Why the agent made this decision */
  reasoning: string;
}

/** Tool call with justification for transparency */
export interface ToolCallJustification {
  /** Arguments summary */
  argsSummary?: string;
  /** Why the agent chose this tool over others */
  justification: string;
  /** The tool that was called */
  toolName: string;
}

export interface ReasoningStep {
  /** Alternatives considered at this step */
  alternatives?: DecisionAlternative[];
  /** Confidence level for this step (0-1) */
  confidence?: number;
  /** Content / description of this reasoning step */
  content: string;
  /** Decision point details if this is a decision step */
  decisionPoint?: DecisionPoint;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Unique identifier */
  id: string;
  /** Reasoning phase */
  phase: ReasoningPhase;
  /** ISO timestamp when this step started */
  timestamp: string;
  /** Token count for this step */
  tokenCount?: number;
  /** Tool call justification if this step involved a tool */
  toolCall?: ToolCallJustification;
}

interface ReasoningPanelProps {
  /** Whether the agent is still actively reasoning */
  isStreaming?: boolean;
  /** Callback when the user clicks "Why?" on a step */
  onExplainStep?: (stepId: string) => void;
  /** Ordered list of reasoning steps */
  steps: ReasoningStep[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASE_CONFIG: Record<
  ReasoningPhase,
  { bg: string; border: string; dot: string; label: string; text: string }
> = {
  observe: {
    label: "OBSERVE",
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    dot: "bg-blue-400",
  },
  analyze: {
    label: "ANALYZE",
    text: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    dot: "bg-yellow-400",
  },
  plan: {
    label: "PLAN",
    text: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    dot: "bg-green-400",
  },
  act: {
    label: "ACT",
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    dot: "bg-red-400",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  function getConfidenceColor(v: number) {
    if (v >= 0.8) {
      return "bg-green-500";
    }
    if (v >= 0.5) {
      return "bg-yellow-500";
    }
    return "bg-red-500";
  }
  const color = getConfidenceColor(value);

  return (
    <div className="flex items-center gap-1.5" title={`Confidence: ${pct}%`}>
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[9px] text-zinc-500">{pct}%</span>
    </div>
  );
}

function DecisionPointDetail({ dp }: { dp: DecisionPoint }) {
  return (
    <div className="mt-2 rounded-md border border-violet-500/20 bg-violet-500/5 p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold text-[10px] text-violet-400">
          DECISION POINT
        </span>
        <ConfidenceBar value={dp.confidence} />
      </div>
      <p className="text-[11px] text-zinc-300">Chose: {dp.chosen}</p>
      <p className="mt-1 text-[10px] text-zinc-500">{dp.reasoning}</p>
      {dp.alternatives.length > 0 && (
        <div className="mt-2 space-y-1">
          <span className="text-[9px] text-zinc-600">
            Alternatives considered:
          </span>
          {dp.alternatives.map((alt) => (
            <div
              className="flex items-start gap-1.5 text-[10px]"
              key={alt.name}
            >
              <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
              <span className="text-zinc-500">
                <span className="text-zinc-400">{alt.name}</span>
                {" — "}
                {alt.discardReason}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallDetail({ tc }: { tc: ToolCallJustification }) {
  return (
    <div className="mt-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold text-[10px] text-cyan-400">
          TOOL CALL
        </span>
        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
          {tc.toolName}
        </span>
      </div>
      {tc.argsSummary && (
        <p className="font-mono text-[10px] text-zinc-500">{tc.argsSummary}</p>
      )}
      <p className="mt-1 text-[10px] text-zinc-400">{tc.justification}</p>
    </div>
  );
}

function StepEntry({
  step,
  index,
  onExplain,
}: {
  index: number;
  onExplain?: (stepId: string) => void;
  step: ReasoningStep;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const config = PHASE_CONFIG[step.phase];
  const preview =
    step.content.slice(0, 100) + (step.content.length > 100 ? "..." : "");

  const toggle = useCallback(() => {
    setIsOpen((p) => !p);
  }, []);

  const handleExplain = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onExplain?.(step.id);
    },
    [onExplain, step.id]
  );

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg}`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={toggle}
        type="button"
      >
        {/* Chevron */}
        <svg
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Step number */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 font-mono text-[9px] text-zinc-500">
          {index + 1}
        </span>

        {/* Phase badge */}
        <span
          className={`rounded-full px-2 py-0.5 font-semibold text-[10px] ${config.text} ${config.bg}`}
        >
          {config.label}
        </span>

        {/* Confidence indicator (inline) */}
        {step.confidence !== undefined && (
          <ConfidenceBar value={step.confidence} />
        )}

        {/* Decision point indicator */}
        {step.decisionPoint && (
          <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] text-violet-400">
            Decision
          </span>
        )}

        {/* Tool call indicator */}
        {step.toolCall && (
          <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[9px] text-cyan-400">
            {step.toolCall.toolName}
          </span>
        )}

        {/* Preview (collapsed only) */}
        {!isOpen && (
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
            {preview}
          </span>
        )}

        {/* Meta: duration, tokens, timestamp */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {step.tokenCount !== undefined && (
            <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
              {formatTokens(step.tokenCount)} tok
            </span>
          )}
          {step.durationMs !== undefined && (
            <span className="font-mono text-[9px] text-zinc-600">
              {formatDuration(step.durationMs)}
            </span>
          )}
          <span className="text-[10px] text-zinc-600">
            {new Date(step.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="border-zinc-800/50 border-t px-3 py-2 pl-12">
          {/* Meta row */}
          <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] text-zinc-600">
            <span>Step #{index + 1}</span>
            {step.durationMs !== undefined && (
              <span>Duration: {formatDuration(step.durationMs)}</span>
            )}
            {step.tokenCount !== undefined && (
              <span>Tokens: {step.tokenCount.toLocaleString()}</span>
            )}
            {step.confidence !== undefined && (
              <span>Confidence: {Math.round(step.confidence * 100)}%</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-xs text-zinc-300 leading-relaxed">
            {step.content}
          </p>

          {/* Decision point details */}
          {step.decisionPoint && (
            <DecisionPointDetail dp={step.decisionPoint} />
          )}

          {/* Tool call justification */}
          {step.toolCall && <ToolCallDetail tc={step.toolCall} />}

          {/* Alternatives considered (if not from a decision point) */}
          {step.alternatives &&
            step.alternatives.length > 0 &&
            !step.decisionPoint && (
              <div className="mt-2 space-y-1">
                <span className="text-[9px] text-zinc-600">
                  Alternatives considered:
                </span>
                {step.alternatives.map((alt) => (
                  <div
                    className="flex items-start gap-1.5 text-[10px]"
                    key={alt.name}
                  >
                    <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
                    <span className="text-zinc-500">
                      <span className="text-zinc-400">{alt.name}</span>
                      {" — "}
                      {alt.discardReason}
                    </span>
                  </div>
                ))}
              </div>
            )}

          {/* "Why did you do this?" button */}
          {onExplain && (
            <button
              className="mt-2 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
              onClick={handleExplain}
              type="button"
            >
              Why did you do this?
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
        style={{ animationDelay: "0.2s" }}
      />
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
        style={{ animationDelay: "0.4s" }}
      />
      <span className="text-[10px] text-zinc-500">Reasoning...</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReasoningPanel({
  steps,
  isStreaming = false,
  onExplainStep,
}: ReasoningPanelProps) {
  const [filterPhase, setFilterPhase] = useState<ReasoningPhase | "">("");

  const filteredSteps = useMemo(() => {
    if (!filterPhase) {
      return steps;
    }
    return steps.filter((s) => s.phase === filterPhase);
  }, [steps, filterPhase]);

  const summary = useMemo(() => {
    const totalDuration = steps.reduce(
      (sum, s) => sum + (s.durationMs ?? 0),
      0
    );
    const totalTokens = steps.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0);
    const phaseCounts: Record<string, number> = {};
    for (const s of steps) {
      phaseCounts[s.phase] = (phaseCounts[s.phase] ?? 0) + 1;
    }
    return { totalDuration, totalTokens, phaseCounts };
  }, [steps]);

  return (
    <Card className="flex flex-col overflow-hidden border-zinc-800 bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-violet-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-300">
          Reasoning Trace
        </span>
        <Badge className="bg-zinc-800 text-zinc-500" variant="secondary">
          {steps.length}
        </Badge>

        {/* Summary stats */}
        {steps.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            {summary.totalTokens > 0 && (
              <span className="font-mono text-[9px] text-zinc-600">
                {formatTokens(summary.totalTokens)} tokens
              </span>
            )}
            {summary.totalDuration > 0 && (
              <span className="font-mono text-[9px] text-zinc-600">
                {formatDuration(summary.totalDuration)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Phase filter bar */}
      {steps.length > 0 && (
        <div className="flex items-center gap-1.5 border-zinc-800 border-b px-3 py-1.5">
          <span className="text-[10px] text-zinc-600">Filter:</span>
          <button
            className={
              filterPhase === ""
                ? "rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-400"
                : "rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
            }
            onClick={() => setFilterPhase("")}
            type="button"
          >
            All
          </button>
          {(["observe", "analyze", "plan", "act"] as const).map((phase) => {
            const count = summary.phaseCounts[phase] ?? 0;
            if (count === 0) {
              return null;
            }
            const config = PHASE_CONFIG[phase];
            return (
              <button
                className={
                  filterPhase === phase
                    ? `rounded px-1.5 py-0.5 text-[10px] ${config.text} ${config.bg}`
                    : "rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                }
                key={phase}
                onClick={() => setFilterPhase(phase)}
                type="button"
              >
                {config.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Step list */}
      <CardContent className="flex-1 overflow-auto p-2">
        {filteredSteps.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
            {steps.length === 0
              ? "No reasoning steps captured yet"
              : "No matching steps for this phase"}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredSteps.map((step, idx) => (
              <StepEntry
                index={idx}
                key={step.id}
                onExplain={onExplainStep}
                step={step}
              />
            ))}
          </div>
        )}

        {isStreaming && <StreamingIndicator />}
      </CardContent>
    </Card>
  );
}
