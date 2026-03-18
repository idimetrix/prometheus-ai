import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { ArchitectureResult } from "./architecture";
import type { DiscoveryResult } from "./discovery";

const logger = createLogger("orchestrator:phase-gate");

export interface PhaseGateResult {
  blockers: string[];
  checks: Array<{
    name: string;
    passed: boolean;
    value: unknown;
    threshold: unknown;
    message: string;
  }>;
  passed: boolean;
  phase: string;
}

/**
 * PhaseGate evaluates phase output against quality thresholds
 * before allowing the pipeline to proceed. Failed gates trigger
 * a pause and human_input_needed event.
 */
export class PhaseGate {
  private readonly eventPublisher = new EventPublisher();

  /**
   * Validate discovery phase output.
   */
  validateDiscovery(result: DiscoveryResult): PhaseGateResult {
    const checks = [
      {
        name: "confidence",
        passed: result.confidenceScore >= 0.8,
        value: result.confidenceScore,
        threshold: 0.8,
        message:
          result.confidenceScore >= 0.8
            ? "Confidence score meets threshold"
            : `Confidence ${result.confidenceScore.toFixed(2)} below 0.8 threshold`,
      },
      {
        name: "requirements_present",
        passed: result.requirements.length > 0,
        value: result.requirements.length,
        threshold: 1,
        message:
          result.requirements.length > 0
            ? `${result.requirements.length} requirements identified`
            : "No requirements extracted from discovery",
      },
      {
        name: "srs_length",
        passed: result.srs.length > 200,
        value: result.srs.length,
        threshold: 200,
        message:
          result.srs.length > 200
            ? "SRS has sufficient content"
            : "SRS is too short, may be incomplete",
      },
    ];

    const blockers = checks.filter((c) => !c.passed).map((c) => c.message);

    return {
      passed: blockers.length === 0,
      phase: "discovery",
      checks,
      blockers,
    };
  }

  /**
   * Validate architecture phase output.
   */
  validateArchitecture(result: ArchitectureResult): PhaseGateResult {
    const checks = [
      {
        name: "tech_stack_present",
        passed: Object.keys(result.techStack).length > 0,
        value: Object.keys(result.techStack).length,
        threshold: 1,
        message:
          Object.keys(result.techStack).length > 0
            ? `Tech stack defined with ${Object.keys(result.techStack).length} entries`
            : "No tech stack defined",
      },
      {
        name: "db_schema_present",
        passed: result.dbSchema.length > 50,
        value: result.dbSchema.length,
        threshold: 50,
        message:
          result.dbSchema.length > 50
            ? "Database schema is defined"
            : "Database schema is missing or too brief",
      },
      {
        name: "api_contracts_present",
        passed: result.apiContracts.length > 50,
        value: result.apiContracts.length,
        threshold: 50,
        message:
          result.apiContracts.length > 50
            ? "API contracts are defined"
            : "API contracts are missing or too brief",
      },
      {
        name: "blueprint_length",
        passed: result.blueprint.length > 500,
        value: result.blueprint.length,
        threshold: 500,
        message:
          result.blueprint.length > 500
            ? "Blueprint has sufficient content"
            : "Blueprint is too short",
      },
    ];

    const blockers = checks.filter((c) => !c.passed).map((c) => c.message);

    return {
      passed: blockers.length === 0,
      phase: "architecture",
      checks,
      blockers,
    };
  }

  /**
   * Validate CI loop results.
   */
  validateCILoop(passRate: number, totalTests: number): PhaseGateResult {
    const checks = [
      {
        name: "pass_rate",
        passed: passRate >= 95,
        value: passRate,
        threshold: 95,
        message:
          passRate >= 95
            ? `Test pass rate ${passRate}% meets threshold`
            : `Test pass rate ${passRate}% below 95% threshold`,
      },
      {
        name: "tests_exist",
        passed: totalTests > 0,
        value: totalTests,
        threshold: 1,
        message:
          totalTests > 0
            ? `${totalTests} tests executed`
            : "No tests were executed",
      },
    ];

    const blockers = checks.filter((c) => !c.passed).map((c) => c.message);

    return {
      passed: blockers.length === 0,
      phase: "ci_loop",
      checks,
      blockers,
    };
  }

  /**
   * Publish gate failure event for human intervention.
   */
  async publishGateFailure(
    sessionId: string,
    result: PhaseGateResult
  ): Promise<void> {
    logger.warn(
      { phase: result.phase, blockers: result.blockers },
      "Phase gate failed"
    );

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.CHECKPOINT,
      data: {
        event: "phase_gate_failed",
        phase: result.phase,
        checks: result.checks,
        blockers: result.blockers,
        message: `Phase gate "${result.phase}" failed. Blockers: ${result.blockers.join("; ")}`,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
