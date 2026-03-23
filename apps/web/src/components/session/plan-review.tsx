"use client";

import { useCallback, useState } from "react";
import { type PlanStep, useSessionStore } from "@/stores/session.store";

interface PlanReviewProps {
  onApprove: (approvedStepIds: string[]) => void;
  onModify: (steps: PlanStep[]) => void;
  onReject: (reason: string) => void;
  onStepExecute?: (stepId: string) => void;
  sessionId: string;
}

export function PlanReview({
  sessionId: _sessionId,
  onApprove,
  onReject,
  onModify,
  onStepExecute,
}: PlanReviewProps) {
  const { planSteps } = useSessionStore();
  const [checkedSteps, setCheckedSteps] = useState<Set<string>>(new Set());
  const [rejectReason, setRejectReason] = useState("");
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [stepByStep, setStepByStep] = useState(false);

  const toggleStep = (id: string) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setCheckedSteps(new Set(planSteps.map((s) => s.id)));
  };

  const deselectAll = () => {
    setCheckedSteps(new Set());
  };

  const handleApprove = useCallback(() => {
    const ids =
      checkedSteps.size > 0
        ? Array.from(checkedSteps)
        : planSteps.map((s) => s.id);
    onApprove(ids);
  }, [checkedSteps, planSteps, onApprove]);

  const handleReject = useCallback(() => {
    onReject(rejectReason);
    setShowRejectInput(false);
    setRejectReason("");
  }, [rejectReason, onReject]);

  const handleModify = useCallback(() => {
    const modified = planSteps.map((step) => {
      if (editingStep === step.id && editedTitle) {
        return { ...step, title: editedTitle };
      }
      return step;
    });
    onModify(modified);
    setEditingStep(null);
    setEditedTitle("");
  }, [planSteps, editingStep, editedTitle, onModify]);

  const startEdit = (step: PlanStep) => {
    setEditingStep(step.id);
    setEditedTitle(step.title);
  };

  const estimateStepCost = (step: PlanStep): number => {
    // Rough heuristic: longer descriptions = more complex = more credits
    const baseCredits = 2;
    const descLength = (step.description ?? "").length + step.title.length;
    return baseCredits + Math.floor(descLength / 100);
  };

  const totalCost = planSteps.reduce((sum, step) => {
    if (checkedSteps.size === 0 || checkedSteps.has(step.id)) {
      return sum + estimateStepCost(step);
    }
    return sum;
  }, 0);

  if (planSteps.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 p-8">
        <div className="text-center">
          <svg
            aria-hidden="true"
            className="mx-auto h-8 w-8 text-zinc-700"
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
          <p className="mt-2 text-sm text-zinc-500">
            Waiting for plan generation...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div>
          <h3 className="font-medium text-sm text-zinc-200">Review Plan</h3>
          <p className="text-[11px] text-zinc-500">
            {planSteps.length} steps - ~{totalCost} credits estimated
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              checked={stepByStep}
              className="rounded border-zinc-700 bg-zinc-800 text-violet-500 focus:ring-violet-500"
              onChange={(e) => setStepByStep(e.target.checked)}
              type="checkbox"
            />
            Step-by-step
          </label>
          <button
            className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400"
            onClick={
              checkedSteps.size === planSteps.length ? deselectAll : selectAll
            }
            type="button"
          >
            {checkedSteps.size === planSteps.length
              ? "Deselect all"
              : "Select all"}
          </button>
        </div>
      </div>

      {/* Step list */}
      <div className="max-h-80 overflow-auto p-3">
        <div className="space-y-1.5">
          {planSteps.map((step, i) => {
            const isChecked = checkedSteps.has(step.id);
            const isEditing = editingStep === step.id;
            const cost = estimateStepCost(step);

            return (
              <div
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  isChecked
                    ? "border-violet-500/30 bg-violet-500/5"
                    : "border-zinc-800/50 bg-zinc-950/30 hover:border-zinc-700"
                }`}
                key={step.id}
              >
                <input
                  checked={isChecked}
                  className="mt-0.5 rounded border-zinc-700 bg-zinc-800 text-violet-500 focus:ring-violet-500"
                  onChange={() => toggleStep(step.id)}
                  type="checkbox"
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-violet-500"
                        onChange={(e) => setEditedTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleModify();
                          }
                          if (e.key === "Escape") {
                            setEditingStep(null);
                          }
                        }}
                        value={editedTitle}
                      />
                      <button
                        className="text-[10px] text-violet-400 hover:text-violet-300"
                        onClick={handleModify}
                        type="button"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      className="cursor-pointer font-medium text-xs text-zinc-300"
                      onClick={() => startEdit(step)}
                      type="button"
                    >
                      {i + 1}. {step.title}
                    </button>
                  )}
                  {step.description && !isEditing && (
                    <p className="mt-0.5 text-[10px] text-zinc-600">
                      {step.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-zinc-600">~{cost}cr</span>
                  {stepByStep && onStepExecute && (
                    <button
                      className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                      onClick={() => onStepExecute(step.id)}
                      type="button"
                    >
                      Run
                    </button>
                  )}
                  <button
                    className="text-zinc-700 hover:text-zinc-400"
                    onClick={() => startEdit(step)}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reject reason input */}
      {showRejectInput && (
        <div className="border-zinc-800 border-t px-4 py-3">
          <textarea
            className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-red-500"
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why are you rejecting this plan? (optional)"
            rows={2}
            value={rejectReason}
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 border-zinc-800 border-t px-4 py-3">
        <button
          className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 font-medium text-white text-xs transition-colors hover:bg-green-700"
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
          {checkedSteps.size > 0 && checkedSteps.size < planSteps.length
            ? `Approve ${checkedSteps.size} steps`
            : "Approve All"}
        </button>

        {showRejectInput ? (
          <button
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-medium text-white text-xs transition-colors hover:bg-red-700"
            onClick={handleReject}
            type="button"
          >
            Confirm Reject
          </button>
        ) : (
          <button
            className="flex items-center gap-1.5 rounded-lg border border-red-800/50 px-4 py-2 font-medium text-red-400 text-xs transition-colors hover:bg-red-950/30"
            onClick={() => setShowRejectInput(true)}
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
        )}

        <div className="ml-auto text-[11px] text-zinc-600">
          Double-click a step to edit
        </div>
      </div>
    </div>
  );
}
