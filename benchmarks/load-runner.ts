/**
 * Load testing / benchmark runner for Prometheus services (GAP-107).
 *
 * Sends concurrent requests to service endpoints and collects
 * latency, throughput, and error-rate metrics.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("benchmarks:load-runner");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkConfig {
  /** Total number of requests to send */
  concurrency: number;
  /** Number of parallel workers */
  description: string;
  /** Optional request body (JSON) */
  method: "GET" | "POST";
  /** Request body */
  payload?: Record<string, unknown>;
  /** Target endpoint URL */
  targetUrl: string;
  /** Total number of requests */
  totalRequests: number;
}

export interface RequestResult {
  durationMs: number;
  error?: string;
  statusCode: number;
  success: boolean;
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  errorCount: number;
  errorRate: number;
  maxLatencyMs: number;
  meanLatencyMs: number;
  medianLatencyMs: number;
  minLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsPerSecond: number;
  successCount: number;
  totalDurationMs: number;
  totalRequests: number;
}

// ---------------------------------------------------------------------------
// Load Runner
// ---------------------------------------------------------------------------

export class LoadRunner {
  /**
   * Execute a benchmark and return aggregate metrics.
   */
  async run(config: BenchmarkConfig): Promise<BenchmarkResult> {
    const { targetUrl, method, payload, totalRequests, concurrency } = config;

    logger.info(
      {
        targetUrl,
        method,
        totalRequests,
        concurrency,
      },
      "Starting load test"
    );

    const results: RequestResult[] = [];
    const startTime = Date.now();

    // Create a queue of request indices and process them with workers
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < totalRequests) {
        const _index = nextIndex++;
        const reqStart = Date.now();

        try {
          const response = await fetch(targetUrl, {
            method,
            headers: payload
              ? { "Content-Type": "application/json" }
              : undefined,
            body: payload ? JSON.stringify(payload) : undefined,
            signal: AbortSignal.timeout(30_000),
          });

          results.push({
            statusCode: response.status,
            durationMs: Date.now() - reqStart,
            success: response.ok,
          });

          // Consume body to release connection
          await response.text();
        } catch (err) {
          results.push({
            statusCode: 0,
            durationMs: Date.now() - reqStart,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    // Spawn concurrent workers
    const workers: Promise<void>[] = [];
    const workerCount = Math.min(concurrency, totalRequests);
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const totalDurationMs = Date.now() - startTime;

    // Compute aggregate metrics
    const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.length - successCount;

    const benchmarkResult: BenchmarkResult = {
      config,
      totalRequests: results.length,
      successCount,
      errorCount,
      errorRate: results.length > 0 ? errorCount / results.length : 0,
      totalDurationMs,
      requestsPerSecond:
        totalDurationMs > 0 ? (results.length / totalDurationMs) * 1000 : 0,
      meanLatencyMs: this.mean(durations),
      medianLatencyMs: this.percentile(durations, 50),
      p95LatencyMs: this.percentile(durations, 95),
      p99LatencyMs: this.percentile(durations, 99),
      minLatencyMs: durations[0] ?? 0,
      maxLatencyMs: durations.at(-1) ?? 0,
    };

    logger.info(
      {
        totalRequests: benchmarkResult.totalRequests,
        successCount: benchmarkResult.successCount,
        errorRate: benchmarkResult.errorRate.toFixed(3),
        rps: benchmarkResult.requestsPerSecond.toFixed(1),
        p95Ms: benchmarkResult.p95LatencyMs,
        p99Ms: benchmarkResult.p99LatencyMs,
        totalMs: benchmarkResult.totalDurationMs,
      },
      "Load test completed"
    );

    return benchmarkResult;
  }

  /**
   * Run multiple benchmark configs in sequence and return all results.
   */
  async runSuite(configs: BenchmarkConfig[]): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    for (const config of configs) {
      const result = await this.run(config);
      results.push(result);
    }
    return results;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private mean(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round(sum / values.length);
  }

  private percentile(sortedValues: number[], pct: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }
    const index = Math.ceil((pct / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)] ?? 0;
  }
}

/**
 * Default benchmark suite for Prometheus services.
 */
export function createDefaultSuite(baseUrl: string): BenchmarkConfig[] {
  return [
    {
      description: "Health check endpoint",
      targetUrl: `${baseUrl}/health`,
      method: "GET",
      totalRequests: 100,
      concurrency: 10,
    },
    {
      description: "Model route endpoint",
      targetUrl: `${baseUrl}/route`,
      method: "POST",
      payload: {
        slot: "fastLoop",
        messages: [
          { role: "user", content: "Hello, respond with a single word." },
        ],
      },
      totalRequests: 20,
      concurrency: 5,
    },
    {
      description: "Token estimation endpoint",
      targetUrl: `${baseUrl}/v1/estimate-tokens`,
      method: "POST",
      payload: {
        messages: [
          { role: "user", content: "Estimate the tokens for this message." },
        ],
      },
      totalRequests: 50,
      concurrency: 10,
    },
  ];
}
