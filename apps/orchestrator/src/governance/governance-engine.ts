/**
 * AI Code Governance Engine
 *
 * Risk analysis: scores changes by impact (destructive ops,
 * credential exposure, dependency additions).
 *
 * Integrates with trust scoring and audit trail for complete
 * governance coverage.
 */

import { createLogger } from "@prometheus/logger";
import type { AuditTrail } from "./audit-trail";
import type { TrustScorer } from "./trust-scorer";

const logger = createLogger("orchestrator:governance");

const NETWORK_OPERATION_PATTERN =
  /\b(curl|wget|fetch|npm\s+install|pip\s+install)\b/;

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export interface RiskAssessment {
  action: string;
  agentRole: string;
  allowed: boolean;
  requiresApproval: boolean;
  risks: RiskFactor[];
  severity: RiskSeverity;
  totalScore: number;
}

export interface RiskFactor {
  category: string;
  description: string;
  score: number;
}

const DESTRUCTIVE_FILE_PATTERNS = [
  /^\.env/,
  /credentials/i,
  /secrets?\./i,
  /\.pem$/,
  /\.key$/,
  /docker-compose/,
  /Dockerfile/,
  /\.github\/workflows/,
  /infra\/k8s/,
  /migration/i,
];

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\b/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bnpm\s+publish\b/,
  /\bdocker\s+push\b/,
];

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey|secret|token|password|credential|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}/i,
  /(?:sk-|pk_live_|pk_test_|ghp_|gho_|github_pat_)\w{10,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
];

export class GovernanceEngine {
  private readonly trustScorer?: TrustScorer;
  private readonly auditTrail?: AuditTrail;

  constructor(trustScorer?: TrustScorer, auditTrail?: AuditTrail) {
    this.trustScorer = trustScorer;
    this.auditTrail = auditTrail;
  }

  assessFileWrite(
    filePath: string,
    content: string,
    agentRole: string
  ): RiskAssessment {
    const risks: RiskFactor[] = [];

    // Check for sensitive file paths
    for (const pattern of DESTRUCTIVE_FILE_PATTERNS) {
      if (pattern.test(filePath)) {
        risks.push({
          category: "sensitive_file",
          description: `Writing to sensitive file: ${filePath}`,
          score: 0.6,
        });
        break;
      }
    }

    // Check for secrets in content
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        risks.push({
          category: "credential_exposure",
          description:
            "Potential credential or secret detected in file content",
          score: 0.9,
        });
        break;
      }
    }

    // Check for large file writes (>500 lines)
    const lineCount = content.split("\n").length;
    if (lineCount > 500) {
      risks.push({
        category: "large_change",
        description: `Large file write: ${lineCount} lines`,
        score: 0.3,
      });
    }

    return this.finalizeAssessment("file_write", agentRole, risks);
  }

  assessCommand(command: string, agentRole: string): RiskAssessment {
    const risks: RiskFactor[] = [];

    for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        risks.push({
          category: "destructive_command",
          description: `Destructive command detected: ${command.slice(0, 100)}`,
          score: 0.8,
        });
      }
    }

    // Check for network operations
    if (NETWORK_OPERATION_PATTERN.test(command)) {
      risks.push({
        category: "network_operation",
        description: "Command involves network access",
        score: 0.3,
      });
    }

    return this.finalizeAssessment("terminal_exec", agentRole, risks);
  }

  assessDependencyAdd(packageName: string, agentRole: string): RiskAssessment {
    const risks: RiskFactor[] = [
      {
        category: "dependency_addition",
        description: `New dependency: ${packageName}`,
        score: 0.4,
      },
    ];

    return this.finalizeAssessment("dependency_add", agentRole, risks);
  }

  private finalizeAssessment(
    action: string,
    agentRole: string,
    risks: RiskFactor[]
  ): RiskAssessment {
    const totalScore = risks.reduce((sum, r) => sum + r.score, 0);
    const maxScore = Math.max(...risks.map((r) => r.score), 0);

    let severity: RiskSeverity;
    if (maxScore >= 0.9) {
      severity = "critical";
    } else if (maxScore >= 0.6) {
      severity = "high";
    } else if (maxScore >= 0.3) {
      severity = "medium";
    } else {
      severity = "low";
    }

    // Check trust level for the agent
    let trustLevel = 1.0;
    if (this.trustScorer) {
      const trust = this.trustScorer.getTrustLevel(agentRole);
      trustLevel = trust.score;
    }

    const requiresApproval =
      severity === "critical" ||
      (severity === "high" && trustLevel < 0.85) ||
      (severity === "medium" && trustLevel < 0.6);

    const allowed =
      severity !== "critical" ||
      this.trustScorer?.getTrustLevel(agentRole).level === "autonomous";

    const assessment: RiskAssessment = {
      action,
      agentRole,
      risks,
      totalScore,
      severity,
      allowed: allowed && !requiresApproval,
      requiresApproval,
    };

    // Log to audit trail
    if (this.auditTrail) {
      this.auditTrail.record({
        eventType: "risk_assessment",
        agentRole,
        details: assessment,
        severity,
      });
    }

    if (severity !== "low") {
      logger.info(
        {
          action,
          agentRole,
          severity,
          totalScore: totalScore.toFixed(2),
          allowed: assessment.allowed,
          requiresApproval,
        },
        "Governance assessment"
      );
    }

    return assessment;
  }
}
