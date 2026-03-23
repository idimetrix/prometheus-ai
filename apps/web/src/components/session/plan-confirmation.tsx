"use client";

import { useCallback, useState } from "react";
import { RiskBadge } from "./risk-badge";

interface PlanStep {
  agentRole: string;
  dependencies: string[];
  description: string;
  effort: string;
  estimatedCredits: number;
  id: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  title: string;
}

interface PlanConfirmationProps {
  estimatedTime: string;
  onApprove: () => void;
  onModify: (modifiedSteps: PlanStep[]) => void;
  onReject: (reason: string) => void;
  sprintGoal: string;
  steps: PlanStep[];
  totalCredits: number;
}

export function PlanConfirmation({
  sprintGoal,
  steps,
  totalCredits,
  estimatedTime,
  onApprove,
  onReject,
  onModify,
}: PlanConfirmationProps) {
  const [selectedSteps, setSelectedSteps] = useState<Set<string>>(
    new Set(steps.map((s) => s.id))
  );
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const toggleStep = useCallback((id: string) => {
    setSelectedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleReject = useCallback(() => {
    if (showReject && rejectReason.trim()) {
      onReject(rejectReason.trim());
    } else {
      setShowReject(true);
    }
  }, [showReject, rejectReason, onReject]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-zinc-800 border-b p-6">
          <h2 className="font-bold text-white text-xl">
            Confirm Execution Plan
          </h2>
          <p className="mt-1 text-sm text-zinc-400">{sprintGoal}</p>
          <div className="mt-3 flex gap-4 text-sm text-zinc-500">
            <span>{steps.length} steps</span>
            <span>{totalCredits} credits</span>
            <span>{estimatedTime}</span>
          </div>
        </div>

        <div className="divide-y divide-zinc-800 p-4">
          {steps.map((step, idx) => (
            <div className="flex items-start gap-3 py-3" key={step.id}>
              <input
                checked={selectedSteps.has(step.id)}
                className="mt-1 rounded border-zinc-600"
                onChange={() => toggleStep(step.id)}
                type="checkbox"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">#{idx + 1}</span>
                  <span className="font-medium text-sm text-white">
                    {step.title}
                  </span>
                  <RiskBadge level={step.riskLevel} />
                  <span className="text-xs text-zinc-500">
                    {step.agentRole}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {step.description}
                </p>
                <div className="mt-1 flex gap-3 text-xs text-zinc-600">
                  <span>Effort: {step.effort}</span>
                  <span>~{step.estimatedCredits} credits</span>
                  {step.dependencies.length > 0 && (
                    <span>Deps: {step.dependencies.join(", ")}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {showReject && (
          <div className="border-zinc-800 border-t px-6 py-3">
            <textarea
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why should this plan be rejected? What should change?"
              rows={3}
              value={rejectReason}
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-zinc-800 border-t p-4">
          <button
            className="rounded-lg border border-red-500/30 bg-red-600/10 px-4 py-2 font-medium text-red-400 text-sm hover:bg-red-600/20"
            onClick={handleReject}
            type="button"
          >
            {showReject ? "Confirm Reject" : "Reject"}
          </button>
          <button
            className="rounded-lg bg-zinc-700 px-4 py-2 font-medium text-sm text-zinc-300 hover:bg-zinc-600"
            onClick={() =>
              onModify(steps.filter((s) => selectedSteps.has(s.id)))
            }
            type="button"
          >
            Modify Selection
          </button>
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-sm text-white hover:bg-indigo-500"
            onClick={onApprove}
            type="button"
          >
            Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
}
