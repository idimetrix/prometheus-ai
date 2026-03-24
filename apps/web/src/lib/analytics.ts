/**
 * Product Analytics — PostHog integration.
 *
 * Self-hosted or cloud PostHog. Only initializes when
 * NEXT_PUBLIC_POSTHOG_KEY is set. Falls back to logger.debug in dev.
 */

import { logger } from "@/lib/logger";

type EventProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

interface AnalyticsClient {
  capture(event: string, properties?: EventProperties): void;
  group(type: string, id: string, traits?: EventProperties): void;
  identify(userId: string, traits?: EventProperties): void;
  page(name?: string, properties?: EventProperties): void;
  reset(): void;
}

let client: AnalyticsClient | null = null;
let initialized = false;

/**
 * Initialize analytics. Safe to call multiple times.
 */
export async function initAnalytics(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";

  if (!key) {
    // Dev mode — log to console
    client = {
      capture: (event, props) => {
        logger.debug("[analytics]", event, props);
      },
      identify: (userId, traits) => {
        logger.debug("[analytics] identify", userId, traits);
      },
      group: (type, id) => {
        logger.debug("[analytics] group", type, id);
      },
      page: (name) => {
        logger.debug("[analytics] page", name);
      },
      reset: () => {
        /* no-op in dev */
      },
    };
    return;
  }

  try {
    const posthogModule = await import("posthog-js");
    const posthog = posthogModule.default;
    posthog.init(key, {
      api_host: host,
      capture_pageview: false, // We track manually
      capture_pageleave: true,
      persistence: "localStorage+cookie",
      autocapture: false, // Manual tracking only
    });

    client = {
      capture: (event, props) => posthog.capture(event, props),
      identify: (userId, traits) => posthog.identify(userId, traits),
      group: (type, id, traits) => posthog.group(type, id, traits),
      page: (name, props) =>
        posthog.capture("$pageview", { ...props, $current_url: name }),
      reset: () => posthog.reset(),
    };
  } catch {
    // PostHog not available — silently degrade
    client = {
      capture: () => {
        /* no-op */
      },
      identify: () => {
        /* no-op */
      },
      group: () => {
        /* no-op */
      },
      page: () => {
        /* no-op */
      },
      reset: () => {
        /* no-op */
      },
    };
  }
}

// ── Typed Event Helpers ──────────────────────────────────────────

export function trackEvent(event: string, properties?: EventProperties) {
  client?.capture(event, properties);
}

export function identifyUser(userId: string, traits?: EventProperties) {
  client?.identify(userId, traits);
}

export function setOrganization(orgId: string, traits?: EventProperties) {
  client?.group("organization", orgId, traits);
}

export function trackPageView(name?: string) {
  client?.page(name);
}

export function resetAnalytics() {
  client?.reset();
}

// ── Predefined Events ────────────────────────────────────────────

export const analytics = {
  taskSubmitted: (props: {
    mode: string;
    projectId: string;
    estimatedCredits: number;
  }) => trackEvent("task_submitted", props),

  sessionCreated: (props: { mode: string; projectId: string }) =>
    trackEvent("session_created", props),

  planApproved: (props: { sessionId: string; stepCount: number }) =>
    trackEvent("plan_approved", props),

  planRejected: (props: { sessionId: string; reason?: string }) =>
    trackEvent("plan_rejected", props),

  projectCreated: (props: { techStack?: string }) =>
    trackEvent("project_created", props),

  subscriptionCreated: (props: { plan: string }) =>
    trackEvent("subscription_created", props),

  subscriptionUpgraded: (props: { from: string; to: string }) =>
    trackEvent("subscription_upgraded", props),

  creditsPurchased: (props: { amount: number; packId: string }) =>
    trackEvent("credits_purchased", props),

  integrationConnected: (props: { provider: string }) =>
    trackEvent("integration_connected", props),

  agentTookOver: (props: { sessionId: string }) =>
    trackEvent("agent_takeover", props),

  featureUsed: (props: { feature: string }) =>
    trackEvent("feature_used", props),
};
