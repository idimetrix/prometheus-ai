import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:workflow:phase-timeouts");

/** Workflow phases with their default timeouts in milliseconds */
const DEFAULT_PHASE_TIMEOUTS: Record<string, number> = {
  discovery: 2 * 60 * 1000, // 2 minutes
  architecture: 5 * 60 * 1000, // 5 minutes
  planning: 3 * 60 * 1000, // 3 minutes
  coding: 30 * 60 * 1000, // 30 minutes per step
  testing: 10 * 60 * 1000, // 10 minutes
  ci: 15 * 60 * 1000, // 15 minutes
  security: 5 * 60 * 1000, // 5 minutes
  review: 5 * 60 * 1000, // 5 minutes
  deploy: 10 * 60 * 1000, // 10 minutes
};

/** Tracked phase with its start time and timeout */
interface TrackedPhase {
  extended: boolean;
  phase: string;
  startedAt: number;
  timeoutMs: number;
}

/**
 * PhaseTimeoutManager tracks per-phase execution timeouts.
 *
 * Each phase in the agent execution pipeline has a configured timeout.
 * The manager tracks when phases start and can check if they've exceeded
 * their allotted time. Timeouts can be extended for long-running phases.
 */
export class PhaseTimeoutManager {
  private readonly phases = new Map<string, TrackedPhase>();
  private readonly customTimeouts: Record<string, number>;

  constructor(customTimeouts?: Record<string, number>) {
    this.customTimeouts = customTimeouts ?? {};
  }

  /**
   * Start tracking a phase. Records the start time and timeout.
   */
  startPhase(phase: string): void {
    const timeoutMs =
      this.customTimeouts[phase] ??
      DEFAULT_PHASE_TIMEOUTS[phase] ??
      10 * 60 * 1000;

    this.phases.set(phase, {
      phase,
      startedAt: Date.now(),
      timeoutMs,
      extended: false,
    });

    logger.info({ phase, timeoutMs }, "Phase timeout started");
  }

  /**
   * Check if a phase has exceeded its timeout.
   * Returns the remaining time in ms, or a negative value if timed out.
   */
  checkTimeout(phase: string): {
    timedOut: boolean;
    elapsedMs: number;
    remainingMs: number;
  } {
    const tracked = this.phases.get(phase);
    if (!tracked) {
      return { timedOut: false, elapsedMs: 0, remainingMs: 0 };
    }

    const elapsedMs = Date.now() - tracked.startedAt;
    const remainingMs = tracked.timeoutMs - elapsedMs;
    const timedOut = remainingMs <= 0;

    if (timedOut) {
      logger.warn(
        { phase, elapsedMs, timeoutMs: tracked.timeoutMs },
        "Phase timed out"
      );
    }

    return { timedOut, elapsedMs, remainingMs };
  }

  /**
   * Extend the timeout for a phase by the given amount.
   */
  extendTimeout(phase: string, extraMs: number): void {
    const tracked = this.phases.get(phase);
    if (!tracked) {
      logger.warn({ phase }, "Cannot extend timeout: phase not tracked");
      return;
    }

    tracked.timeoutMs += extraMs;
    tracked.extended = true;

    logger.info(
      { phase, extraMs, newTimeoutMs: tracked.timeoutMs },
      "Phase timeout extended"
    );
  }

  /**
   * Complete a phase, removing it from tracking.
   */
  completePhase(phase: string): {
    elapsedMs: number;
    wasExtended: boolean;
  } | null {
    const tracked = this.phases.get(phase);
    if (!tracked) {
      return null;
    }

    const elapsedMs = Date.now() - tracked.startedAt;
    const wasExtended = tracked.extended;
    this.phases.delete(phase);

    logger.info({ phase, elapsedMs, wasExtended }, "Phase completed");

    return { elapsedMs, wasExtended };
  }

  /**
   * Get all currently active phases and their status.
   */
  getActivePhases(): Array<{
    phase: string;
    elapsedMs: number;
    remainingMs: number;
    timedOut: boolean;
  }> {
    const results: Array<{
      phase: string;
      elapsedMs: number;
      remainingMs: number;
      timedOut: boolean;
    }> = [];

    for (const [phase] of this.phases) {
      results.push({
        phase,
        ...this.checkTimeout(phase),
      });
    }

    return results;
  }

  /**
   * Get the default timeout for a phase.
   */
  static getDefaultTimeout(phase: string): number {
    return DEFAULT_PHASE_TIMEOUTS[phase] ?? 10 * 60 * 1000;
  }
}
