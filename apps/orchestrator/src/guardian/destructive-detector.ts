/**
 * Destructive Command Detector
 *
 * Detects dangerous shell commands, SQL operations, and file system
 * operations that could cause data loss or security issues. Used by
 * the execution engine to trigger human-in-the-loop approval gates
 * before allowing destructive operations to proceed.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:guardian:destructive-detector");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface DestructiveDetection {
  /** The matched command or pattern */
  command: string;
  /** Human-readable description of the risk */
  description: string;
  /** Whether the operation should be blocked until approved */
  requiresApproval: boolean;
  /** Risk level of the detected command */
  riskLevel: RiskLevel;
  /** Which rule matched */
  rule: string;
}

export interface DetectionResult {
  /** All detections found */
  detections: DestructiveDetection[];
  /** Whether any detection requires approval */
  requiresApproval: boolean;
  /** The highest risk level found */
  riskLevel: RiskLevel;
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface DestructivePattern {
  description: string;
  name: string;
  pattern: RegExp;
  requiresApproval: boolean;
  riskLevel: RiskLevel;
}

const SHELL_PATTERNS: DestructivePattern[] = [
  {
    name: "rm-recursive",
    pattern: /\brm\s+(-rf?|--recursive)\b/,
    riskLevel: "critical",
    requiresApproval: true,
    description: "Recursive file deletion (rm -rf)",
  },
  {
    name: "rm-force",
    pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\b/,
    riskLevel: "high",
    requiresApproval: true,
    description: "Forced file deletion",
  },
  {
    name: "sudo-rm",
    pattern: /\bsudo\s+rm\b/,
    riskLevel: "critical",
    requiresApproval: true,
    description: "Root-level file deletion",
  },
  {
    name: "git-force-push",
    pattern: /\bgit\s+push\s+(--force|-f)\b/,
    riskLevel: "critical",
    requiresApproval: true,
    description: "Force push to remote (rewrites history)",
  },
  {
    name: "git-reset-hard",
    pattern: /\bgit\s+reset\s+--hard\b/,
    riskLevel: "high",
    requiresApproval: true,
    description: "Hard reset discards uncommitted changes",
  },
  {
    name: "git-clean-force",
    pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/,
    riskLevel: "high",
    requiresApproval: true,
    description: "Force-clean untracked files",
  },
  {
    name: "chmod-777",
    pattern: /\bchmod\s+777\b/,
    riskLevel: "high",
    requiresApproval: true,
    description: "Setting world-writable permissions",
  },
  {
    name: "chown-recursive",
    pattern: /\bchown\s+-R\s+/,
    riskLevel: "high",
    requiresApproval: true,
    description: "Recursive ownership change",
  },
  {
    name: "format-drive",
    pattern: /\bformat\s+[cC]:/,
    riskLevel: "critical",
    requiresApproval: true,
    description: "Drive formatting",
  },
  {
    name: "docker-prune",
    pattern: /\bdocker\s+system\s+prune\b/,
    riskLevel: "medium",
    requiresApproval: true,
    description: "Docker system prune removes unused data",
  },
  {
    name: "kubectl-delete",
    pattern: /\bkubectl\s+delete\b/,
    riskLevel: "high",
    requiresApproval: true,
    description: "Kubernetes resource deletion",
  },
  {
    name: "curl-pipe-shell",
    pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/,
    riskLevel: "critical",
    requiresApproval: true,
    description: "Piping remote content to shell execution",
  },
  {
    name: "wget-pipe-shell",
    pattern: /\bwget\s+.*-O\s*-\s*\|\s*(ba)?sh\b/,
    riskLevel: "critical",
    requiresApproval: true,
    description: "Piping remote content to shell execution",
  },
];

const SQL_PATTERNS: DestructivePattern[] = [
  {
    name: "drop-table",
    pattern: /\bDROP\s+TABLE\b/i,
    riskLevel: "critical",
    requiresApproval: true,
    description: "DROP TABLE permanently removes a table and all its data",
  },
  {
    name: "drop-database",
    pattern: /\bDROP\s+DATABASE\b/i,
    riskLevel: "critical",
    requiresApproval: true,
    description: "DROP DATABASE permanently removes the entire database",
  },
  {
    name: "drop-schema",
    pattern: /\bDROP\s+SCHEMA\b/i,
    riskLevel: "critical",
    requiresApproval: true,
    description: "DROP SCHEMA permanently removes a schema",
  },
  {
    name: "truncate",
    pattern: /\bTRUNCATE\s+(TABLE\s+)?\w/i,
    riskLevel: "critical",
    requiresApproval: true,
    description: "TRUNCATE deletes all rows from a table",
  },
  {
    name: "delete-without-where",
    pattern: /\bDELETE\s+FROM\s+\S+\s*(;|\s*$)/i,
    riskLevel: "critical",
    requiresApproval: true,
    description: "DELETE without WHERE clause removes all rows",
  },
  {
    name: "alter-drop-column",
    pattern: /\bALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN\b/i,
    riskLevel: "high",
    requiresApproval: true,
    description: "Dropping a column permanently removes data",
  },
];

const FILE_OPERATION_PATTERNS: DestructivePattern[] = [
  {
    name: "overwrite-env",
    pattern: /\.env(?!\.example|\.template|\.sample)/,
    riskLevel: "high",
    requiresApproval: true,
    description: "Modifying .env file may expose or overwrite secrets",
  },
  {
    name: "modify-ci-config",
    pattern: /\.github\/workflows\/|\.gitlab-ci\.yml|Jenkinsfile/,
    riskLevel: "medium",
    requiresApproval: false,
    description: "Modifying CI/CD configuration",
  },
  {
    name: "modify-dockerfile",
    pattern: /Dockerfile|docker-compose\.ya?ml/,
    riskLevel: "medium",
    requiresApproval: false,
    description: "Modifying container configuration",
  },
];

const ALL_PATTERNS = [
  ...SHELL_PATTERNS,
  ...SQL_PATTERNS,
  ...FILE_OPERATION_PATTERNS,
];

// ---------------------------------------------------------------------------
// Risk level ordering
// ---------------------------------------------------------------------------

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

// ---------------------------------------------------------------------------
// DestructiveDetector
// ---------------------------------------------------------------------------

/**
 * Scans commands and file operations for destructive patterns.
 * Returns structured detection results that the execution engine
 * uses to trigger approval gates.
 */
export class DestructiveDetector {
  private readonly patterns: DestructivePattern[];

