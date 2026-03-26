"use client";

import { Button } from "@prometheus/ui";
import { ArrowLeft, CheckCircle, ChevronRight, Rocket, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface TutorialStep {
  /** Description body */
  description: string;
  /** Which side to place the tooltip relative to the target */
  placement: "top" | "bottom" | "left" | "right";
  /** CSS selector for the element to highlight */
  targetSelector: string;
  /** Title shown in the tooltip */
  title: string;
}

interface InteractiveTutorialProps {
  /** Called when the tutorial completes or is skipped */
  onComplete?: () => void;
  /** Called when the tutorial is dismissed */
  onDismiss?: () => void;
  /** Override the default step list */
  steps?: TutorialStep[];
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "prometheus:tutorial:progress";
const STORAGE_COMPLETED_KEY = "prometheus:tutorial:completed";

const DEFAULT_STEPS: TutorialStep[] = [
  {
    targetSelector: '[data-tutorial="project-overview"]',
    title: "Project Overview",
    description:
      "This is your project dashboard. Here you can see all your projects, their status, and quick actions. Click on any project to dive deeper.",
    placement: "bottom",
  },
  {
    targetSelector: '[data-tutorial="open-chat"]',
    title: "Open Chat",
    description:
      "Use the chat panel to communicate with AI agents. You can describe tasks in natural language, and agents will break them down and execute them for you.",
    placement: "left",
  },
  {
    targetSelector: '[data-tutorial="submit-task"]',
    title: "Submit Your First Task",
    description:
      'Type a task description and press Enter or click Send. Try something like "Add a login page with email and password fields" to get started.',
    placement: "top",
  },
  {
    targetSelector: '[data-tutorial="agent-work"]',
    title: "Watch Agents Work",
    description:
      "Once a task is submitted, you can watch agents work in real-time. They will analyze your codebase, plan changes, write code, and run tests automatically.",
    placement: "right",
  },
  {
    targetSelector: '[data-tutorial="review-results"]',
    title: "Review Results",
    description:
      "After agents complete a task, review the changes in the diff view. You can approve, request modifications, or reject changes before they are applied.",
    placement: "bottom",
  },
  {
    targetSelector: '[data-tutorial="deploy"]',
    title: "Deploy",
    description:
      "When you are ready, deploy your project with a single click. Prometheus handles CI/CD, preview environments, and production deployments.",
    placement: "left",
  },
];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function loadProgress(): number {
  if (typeof window === "undefined") {
    return 0;
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function saveProgress(step: number): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_KEY, String(step));
}

function markCompleted(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_COMPLETED_KEY, "true");
  localStorage.removeItem(STORAGE_KEY);
}

function isCompleted(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return localStorage.getItem(STORAGE_COMPLETED_KEY) === "true";
}

/** Reset tutorial progress so it can be restarted from settings. */
export function resetTutorial(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_COMPLETED_KEY);
}

/* -------------------------------------------------------------------------- */
/*  Overlay Component                                                          */
/* -------------------------------------------------------------------------- */

interface OverlayProps {
  targetRect: DOMRect | null;
}

function getDotClass(dotIndex: number, currentIndex: number): string {
  if (dotIndex === currentIndex) {
    return "bg-violet-500";
  }
  if (dotIndex < currentIndex) {
    return "bg-violet-800";
  }
  return "bg-zinc-700";
}

function Overlay({ targetRect }: OverlayProps) {
  if (!targetRect) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          zIndex: 9998,
          pointerEvents: "auto",
        }}
      />
    );
  }

  const padding = 8;
  const x = targetRect.left - padding;
  const y = targetRect.top - padding;
  const w = targetRect.width + padding * 2;
  const h = targetRect.height + padding * 2;

  return (
    <svg
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 9998,
        pointerEvents: "auto",
      }}
    >
      <title>Tutorial spotlight overlay</title>
      <defs>
        <mask id="tutorial-mask">
          <rect fill="white" height="100%" width="100%" x="0" y="0" />
          <rect fill="black" height={h} rx="8" width={w} x={x} y={y} />
        </mask>
      </defs>
      <rect
        fill="rgba(0, 0, 0, 0.6)"
        height="100%"
        mask="url(#tutorial-mask)"
        width="100%"
        x="0"
        y="0"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tooltip Component                                                          */
/* -------------------------------------------------------------------------- */

interface TooltipProps {
  currentIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  step: TutorialStep;
  targetRect: DOMRect | null;
  totalSteps: number;
}

