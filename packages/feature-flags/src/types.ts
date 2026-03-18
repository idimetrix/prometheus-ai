export interface FlagDefinition {
  /** If set, flag is only enabled for these plan tiers */
  allowedTiers?: string[];
  defaultEnabled: boolean;
  description: string;
  key: string;
  /** If set, enables for this percentage of users (0-100) */
  percentage?: number;
}

export interface FlagContext {
  /** Runtime environment override */
  environment?: "development" | "staging" | "production";
  /** Organization ID */
  orgId?: string;
  /** Explicit overrides for specific flags */
  overrides?: Record<string, boolean>;
  /** Organization's plan tier */
  tier?: string;
  /** User ID for percentage-based rollouts */
  userId?: string;
}

export interface FeatureFlagProvider {
  getAllFlags(): Record<string, FlagDefinition>;
  getEnabledFlags(context?: FlagContext): string[];
  isEnabled(flag: string, context?: FlagContext): boolean;
}
