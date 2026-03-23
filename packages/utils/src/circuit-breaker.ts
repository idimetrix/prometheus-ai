import { createLogger } from "@prometheus/logger";

const logger = createLogger("utils:circuit-breaker");

// ─── Types ────────────────────────────────────────────────────────────────────

export type CircuitBreakerState = "closed" | "half-open" | "open";

export interface CircuitBreakerConfig {
  /** Number of failures before tripping to open (default: 5) */
  failureThreshold: number;
  /** Sliding window in ms - open after failureThreshold failures within this window (default: 60000) */
  failureWindowMs: number;
  /** Name for logging and metrics */
  name: string;
  /** Callback when state changes */
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
  /** Time in ms before attempting recovery / half-open (default: 30000) */
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

export interface TransitionRecord {
  from: CircuitBreakerState;
  timestamp: number;
  to: CircuitBreakerState;
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, "name"> = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
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
  private readonly failureTimestamps: number[] = [];
  private readonly transitionHistory: TransitionRecord[] = [];

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
   * Get the history of state transitions for auditing.
   */
  getTransitionHistory(): TransitionRecord[] {
    return [...this.transitionHistory];
  }

  /**
   * Manually reset the circuit breaker to closed state.
   */
  reset(): void {
    this.transition("closed");
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.failureTimestamps.length = 0;
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
    const now = Date.now();
    this.totalFailures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = now;

    // Track failure timestamp for sliding window
    this.failureTimestamps.push(now);

    // Prune timestamps outside the failure window
    const windowStart = now - this.config.failureWindowMs;
    while (
      this.failureTimestamps.length > 0 &&
      (this.failureTimestamps[0] ?? 0) < windowStart
    ) {
      this.failureTimestamps.shift();
    }

    // Open circuit if enough failures within the sliding window
    if (
      this.state === "closed" &&
      this.failureTimestamps.length >= this.config.failureThreshold
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

    this.transitionHistory.push({
      from,
      to: newState,
      timestamp: Date.now(),
    });

    logger.info(
      { name: this.config.name, from, to: newState },
      "Circuit breaker state change"
    );

    this.config.onStateChange?.(from, newState);
  }
}

// ─── Provider Circuit Breaker Registry ───────────────────────────────────────

/**
 * Manages one CircuitBreaker per provider name.
 * Useful for model-router where each LLM provider has independent failure modes.
 */
export class ProviderCircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(defaultConfig?: Partial<CircuitBreakerConfig>) {
    this.defaultConfig = defaultConfig ?? {};
  }

  /**
   * Get or create a circuit breaker for a provider.
   */
  get(provider: string): CircuitBreaker {
    let breaker = this.breakers.get(provider);
    if (!breaker) {
      breaker = new CircuitBreaker({
        ...this.defaultConfig,
        name: `provider:${provider}`,
      });
      this.breakers.set(provider, breaker);
    }
    return breaker;
  }

  /**
   * Execute a function through the provider's circuit breaker.
   */
  execute<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    return this.get(provider).execute(fn);
  }

  /**
   * Get metrics for all registered providers.
   */
  getAllMetrics(): Map<string, CircuitBreakerMetrics> {
    const metrics = new Map<string, CircuitBreakerMetrics>();
    for (const [provider, breaker] of this.breakers) {
      metrics.set(provider, breaker.getMetrics());
    }
    return metrics;
  }

  /**
   * Get the full transition history across all providers for auditing.
   */
  getTransitionHistory(): Map<string, TransitionRecord[]> {
    const history = new Map<string, TransitionRecord[]>();
    for (const [provider, breaker] of this.breakers) {
      history.set(provider, breaker.getTransitionHistory());
    }
    return history;
  }

  /**
   * Reset all circuit breakers.
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}
