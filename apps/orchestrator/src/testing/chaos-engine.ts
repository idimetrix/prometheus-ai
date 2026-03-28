/**
 * GAP-102: Chaos Engineering
 *
 * Injects failures (network, disk, memory), verifies system recovers
 * gracefully, and generates resilience reports.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:chaos-engine");

export type FaultType =
  | "network_latency"
  | "network_partition"
  | "disk_full"
  | "memory_pressure"
  | "service_crash"
  | "cpu_spike";

export interface ChaosExperiment {
  completedAt?: number;
  duration: number;
  faultType: FaultType;
  id: string;
  intensity: number;
  name: string;
  startedAt?: number;
  status: "pending" | "running" | "completed" | "failed";
  target: string;
}

export interface ResilienceReport {
  dataLoss: boolean;
  errorsAfterRecovery: number;
  errorsDuringFault: number;
  experimentId: string;
  impactedServices: string[];
  recommendations: string[];
  recovered: boolean;
  recoveryTimeMs: number;
}

export class ChaosEngine {
  private readonly experiments = new Map<string, ChaosExperiment>();

  createExperiment(params: {
    name: string;
    faultType: FaultType;
    target: string;
    durationMs: number;
    intensity?: number;
  }): ChaosExperiment {
    const id = `chaos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const experiment: ChaosExperiment = {
      id,
      name: params.name,
      faultType: params.faultType,
      target: params.target,
      duration: params.durationMs,
      intensity: params.intensity ?? 0.5,
      status: "pending",
    };

    this.experiments.set(id, experiment);
    logger.info(
      { experimentId: id, faultType: params.faultType, target: params.target },
      "Chaos experiment created"
    );
    return experiment;
  }

  async runExperiment(
    experimentId: string,
    injectFault: (exp: ChaosExperiment) => Promise<void>,
    checkHealth: () => Promise<{ healthy: boolean; errors: number }>
  ): Promise<ResilienceReport> {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    exp.status = "running";
    exp.startedAt = Date.now();

    // Check pre-fault health
    const preFault = await checkHealth();
    logger.info(
      { experimentId, preFaultHealthy: preFault.healthy },
      "Pre-fault health check"
    );

    // Inject fault
    try {
      await injectFault(exp);
    } catch (error) {
      exp.status = "failed";
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ experimentId, error: msg }, "Fault injection failed");
      throw error;
    }

    // Wait for fault duration
    await new Promise((r) => setTimeout(r, Math.min(exp.duration, 30_000)));

    // Check post-fault health
    const postFault = await checkHealth();
    const recoveryStart = Date.now();

    // Wait for recovery (up to 30s)
    let recovered = postFault.healthy;
    let recoveryChecks = 0;
    while (!recovered && recoveryChecks < 6) {
      await new Promise((r) => setTimeout(r, 5000));
      const check = await checkHealth();
      recovered = check.healthy;
      recoveryChecks++;
    }

    const recoveryTimeMs = recovered ? Date.now() - recoveryStart : -1;

    exp.status = "completed";
    exp.completedAt = Date.now();

    const report: ResilienceReport = {
      experimentId,
      recovered,
      recoveryTimeMs,
      impactedServices: [exp.target],
      dataLoss: false,
      errorsDuringFault: postFault.errors - preFault.errors,
      errorsAfterRecovery: 0,
      recommendations: this.generateRecommendations(
        exp,
        recovered,
        recoveryTimeMs
      ),
    };

    logger.info(
      { experimentId, recovered, recoveryTimeMs },
      "Chaos experiment completed"
    );

    return report;
  }

  getExperiment(id: string): ChaosExperiment | undefined {
    return this.experiments.get(id);
  }

  listExperiments(): ChaosExperiment[] {
    return [...this.experiments.values()];
  }

  private generateRecommendations(
    exp: ChaosExperiment,
    recovered: boolean,
    recoveryMs: number
  ): string[] {
    const recs: string[] = [];
    if (!recovered) {
      recs.push(
        `Service "${exp.target}" did not recover from ${exp.faultType}. Add circuit breakers and health checks.`
      );
    } else if (recoveryMs > 10_000) {
      recs.push(
        `Recovery took ${(recoveryMs / 1000).toFixed(1)}s. Consider adding auto-scaling or faster failover.`
      );
    }
    if (exp.faultType === "network_partition") {
      recs.push(
        "Ensure services handle network partitions gracefully with retry logic and timeouts."
      );
    }
    if (exp.faultType === "memory_pressure") {
      recs.push(
        "Add memory limits and OOM handling to prevent cascading failures."
      );
    }
    return recs;
  }
}
