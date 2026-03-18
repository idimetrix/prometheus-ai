export { DEFAULT_FLAGS } from "./flags";
export type { FeatureFlagProvider, FlagContext, FlagDefinition } from "./types";

import { DEFAULT_FLAGS } from "./flags";
import type { FeatureFlagProvider, FlagContext, FlagDefinition } from "./types";

/**
 * Simple hash function for deterministic percentage-based rollouts.
 * Given the same userId + flagKey, always returns the same value 0-99.
 */
function hashForRollout(userId: string, flagKey: string): number {
  const str = `${userId}:${flagKey}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional bit manipulation for hash function
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * Create a feature flag provider with optional custom flag definitions.
 */
export function createFeatureFlags(
  customFlags?: Record<string, FlagDefinition>
): FeatureFlagProvider {
  const flags: Record<string, FlagDefinition> = {
    ...DEFAULT_FLAGS,
    ...customFlags,
  };

  function isEnabled(flag: string, context?: FlagContext): boolean {
    // Check explicit overrides first
    if (context?.overrides?.[flag] !== undefined) {
      return context.overrides[flag];
    }

    // In development, all flags are enabled unless explicitly overridden
    if (context?.environment === "development") {
      const def = flags[flag];
      if (!def) {
        return false;
      }
      // Still respect explicit overrides
      return context?.overrides?.[flag] ?? true;
    }

    const definition = flags[flag];
    if (!definition) {
      return false;
    }

    // Check tier restrictions
    if (
      definition.allowedTiers &&
      definition.allowedTiers.length > 0 &&
      !(context?.tier && definition.allowedTiers.includes(context.tier))
    ) {
      return false;
    }

    // Check percentage rollout
    if (definition.percentage !== undefined && definition.percentage < 100) {
      if (!context?.userId) {
        return false;
      }
      const rolloutValue = hashForRollout(context.userId, flag);
      return rolloutValue < definition.percentage;
    }

    return definition.defaultEnabled;
  }

  function getAllFlags(): Record<string, FlagDefinition> {
    return { ...flags };
  }

  function getEnabledFlags(context?: FlagContext): string[] {
    return Object.keys(flags).filter((key) => isEnabled(key, context));
  }

  return { isEnabled, getAllFlags, getEnabledFlags };
}

/**
 * Singleton instance using default flags.
 * For most use cases, import and use this directly:
 *
 *   import { featureFlags } from "@prometheus/feature-flags";
 *   if (featureFlags.isEnabled("agent.fleet-mode", { tier: "pro" })) { ... }
 */
export const featureFlags = createFeatureFlags();

/**
 * Convenience function using the default provider.
 *
 *   import { isEnabled } from "@prometheus/feature-flags";
 *   if (isEnabled("ui.command-palette")) { ... }
 */
export function isEnabled(flag: string, context?: FlagContext): boolean {
  return featureFlags.isEnabled(flag, context);
}
