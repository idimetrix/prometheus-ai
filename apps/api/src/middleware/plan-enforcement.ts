import {
  checkQuota,
  getQuotasForPlan,
  isFeatureAvailable,
  PLAN_RANK,
  type PlanQuotas,
  type PlanSlug,
} from "@prometheus/billing";
import { createLogger } from "@prometheus/logger";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:plan-enforcement");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuotaMetric = keyof Omit<PlanQuotas, "features">;
type FeatureFlag = keyof PlanQuotas["features"];

interface PlanViolation {
  current: number;
  limit: number;
  metric: string;
  upgradeUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function upgradeUrl(orgId: string): string {
  return `${APP_URL}/settings/billing?org=${orgId}&action=upgrade`;
}

/**
 * Determine the minimum plan required for a given feature flag.
 */
function minimumPlanForFeature(feature: FeatureFlag): PlanSlug {
  for (const slug of PLAN_RANK) {
    if (isFeatureAvailable(slug, feature)) {
      return slug;
    }
  }
  return "enterprise";
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface PlanEnforcementOptions {
  /**
   * A function that returns the current usage value for the given metric.
   * Called within the middleware to get live usage numbers.
   */
  getUsage?: (
    c: Context,
    orgId: string,
    metric: QuotaMetric
  ) => Promise<number>;

  /**
   * Quota metrics to enforce. For each metric the middleware will call
   * `getUsage` and compare against the plan limit.
   */
  quotaMetrics?: QuotaMetric[];

  /**
   * Optional feature flags to require. The request is rejected if the
   * org's plan does not include any of these features.
   * Example: `["fleetMode"]` means the endpoint requires pro+ plan.
   */
  requiredFeatures?: FeatureFlag[];
}

/**
 * Plan enforcement middleware that checks plan quotas and feature flags.
 *
 * Expects `c.get("orgId")` and `c.get("planTier")` to be set by
 * upstream auth / org-context middleware.
 *
 * Returns 402 Payment Required with an upgrade URL when the org exceeds
 * their plan limits.
 */
export function planEnforcementMiddleware(
  options: PlanEnforcementOptions = {}
): MiddlewareHandler {
  const { requiredFeatures = [], quotaMetrics = [], getUsage } = options;

  return async (c: Context, next) => {
    const orgId = c.get("orgId") as string | undefined;
    const planTier = (c.get("planTier") as PlanSlug | undefined) ?? "hobby";

    // No org context — skip enforcement (public endpoints, health, etc.)
    if (!orgId) {
      await next();
      return;
    }

    // ------------------------------------------------------------------
    // Feature flag checks
    // ------------------------------------------------------------------
    for (const feature of requiredFeatures) {
      if (!isFeatureAvailable(planTier, feature)) {
        const minPlan = minimumPlanForFeature(feature);
        logger.warn(
          { orgId, planTier, feature, minPlan },
          "Feature not available on current plan"
        );
        return c.json(
          {
            error: "Plan upgrade required",
            message: `The "${feature}" feature requires a ${minPlan} plan or higher.`,
            requiredPlan: minPlan,
            upgradeUrl: upgradeUrl(orgId),
          },
          402
        );
      }
    }

    // ------------------------------------------------------------------
    // Quota metric checks
    // ------------------------------------------------------------------
    if (quotaMetrics.length > 0 && getUsage) {
      const _quotas = getQuotasForPlan(planTier);
      const violations: PlanViolation[] = [];

      for (const metric of quotaMetrics) {
        const currentValue = await getUsage(c, orgId, metric);
        const result = checkQuota(planTier, metric, currentValue);

        if (!result.allowed) {
          violations.push({
            metric,
            current: result.current,
            limit: result.limit,
            upgradeUrl: upgradeUrl(orgId),
          });
        }
      }

      if (violations.length > 0) {
        const first = violations[0] as PlanViolation;
        logger.warn({ orgId, planTier, violations }, "Plan quota exceeded");
        return c.json(
          {
            error: "Plan limit exceeded",
            message: `You have reached the ${first.metric} limit for your ${planTier} plan (${first.current}/${first.limit}).`,
            violations,
            upgradeUrl: upgradeUrl(orgId),
          },
          402
        );
      }
    }

    await next();
  };
}