  constructor(additionalPatterns?: DestructivePattern[]) {
    this.patterns = [...ALL_PATTERNS, ...(additionalPatterns ?? [])];
  }

  /**
   * Check a shell command for destructive patterns.
   */
  detectCommand(command: string): DetectionResult {
    return this.detect(command, [...SHELL_PATTERNS, ...SQL_PATTERNS]);
  }

  /**
   * Check a file path for risky file operation patterns.
   */
  detectFileOperation(filePath: string): DetectionResult {
    return this.detect(filePath, FILE_OPERATION_PATTERNS);
  }

  /**
   * Check arbitrary text (command + file content) against all patterns.
   */
  detectAll(text: string): DetectionResult {
    return this.detect(text, this.patterns);
  }

  /**
   * Quick boolean check: is the command destructive?
   */
  isDestructive(command: string): boolean {
    return (
      SHELL_PATTERNS.some((p) => p.pattern.test(command)) ||
      SQL_PATTERNS.some((p) => p.pattern.test(command))
    );
  }

  /**
   * Get all registered patterns.
   */
  getPatterns(): DestructivePattern[] {
    return [...this.patterns];
  }

  private detect(
    text: string,
    patterns: DestructivePattern[]
  ): DetectionResult {
    const detections: DestructiveDetection[] = [];
    let highestRisk: RiskLevel = "low";
    let needsApproval = false;

    for (const pattern of patterns) {
      const match = text.match(pattern.pattern);
      if (match) {
        detections.push({
          rule: pattern.name,
          command: match[0],
          riskLevel: pattern.riskLevel,
          requiresApproval: pattern.requiresApproval,
          description: pattern.description,
        });

        highestRisk = maxRiskLevel(highestRisk, pattern.riskLevel);
        if (pattern.requiresApproval) {
          needsApproval = true;
        }
      }
    }

    if (detections.length > 0) {
      logger.warn(
        {
          detectionCount: detections.length,
          riskLevel: highestRisk,
          requiresApproval: needsApproval,
        },
        "Destructive patterns detected"
      );
    }

    return {
      detections,
      riskLevel: highestRisk,
      requiresApproval: needsApproval,
    };
  }
}
