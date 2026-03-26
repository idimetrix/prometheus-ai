import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";

const logger = createLogger("api:github-app");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubAppManifest {
  callback_urls: string[];
  default_events: string[];
  default_permissions: Record<string, "read" | "write">;
  description: string;
  hook_attributes: {
    url: string;
    active: boolean;
  };
  name: string;
  public: boolean;
  redirect_url: string;
  setup_url?: string;
  url: string;
}

interface PricingTier {
  description: string;
  features: string[];
  monthlyPrice: number;
  name: string;
  recommended?: boolean;
}

// ---------------------------------------------------------------------------
// App Configuration
// ---------------------------------------------------------------------------

const APP_BASE_URL = process.env.APP_URL ?? "https://prometheus.dev";

const GITHUB_APP_MANIFEST: GitHubAppManifest = {
  name: "Prometheus AI",
  url: APP_BASE_URL,
  description:
    "AI-powered engineering platform with 12 specialist agents. Automate code reviews, issue triage, PR creation, deployments, and more.",
  hook_attributes: {
    url: `${APP_BASE_URL}/api/webhooks/github`,
    active: true,
  },
  redirect_url: `${APP_BASE_URL}/api/auth/github/callback`,
  setup_url: `${APP_BASE_URL}/settings/integrations/github`,
  callback_urls: [`${APP_BASE_URL}/api/auth/github/callback`],
  public: true,
  default_permissions: {
    contents: "write",
    issues: "write",
    pull_requests: "write",
    checks: "write",
    statuses: "write",
    actions: "read",
    metadata: "read",
    members: "read",
    workflows: "write",
  },
  default_events: [
    "check_run",
    "check_suite",
    "issues",
    "issue_comment",
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
    "push",
    "release",
    "workflow_run",
    "installation",
    "installation_repositories",
  ],
};

const PRICING_TIERS: PricingTier[] = [
  {
    name: "Free",
    description: "For individual developers and open source projects.",
    monthlyPrice: 0,
    features: [
      "Up to 3 projects",
      "100 AI agent minutes/month",
      "GitHub issue sync",
      "Basic code review",
      "Community support",
    ],
  },
  {
    name: "Team",
    description: "For growing teams that need more power.",
    monthlyPrice: 29,
    recommended: true,
    features: [
      "Unlimited projects",
      "2,000 AI agent minutes/month",
      "Advanced code review with suggestions",
      "PR auto-creation",
      "Deployment automation",
      "Slack/Linear integrations",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    description:
      "For organizations with advanced security and compliance needs.",
    monthlyPrice: 99,
    features: [
      "Everything in Team",
      "Unlimited AI agent minutes",
      "SSO/SAML authentication",
      "Audit logging",
      "IP allowlisting",
      "Custom model routing",
      "Dedicated support",
      "SLA guarantee",
    ],
  },
];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const githubAppListing = new Hono();

/**
 * GET /github-app/manifest
 *
 * Returns the GitHub App manifest for app registration via
 * the "Create GitHub App from Manifest" flow.
 */
githubAppListing.get("/manifest", (c) => {
  logger.info("GitHub App manifest requested");
  return c.json(GITHUB_APP_MANIFEST);
});

/**
 * GET /github-app/listing
 *
 * Returns the full marketplace listing information including
 * description, features, and pricing tiers.
 */
githubAppListing.get("/listing", (c) => {
  return c.json({
    app: {
      name: GITHUB_APP_MANIFEST.name,
      slug: "prometheus-ai",
      description: GITHUB_APP_MANIFEST.description,
      url: GITHUB_APP_MANIFEST.url,
      logoUrl: `${APP_BASE_URL}/images/logo.png`,
      categories: [
        "Code review",
        "Continuous integration",
        "Project management",
        "AI & Machine Learning",
      ],
      supportUrl: `${APP_BASE_URL}/support`,
      documentationUrl: `${APP_BASE_URL}/docs`,
      privacyPolicyUrl: `${APP_BASE_URL}/privacy`,
      termsOfServiceUrl: `${APP_BASE_URL}/terms`,
    },
    features: [
      {
        title: "AI-Powered Code Review",
        description:
          "Get intelligent code review feedback from 12 specialist AI agents that understand your codebase.",
      },
      {
        title: "Automated Issue Triage",
        description:
          "AI agents automatically categorize, prioritize, and assign issues based on codebase analysis.",
      },
      {
        title: "PR Auto-Creation",
        description:
          "Describe what you need in natural language, and AI agents create the pull request for you.",
      },
      {
        title: "Deployment Automation",
        description:
          "Trigger and monitor deployments with AI-assisted rollback and health checking.",
      },
      {
        title: "Multi-Agent Fleet",
        description:
          "12 specialist agents working in parallel across architecture, testing, security, and more.",
      },
    ],
    permissions: {
      summary:
        "Prometheus needs repository access to analyze code, create PRs, and manage issues.",
      details: Object.entries(GITHUB_APP_MANIFEST.default_permissions).map(
        ([resource, level]) => ({
          resource,
          level,
          reason: getPermissionReason(resource),
        })
      ),
    },
    events: {
      summary:
        "Prometheus subscribes to repository events to trigger AI workflows.",
      subscribed: GITHUB_APP_MANIFEST.default_events,
    },
    pricing: PRICING_TIERS,
    installation: {
      steps: [
        "Click 'Install' to add Prometheus to your GitHub organization",
        "Select the repositories you want Prometheus to access",
        "Connect your Prometheus account in the setup wizard",
        "Configure AI agent preferences and notification channels",
      ],
      setupUrl: GITHUB_APP_MANIFEST.setup_url,
    },
  });
});

/**
 * GET /github-app/pricing
 *
 * Returns pricing tiers for the marketplace listing.
 */
githubAppListing.get("/pricing", (c) => {
  return c.json({ tiers: PRICING_TIERS });
});

/**
 * POST /github-app/install
 *
 * Handle GitHub App installation callback.
 * GitHub redirects here after the user installs the app.
 */
githubAppListing.post("/install", async (c) => {
  const body = await c.req.json<{
    installation_id?: number;
    setup_action?: string;
  }>();

  logger.info(
    {
      installationId: body.installation_id,
      setupAction: body.setup_action,
    },
    "GitHub App installation received"
  );

  return c.json({
    success: true,
    installationId: body.installation_id,
    message: "GitHub App installed successfully. Complete setup in Prometheus.",
    setupUrl: `${APP_BASE_URL}/settings/integrations/github?installation_id=${body.installation_id}`,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPermissionReason(resource: string): string {
  const reasons: Record<string, string> = {
    contents:
      "Read and write repository files for code analysis and PR creation.",
    issues: "Create, update, and triage issues automatically.",
    pull_requests: "Create and manage pull requests from AI agents.",
    checks: "Report code quality and test results on pull requests.",
    statuses: "Update commit statuses for CI/CD integration.",
    actions: "Read workflow runs to monitor CI/CD pipelines.",
    metadata: "Access basic repository information.",
    members: "Read organization membership for team assignments.",
    workflows: "Trigger and manage GitHub Actions workflows.",
  };

  return reasons[resource] ?? "Required for Prometheus integration.";
}

export { githubAppListing };
