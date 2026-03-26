"use client";

import { useState } from "react";
import { logger } from "@/lib/logger";
import { trpc } from "@/lib/trpc";
import { useSessionStore } from "@/stores/session.store";

interface PlanModeProps {
  /** Callback when user toggles plan mode on/off */
  onTogglePlanMode?: (enabled: boolean) => void;
  /** Whether plan mode is enabled (agent pauses for approval) */
  planModeEnabled?: boolean;
  sessionId: string;
}

export function PlanMode({
  sessionId,
  planModeEnabled = true,
  onTogglePlanMode,
}: PlanModeProps) {
  const { planSteps, reasoning } = useSessionStore();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const sendMessage = trpc.sessions.sendMessage.useMutation();

  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [checkedSteps, setCheckedSteps] = useState<Set<string>>(new Set());

  function toggleStepChecked(stepId: string) {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }

  async function handleApprove() {
    setIsApproving(true);
    try {
      if (checkedSteps.size > 0) {
        const selectedIds = Array.from(checkedSteps).join(",");
        await sendMessage.mutateAsync({
          sessionId,
          content: `[APPROVE_STEPS:${selectedIds}]`,
        });
      } else {
        await sendMessage.mutateAsync({
          sessionId,
          content: "[APPROVE_PLAN]",
        });
      }
    } catch (err) {
      logger.error("Failed to approve plan:", err);
    } finally {
      setIsApproving(false);
    }
  }

  async function handleReject() {
    setIsRejecting(true);
    try {
      await sendMessage.mutateAsync({
        sessionId,
        content: `[REJECT_PLAN] ${feedback || ""}`.trim(),
      });
    } catch (err) {
      logger.error("Failed to reject plan:", err);
    } finally {
      setIsRejecting(false);
    }
  }

  async function handleModifyStep(stepId: string) {
    if (!editText.trim()) {
      return;
    }
    try {
      await sendMessage.mutateAsync({
        sessionId,
        content: `[MODIFY_STEP:${stepId}] ${editText.trim()}`,
      });
      setEditingStepId(null);
      setEditText("");
    } catch (err) {
      logger.error("Failed to modify step:", err);
    }
  }

  const completedCount = planSteps.filter(
    (s) => s.status === "done" || s.status === "completed"
  ).length;
  const progressPct =
    planSteps.length > 0
      ? Math.round((completedCount / planSteps.length) * 100)
      : 0;

  const isPendingStep = (status: string) =>
    status !== "done" &&
    status !== "completed" &&
    status !== "running" &&
    status !== "in_progress";

  const approveLabel =
    checkedSteps.size > 0
      ? `Approve ${checkedSteps.size} Step${checkedSteps.size > 1 ? "s" : ""}`
      : "Approve & Execute";

  return (
    <div
      className={`flex h-full gap-4 ${planModeEnabled ? "rounded-xl ring-2 ring-indigo-500/30 ring-offset-2 ring-offset-zinc-950" : ""}`}
    >
      {/* Plan steps (main area) */}
      <div
        className={`flex flex-1 flex-col rounded-xl border bg-zinc-900/50 ${planModeEnabled ? "border-indigo-500/40" : "border-zinc-800"}`}
      >
        <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              aria-hidden="true"
              className="h-4 w-4 text-indigo-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-medium text-sm text-zinc-200">
              Execution Plan
            </span>

            {/* Plan Mode Toggle */}
            <button
              className={`ml-2 flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-[10px] transition-colors ${
                planModeEnabled
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"
              }`}
              onClick={() => onTogglePlanMode?.(!planModeEnabled)}
              title={
                planModeEnabled
                  ? "Plan Mode ON: Agent pauses for approval"
                  : "Plan Mode OFF: Agent executes automatically"
              }
              type="button"
            >
              <div
                className={`h-2.5 w-5 rounded-full transition-colors ${planModeEnabled ? "bg-indigo-500" : "bg-zinc-600"}`}
              >
                <div
                  className={`h-2.5 w-2.5 rounded-full bg-white transition-transform ${planModeEnabled ? "translate-x-2.5" : "translate-x-0"}`}
                />
              </div>
              Plan Mode
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              {completedCount}/{planSteps.length} steps
            </span>
            {planSteps.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="font-medium text-xs text-zinc-400">
                  {progressPct}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Plan mode banner */}
        {planModeEnabled && planSteps.length > 0 && completedCount === 0 && (
          <div className="flex items-center gap-2 border-indigo-500/20 border-b bg-indigo-500/5 px-4 py-2">
            <svg
              aria-hidden="true"
              className="h-4 w-4 text-indigo-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-indigo-300 text-xs">
              Agent is paused. Review the plan below, check steps to include,
              then click Approve &amp; Execute to proceed.
            </span>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">
          {planSteps.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-400" />
              <p className="text-sm text-zinc-400">Generating plan...</p>
              <p className="text-xs text-zinc-600">
                The agent is analyzing your request and creating an execution
                plan
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {planSteps.map((step, i) => (
                <div
                  className={`rounded-xl border p-4 transition-colors ${
                    (
                      {
                        running: "border-violet-500/30 bg-violet-500/5",
                        in_progress: "border-violet-500/30 bg-violet-500/5",
                        done: "border-green-500/20 bg-green-500/5",
                        completed: "border-green-500/20 bg-green-500/5",
                        failed: "border-red-500/20 bg-red-500/5",
                      } as Record<string, string>
                    )[step.status] ?? "border-zinc-800 bg-zinc-900/30"
                  }`}
                  key={step.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {/* Checkbox for step selection in plan mode */}
                      {planModeEnabled && isPendingStep(step.status) && (
                        <input
                          aria-label={`Select step: ${step.title}`}
                          checked={checkedSteps.has(step.id)}
                          className="mt-1.5 h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-800 accent-indigo-500"
                          onChange={() => toggleStepChecked(step.id)}
                          type="checkbox"
                        />
                      )}
                      <div
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-medium text-xs ${
                          (
                            {
                              done: "bg-green-500/20 text-green-400",
                              completed: "bg-green-500/20 text-green-400",
                              running: "bg-violet-500/20 text-violet-400",
                              in_progress: "bg-violet-500/20 text-violet-400",
                              failed: "bg-red-500/20 text-red-400",
                            } as Record<string, string>
                          )[step.status] ?? "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {step.status === "done" ||
                        step.status === "completed" ? (
                          <svg
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="m4.5 12.75 6 6 9-13.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : (
                          i + 1
                        )}
                      </div>
                      <div>
                        <div
                          className={`font-medium text-sm ${
                            step.status === "done" ||
                            step.status === "completed"
                              ? "text-zinc-500 line-through"
                              : "text-zinc-200"
                          }`}
                        >
                          {step.title}
                        </div>
                        {step.description && (
                          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                            {step.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Edit button */}
                    {isPendingStep(step.status) && (
                      <button
                        className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                        onClick={() => {
                          setEditingStepId(step.id);
                          setEditText(step.title);
                        }}
                        type="button"
                      >
                        Modify
                      </button>
                    )}
                  </div>

                  {/* Inline edit */}
                  {editingStepId === step.id && (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        autoFocus
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-violet-500"
                        onChange={(e) => setEditText(e.target.value)}
                        type="text"
                        value={editText}
                      />
                      <button
                        className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white text-xs hover:bg-violet-700"
                        onClick={() => handleModifyStep(step.id)}
                        type="button"
                      >
                        Save
                      </button>
                      <button
                        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
                        onClick={() => {
                          setEditingStepId(null);
                          setEditText("");
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Approve / Reject bar */}
        {planSteps.length > 0 && completedCount < planSteps.length && (
          <div className="border-zinc-800 border-t p-4">
            <div className="flex items-center gap-3">
              <input
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500"
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Optional feedback or modification request..."
                type="text"
                value={feedback}
              />
              <button
                className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 font-medium text-white text-xs transition-colors hover:bg-green-700 disabled:opacity-50"
                disabled={isApproving}
                onClick={handleApprove}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="m4.5 12.75 6 6 9-13.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {approveLabel}
              </button>
              <button
                className="flex items-center gap-1.5 rounded-lg border border-red-800/50 bg-red-950/50 px-4 py-2 font-medium text-red-400 text-xs transition-colors hover:bg-red-900/50 disabled:opacity-50"
                disabled={isRejecting}
                onClick={handleReject}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M6 18 18 6M6 6l12 12"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Reject
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reasoning sidebar */}
      <div className="flex w-72 flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-3">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-zinc-500"
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
          <span className="font-medium text-xs text-zinc-400">Reasoning</span>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {reasoning.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-600">
              Agent reasoning will appear here
            </div>
          ) : (
            <div className="space-y-2">
              {Array.from(reasoning.entries()).map(([thoughtIdx, thought]) => (
                <div
                  className="rounded-lg bg-zinc-950 px-3 py-2 text-violet-300/80 text-xs italic leading-relaxed"
                  key={`thought-${thoughtIdx}`}
                >
                  {thought}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