function Tooltip({
  step,
  currentIndex,
  totalSteps,
  targetRect,
  onNext,
  onPrevious,
  onSkip,
}: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const isLast = currentIndex === totalSteps - 1;
  const isFirst = currentIndex === 0;

  useEffect(() => {
    if (!targetRect) {
      setPosition({
        top: window.innerHeight / 2 - 120,
        left: window.innerWidth / 2 - 200,
      });
      return;
    }

    const tooltipWidth = 360;
    const tooltipHeight = 220;
    const gap = 16;

    let top = 0;
    let left = 0;

    switch (step.placement) {
      case "bottom":
        top = targetRect.bottom + gap;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case "top":
        top = targetRect.top - tooltipHeight - gap;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.left - tooltipWidth - gap;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.right + gap;
        break;
      default:
        break;
    }

    // Clamp to viewport
    left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));
    top = Math.max(16, Math.min(top, window.innerHeight - tooltipHeight - 16));

    setPosition({ top, left });
  }, [targetRect, step.placement]);

  return (
    <div
      className="rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
      ref={tooltipRef}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 10_000,
        width: 360,
        pointerEvents: "auto",
      }}
    >
      {/* Arrow indicator */}
      {targetRect && (
        <ArrowIndicator
          placement={step.placement}
          targetRect={targetRect}
          tooltipLeft={position.left}
          tooltipTop={position.top}
        />
      )}

      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-violet-400" />
          <span className="font-medium text-sm text-zinc-400">
            Step {currentIndex + 1} of {totalSteps}
          </span>
        </div>
        <button
          aria-label="Skip tutorial"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          onClick={onSkip}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <h3 className="mb-2 font-semibold text-lg text-white">{step.title}</h3>
      <p className="mb-4 text-sm text-zinc-400 leading-relaxed">
        {step.description}
      </p>

      {/* Progress dots */}
      <div className="mb-4 flex justify-center gap-1.5">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            className={`h-2 w-2 rounded-full transition-colors ${getDotClass(i, currentIndex)}`}
            key={`dot-${i.toString()}`}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          className="text-zinc-500 hover:text-zinc-300"
          onClick={onSkip}
          size="sm"
          variant="ghost"
        >
          Skip
        </Button>
        <div className="flex gap-2">
          {!isFirst && (
            <Button onClick={onPrevious} size="sm" variant="outline">
              <ArrowLeft className="mr-1 h-3 w-3" />
              Previous
            </Button>
          )}
          <Button onClick={onNext} size="sm">
            {isLast ? (
              <>
                <CheckCircle className="mr-1 h-3 w-3" />
                Finish
              </>
            ) : (
              <>
                Next
                <ChevronRight className="ml-1 h-3 w-3" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Arrow Indicator                                                            */
/* -------------------------------------------------------------------------- */

interface ArrowIndicatorProps {
  placement: TutorialStep["placement"];
  targetRect: DOMRect;
  tooltipLeft: number;
  tooltipTop: number;
}

function ArrowIndicator({
  placement,
  targetRect,
  tooltipTop,
  tooltipLeft,
}: ArrowIndicatorProps) {
  const size = 10;

  let style: React.CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
    borderStyle: "solid",
  };

  switch (placement) {
    case "bottom":
      style = {
        ...style,
        top: -size,
        left: Math.max(
          20,
          targetRect.left + targetRect.width / 2 - tooltipLeft - size
        ),
        borderWidth: `0 ${size}px ${size}px ${size}px`,
        borderColor: "transparent transparent rgb(39 39 42) transparent",
      };
      break;
    case "top":
      style = {
        ...style,
        bottom: -size,
        left: Math.max(
          20,
          targetRect.left + targetRect.width / 2 - tooltipLeft - size
        ),
        borderWidth: `${size}px ${size}px 0 ${size}px`,
        borderColor: "rgb(39 39 42) transparent transparent transparent",
      };
      break;
    case "left":
      style = {
        ...style,
        right: -size,
        top: Math.max(
          20,
          targetRect.top + targetRect.height / 2 - tooltipTop - size
        ),
        borderWidth: `${size}px 0 ${size}px ${size}px`,
        borderColor: "transparent transparent transparent rgb(39 39 42)",
      };
      break;
    case "right":
      style = {
        ...style,
        left: -size,
        top: Math.max(
          20,
          targetRect.top + targetRect.height / 2 - tooltipTop - size
        ),
        borderWidth: `${size}px ${size}px ${size}px 0`,
        borderColor: "transparent rgb(39 39 42) transparent transparent",
      };
      break;
    default:
      break;
  }

  return <div style={style} />;
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function InteractiveTutorial({
  onComplete,
  onDismiss,
  steps = DEFAULT_STEPS,
}: InteractiveTutorialProps) {
  const [currentStep, setCurrentStep] = useState(() => loadProgress());
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isActive, setIsActive] = useState(() => !isCompleted());

  const activeStep = useMemo(
    () => (steps[currentStep] ?? steps[0]) as TutorialStep | undefined,
    [steps, currentStep]
  );

  // Locate and observe the target element
  useEffect(() => {
    if (!(isActive && activeStep)) {
      return;
    }

    const findTarget = () => {
      const el = document.querySelector(activeStep.targetSelector);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setTargetRect(null);
      }
    };

    findTarget();

    // Recalculate on scroll / resize
    const recalc = () => {
      const el = document.querySelector(activeStep.targetSelector);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      }
    };

    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);

    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [isActive, activeStep]);

  const handleNext = useCallback(() => {
    if (currentStep >= steps.length - 1) {
      markCompleted();
      setIsActive(false);
      onComplete?.();
      return;
    }
    const next = currentStep + 1;
    setCurrentStep(next);
    saveProgress(next);
  }, [currentStep, steps.length, onComplete]);

  const handlePrevious = useCallback(() => {
    if (currentStep <= 0) {
      return;
    }
    const prev = currentStep - 1;
    setCurrentStep(prev);
    saveProgress(prev);
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    markCompleted();
    setIsActive(false);
    onDismiss?.();
  }, [onDismiss]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSkip();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrevious();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, handleSkip, handleNext, handlePrevious]);

  if (!isActive || typeof document === "undefined" || !activeStep) {
    return null;
  }

  return createPortal(
    <div aria-label="Interactive tutorial" aria-modal="true" role="dialog">
      <Overlay targetRect={targetRect} />
      <Tooltip
        currentIndex={currentStep}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onSkip={handleSkip}
        step={activeStep}
        targetRect={targetRect}
        totalSteps={steps.length}
      />
    </div>,
    document.body
  );
}
