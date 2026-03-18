"use client";

import { useCallback, useState } from "react";

interface ClarifyingQuestion {
  context: string;
  impact: "high" | "medium" | "low";
  options: string[];
  question: string;
}

interface AmbiguityResolverProps {
  assumptions: string[];
  confidence: number;
  interpretation: string;
  onAcceptAssumptions: () => void;
  onResolve: (answers: Record<number, string>) => void;
  questions: ClarifyingQuestion[];
}

const IMPACT_COLORS: Record<string, string> = {
  high: "text-red-400",
  medium: "text-yellow-400",
  low: "text-green-400",
};

export function AmbiguityResolverUI({
  questions,
  interpretation,
  assumptions,
  confidence,
  onResolve,
  onAcceptAssumptions,
}: AmbiguityResolverProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const handleSelect = useCallback((idx: number, option: string) => {
    setAnswers((prev) => ({ ...prev, [idx]: option }));
  }, []);

  const allAnswered = questions.every((_, i) => answers[i] !== undefined);

  return (
    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-semibold text-indigo-300 text-sm">
          Clarification Needed
        </h4>
        <span className="text-xs text-zinc-500">
          Confidence: {Math.round(confidence * 100)}%
        </span>
      </div>

      {interpretation && (
        <div className="mb-3 rounded bg-zinc-900 p-3 text-sm text-zinc-300">
          <div className="mb-1 font-medium text-xs text-zinc-500">
            Our interpretation:
          </div>
          {interpretation}
        </div>
      )}

      {assumptions.length > 0 && (
        <div className="mb-4">
          <div className="mb-1 font-medium text-xs text-zinc-500">
            Assumptions:
          </div>
          <ul className="list-inside list-disc text-sm text-zinc-400">
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {questions.map((q, idx) => (
          <div
            className="rounded border border-zinc-700 bg-zinc-900 p-3"
            key={idx}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium text-sm text-white">
                {q.question}
              </span>
              <span className={`text-xs ${IMPACT_COLORS[q.impact] ?? ""}`}>
                {q.impact} impact
              </span>
            </div>
            {q.context && (
              <p className="mb-2 text-xs text-zinc-500">{q.context}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {q.options.map((option) => (
                <button
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    answers[idx] === option
                      ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                  }`}
                  key={option}
                  onClick={() => handleSelect(idx, option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-sm text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!allAnswered}
          onClick={() => onResolve(answers)}
          type="button"
        >
          Submit Answers
        </button>
        <button
          className="rounded-lg bg-zinc-700 px-4 py-2 font-medium text-sm text-zinc-300 hover:bg-zinc-600"
          onClick={onAcceptAssumptions}
          type="button"
        >
          Accept Assumptions & Proceed
        </button>
      </div>
    </div>
  );
}
