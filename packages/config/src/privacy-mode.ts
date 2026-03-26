import { createLogger } from "@prometheus/logger";

const logger = createLogger("config:privacy-mode");

/**
 * Privacy mode configuration.
 * When enabled, the platform:
 * - Skips all telemetry and analytics collection
 * - Disables persistent storage of conversations and session data
 * - Routes LLM calls directly without logging prompts/responses
 * - Disables embedding generation and code indexing
 * - Skips audit log entries for user actions
 */
export interface PrivacyModeConfig {
  /** Skip audit log entries */
  disableAuditLog: boolean;
  /** Skip code embedding/indexing */
  disableIndexing: boolean;
  /** Skip logging of LLM prompts and responses */
  disablePromptLogging: boolean;
  /** Skip persistent storage of messages and session data */
  disableStorage: boolean;
  /** Skip telemetry events */
  disableTelemetry: boolean;
  /** Master toggle for privacy mode */
  enabled: boolean;
}

const DEFAULT_CONFIG: PrivacyModeConfig = {
  enabled: false,
  disableTelemetry: false,
  disableStorage: false,
  disablePromptLogging: false,
  disableIndexing: false,
  disableAuditLog: false,
};

let currentConfig: PrivacyModeConfig = { ...DEFAULT_CONFIG };

/**
 * Initialize privacy mode from environment variables.
 * Set PROMETHEUS_PRIVACY_MODE=true to enable all privacy features.
 * Individual features can also be toggled independently.
 */
export function initPrivacyMode(): PrivacyModeConfig {
  const envEnabled = process.env.PROMETHEUS_PRIVACY_MODE === "true";

  currentConfig = {
    enabled: envEnabled,
    disableTelemetry:
      envEnabled || process.env.PROMETHEUS_DISABLE_TELEMETRY === "true",
    disableStorage:
      envEnabled || process.env.PROMETHEUS_DISABLE_STORAGE === "true",
    disablePromptLogging:
      envEnabled || process.env.PROMETHEUS_DISABLE_PROMPT_LOGGING === "true",
    disableIndexing:
      envEnabled || process.env.PROMETHEUS_DISABLE_INDEXING === "true",
    disableAuditLog:
      envEnabled || process.env.PROMETHEUS_DISABLE_AUDIT_LOG === "true",
  };

  if (currentConfig.enabled) {
    logger.info(
      "Privacy mode enabled: all storage, logging, and telemetry disabled"
    );
  }

  return currentConfig;
}

/** Get the current privacy mode configuration. */
export function getPrivacyConfig(): Readonly<PrivacyModeConfig> {
  return currentConfig;
}

/** Check if privacy mode is globally enabled. */
export function isPrivacyMode(): boolean {
  return currentConfig.enabled;
}

/** Check if telemetry should be skipped. */
export function shouldSkipTelemetry(): boolean {
  return currentConfig.disableTelemetry;
}

/** Check if persistent storage should be skipped. */
export function shouldSkipStorage(): boolean {
  return currentConfig.disableStorage;
}

/** Check if prompt/response logging should be skipped. */
export function shouldSkipPromptLogging(): boolean {
  return currentConfig.disablePromptLogging;
}

/** Check if code indexing should be skipped. */
export function shouldSkipIndexing(): boolean {
  return currentConfig.disableIndexing;
}

/** Check if audit logging should be skipped. */
export function shouldSkipAuditLog(): boolean {
  return currentConfig.disableAuditLog;
}

/**
 * Programmatically update privacy mode settings.
 * Primarily used for testing or per-session overrides.
 */
export function setPrivacyConfig(
  overrides: Partial<PrivacyModeConfig>
): PrivacyModeConfig {
  currentConfig = { ...currentConfig, ...overrides };

  // If master toggle is turned on, enable all sub-features
  if (overrides.enabled === true) {
    currentConfig.disableTelemetry = true;
    currentConfig.disableStorage = true;
    currentConfig.disablePromptLogging = true;
    currentConfig.disableIndexing = true;
    currentConfig.disableAuditLog = true;
  }

  logger.info(
    { privacyMode: currentConfig.enabled },
    "Privacy mode configuration updated"
  );
  return currentConfig;
}

/** Reset privacy mode to defaults. */
export function resetPrivacyConfig(): void {
  currentConfig = { ...DEFAULT_CONFIG };
}
