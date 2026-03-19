/**
 * Rules for determining what constitutes a "significant output"
 * that should be evaluated by the quality gate.
 */

export interface QualityGateThresholds {
  /** Minimum score for architecture decisions */
  architectureDecision: number;
  /** Minimum score for deployment config changes */
  deployConfig: number;
  /** Minimum score for file writes >20 lines */
  fileWrite: number;
  /** Minimum score for security-related changes */
  securityChange: number;
}

export const DEFAULT_THRESHOLDS: QualityGateThresholds = {
  fileWrite: 0.7,
  architectureDecision: 0.8,
  securityChange: 0.85,
  deployConfig: 0.9,
};

/** File patterns that bypass quality gate review */
const BYPASS_PATTERNS = [
  /\/__tests__\//,
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /\.(md|txt|json)$/,
  /\.d\.ts$/,
];

/** File patterns indicating security-sensitive changes */
const SECURITY_PATTERNS = [
  /auth/i,
  /security/i,
  /middleware/i,
  /permission/i,
  /rbac/i,
  /rls/i,
  /encrypt/i,
  /secret/i,
  /token/i,
  /session/i,
];

/** File patterns indicating deployment config */
const DEPLOY_PATTERNS = [
  /Dockerfile/i,
  /docker-compose/i,
  /\.ya?ml$/,
  /k8s\//,
  /infra\//,
  /\.env/,
  /nginx/i,
  /traefik/i,
];

/** File patterns indicating architecture decisions */
const ARCHITECTURE_PATTERNS = [
  /schema/i,
  /migration/i,
  /blueprint/i,
  /\.proto$/,
  /openapi/i,
  /swagger/i,
];

export function shouldBypassQualityGate(filePath: string): boolean {
  return BYPASS_PATTERNS.some((p) => p.test(filePath));
}

export function getThresholdForFile(
  filePath: string,
  thresholds: QualityGateThresholds = DEFAULT_THRESHOLDS
): number {
  if (DEPLOY_PATTERNS.some((p) => p.test(filePath))) {
    return thresholds.deployConfig;
  }
  if (SECURITY_PATTERNS.some((p) => p.test(filePath))) {
    return thresholds.securityChange;
  }
  if (ARCHITECTURE_PATTERNS.some((p) => p.test(filePath))) {
    return thresholds.architectureDecision;
  }
  return thresholds.fileWrite;
}

export function isSignificantOutput(
  toolName: string,
  args: Record<string, unknown>
): boolean {
  if (toolName !== "file_write" && toolName !== "file_edit") {
    return false;
  }

  const filePath = (args.path as string) ?? (args.filePath as string) ?? "";
  if (shouldBypassQualityGate(filePath)) {
    return false;
  }

  const content = (args.content as string) ?? "";
  const lineCount = content.split("\n").length;

  return lineCount > 20;
}
