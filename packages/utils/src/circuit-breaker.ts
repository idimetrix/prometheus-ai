import { createLogger } from "@prometheus/logger";

const logger = createLogger("utils:circuit-breaker");

// ─── Types ────────────────────────────────────────────────────────────────────

export type CircuitBreakerState = "closed" | "half-open" | "open";

export interface CircuitBreakerConfig {
  /** Number of failures before tripping to open (default: 5) */
  failureThreshold: number;
  /** Name for logging and metrics */
  name: string;
  /** Callback when state changes */
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
  /** Time in ms before attempting recovery (default: 30000) */
  recoveryWindowMs: number;
  /** Number of successful calls in half-open to close circuit (default: 2) */
  successThreshold: number;
}

export interface CircuitBreakerMetrics {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  state: CircuitBreakerState;
  totalFailures: number;
  totalSuccesses: number;
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, "name"> = {
  failureThreshold: 5,
  recoveryWindowMs: 30_000,
  successThreshold: 2,
};

export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureTime: number | null = null;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws if the circuit is open and recovery window has not elapsed.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error(
        `Circuit breaker "${this.config.name}" is open. Retry after ${this.config.recoveryWindowMs}ms.`
      );
    }

    // Transition from open to half-open when recovery window has elapsed
    if (this.state === "open") {
      this.transition("half-open");
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get the current circuit breaker state.
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get detailed metrics for monitoring.
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Manually reset the circuit breaker to closed state.
   */
  reset(): void {
    this.transition("closed");
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  private canExecute(): boolean {
    if (this.state === "closed" || this.state === "half-open") {
      return true;
    }

    // Open: check if recovery window has elapsed
    if (this.lastFailureTime === null) {
      return true;
    }

    return Date.now() - this.lastFailureTime >= this.config.recoveryWindowMs;
  }

  private onSuccess(): void {
    this.totalSuccesses++;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;

    if (
      this.state === "half-open" &&
      this.consecutiveSuccesses >= this.config.successThreshold
    ) {
      this.transition("closed");
      this.consecutiveSuccesses = 0;
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();

    if (
      this.state === "closed" &&
      this.consecutiveFailures >= this.config.failureThreshold
    ) {
      this.transition("open");
    }

    if (this.state === "half-open") {
      this.transition("open");
    }
  }

  private transition(newState: CircuitBreakerState): void {
    if (this.state === newState) {
      return;
    }

    const from = this.state;
    this.state = newState;

    logger.info(
      { name: this.config.name, from, to: newState },
      "Circuit breaker state change"
    );

    this.config.onStateChange?.(from, newState);
  }
}
