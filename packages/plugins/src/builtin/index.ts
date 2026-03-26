/**
 * Built-in plugin definitions for the Prometheus platform.
 *
 * Each plugin declares a manifest and a lifecycle (via PluginSDK).
 * These serve as first-party integrations available in the marketplace.
 */

import type { PluginLifecycle, PluginManifest } from "../types";

// ---------------------------------------------------------------------------
// Built-in plugin definition type
// ---------------------------------------------------------------------------

export interface BuiltinPluginDefinition {
  configSchema: Record<string, unknown>;
  lifecycle: PluginLifecycle;
  manifest: PluginManifest;
  readme: string;
}

// ---------------------------------------------------------------------------
// No-op lifecycle factory
// ---------------------------------------------------------------------------

function createNoopLifecycle(name: string): PluginLifecycle {
  return {
    activate: (ctx) => {
      ctx.logger.info(`${name} plugin activated`);
      return Promise.resolve();
    },
    deactivate: (ctx) => {
      ctx.logger.info(`${name} plugin deactivated`);
      return Promise.resolve();
    },
    healthCheck: () => Promise.resolve(true),
  };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export const GITHUB_PLUGIN: BuiltinPluginDefinition = {
  manifest: {
    id: "plugin-github",
    name: "GitHub",
    version: "2.1.0",
    description:
      "Full GitHub integration: repository management, pull request automation, issue triage, CI/CD workflow triggers, and code review.",
    author: "Prometheus",
    category: "integration",
    icon: "github",
    homepage: "https://docs.prometheus.dev/plugins/github",
    tags: ["github", "git", "vcs", "ci-cd", "pull-requests", "issues"],
    permissions: [
      "network:outbound",
      "mcp:tool:register",
      "events:publish",
      "events:subscribe",
    ],
  },
  configSchema: {
    type: "object",
    properties: {
      githubToken: {
        type: "string",
        description: "GitHub personal access token or app token",
      },
      defaultOrg: {
        type: "string",
        description: "Default GitHub organization",
      },
      autoAssignReviewers: {
        type: "boolean",
        description: "Automatically assign reviewers to PRs",
        default: true,
      },
      webhookSecret: {
        type: "string",
        description: "Webhook secret for verifying GitHub webhooks",
      },
    },
    required: ["githubToken"],
  },
  lifecycle: createNoopLifecycle("GitHub"),
  readme: `# GitHub Integration

Connect your GitHub repositories to Prometheus for seamless development workflows.

## Features
- **Repository Management**: Clone, sync, and manage repos directly from Prometheus
- **Pull Request Automation**: Auto-create PRs from agent sessions, request reviews
- **Issue Triage**: AI-powered issue labeling, assignment, and prioritization
- **CI/CD Triggers**: Trigger GitHub Actions workflows from Prometheus tasks
- **Code Review**: AI-assisted code review with inline comments
- **Webhook Events**: React to push, PR, and issue events in real-time

## Configuration
1. Generate a GitHub personal access token with \`repo\`, \`workflow\`, and \`admin:org\` scopes
2. Enter the token in plugin settings
3. Select your default organization
4. Configure webhook URL in your GitHub repository settings`,
};

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

export const SLACK_PLUGIN: BuiltinPluginDefinition = {
  manifest: {
    id: "plugin-slack",
    name: "Slack",
    version: "1.5.0",
    description:
      "Slack integration: real-time notifications, task updates, team collaboration channels, and slash commands.",
    author: "Prometheus",
    category: "integration",
    icon: "slack",
    homepage: "https://docs.prometheus.dev/plugins/slack",
    tags: ["slack", "messaging", "notifications", "collaboration", "chat"],
    permissions: ["network:outbound", "mcp:tool:register", "events:subscribe"],
  },
  configSchema: {
    type: "object",
    properties: {
      botToken: {
        type: "string",
        description: "Slack Bot OAuth Token (xoxb-...)",
      },
      signingSecret: {
        type: "string",
        description: "Slack app signing secret for webhook verification",
      },
      defaultChannel: {
        type: "string",
        description: "Default channel for notifications",
      },
      notifyOnDeploy: {
        type: "boolean",
        description: "Send notifications on deployments",
        default: true,
      },
      notifyOnError: {
        type: "boolean",
        description: "Send notifications on agent errors",
        default: true,
      },
    },
    required: ["botToken", "signingSecret"],
  },
  lifecycle: createNoopLifecycle("Slack"),
  readme: `# Slack Integration

Keep your team in the loop with real-time Slack notifications and collaboration.

## Features
- **Task Updates**: Get notified when tasks are created, completed, or failed
- **Agent Alerts**: Real-time alerts when agents encounter issues
- **Deploy Notifications**: Automatic deployment status updates
- **Slash Commands**: Run Prometheus commands directly from Slack
- **Thread Replies**: Agent responses posted as thread replies for context

## Configuration
1. Create a Slack App at https://api.slack.com/apps
2. Install the app to your workspace
3. Copy the Bot Token and Signing Secret
4. Select default notification channels`,
};

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

export const JIRA_PLUGIN: BuiltinPluginDefinition = {
  manifest: {
    id: "plugin-jira",
    name: "Jira",
    version: "1.3.0",
    description:
      "Jira integration: bi-directional issue sync, sprint management, workflow automation, and status tracking.",
    author: "Prometheus",
    category: "integration",
    icon: "jira",
    homepage: "https://docs.prometheus.dev/plugins/jira",
    tags: ["jira", "issues", "project-management", "agile", "sprints"],
    permissions: ["network:outbound", "mcp:tool:register", "events:publish"],
  },
  configSchema: {
    type: "object",
    properties: {
      instanceUrl: {
        type: "string",
        description:
          "Jira Cloud instance URL (e.g., https://yourteam.atlassian.net)",
      },
      email: { type: "string", description: "Jira account email" },
      apiToken: { type: "string", description: "Jira API token" },
      defaultProject: {
        type: "string",
        description: "Default Jira project key",
      },
      syncEnabled: {
        type: "boolean",
        description: "Enable bi-directional sync",
        default: true,
      },
    },
    required: ["instanceUrl", "email", "apiToken"],
  },
  lifecycle: createNoopLifecycle("Jira"),
  readme: `# Jira Integration

Synchronize Jira issues with Prometheus tasks for seamless project management.

## Features
- **Bi-directional Sync**: Changes in Jira reflect in Prometheus and vice versa
- **Sprint Management**: View and manage sprints from the Prometheus dashboard
- **Workflow Automation**: Auto-transition Jira issues when agent tasks complete
- **Status Tracking**: Real-time status updates across both platforms
- **Issue Creation**: Create Jira issues from Prometheus sessions

## Configuration
1. Generate an API token at https://id.atlassian.com/manage-profile/security/api-tokens
2. Enter your Jira Cloud instance URL
3. Select the default project for issue sync`,
};

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

export const LINEAR_PLUGIN: BuiltinPluginDefinition = {
  manifest: {
    id: "plugin-linear",
    name: "Linear",
    version: "1.4.0",
    description:
      "Linear integration: issue synchronization, project tracking, cycle management, and automated workflows.",
    author: "Prometheus",
    category: "integration",
    icon: "linear",
    homepage: "https://docs.prometheus.dev/plugins/linear",
    tags: ["linear", "issues", "project-management", "tracking", "cycles"],
    permissions: ["network:outbound", "mcp:tool:register", "events:publish"],
  },
  configSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string", description: "Linear API key" },
      teamId: { type: "string", description: "Default Linear team ID" },
      syncLabels: {
        type: "boolean",
        description: "Sync Linear labels to Prometheus tags",
        default: true,
      },
      autoCreateIssues: {
        type: "boolean",
        description: "Auto-create Linear issues from Prometheus tasks",
        default: false,
      },
    },
    required: ["apiKey"],
  },
  lifecycle: createNoopLifecycle("Linear"),
  readme: `# Linear Integration

Keep Linear issues in sync with Prometheus project tasks.

## Features
- **Issue Sync**: Bi-directional synchronization of issues and tasks
- **Project Tracking**: View Linear project progress in Prometheus
- **Cycle Management**: Align Prometheus sprints with Linear cycles
- **Label Sync**: Automatic label and tag synchronization
- **Webhook Events**: React to Linear events in real-time

## Configuration
1. Generate an API key at https://linear.app/settings/api
2. Select your default team
3. Configure sync preferences`,
};

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------

export const VERCEL_PLUGIN: BuiltinPluginDefinition = {
  manifest: {
    id: "plugin-vercel",
    name: "Vercel",
    version: "1.2.0",
    description:
      "Vercel integration: preview deployments, production releases, environment management, and build monitoring.",
    author: "Prometheus",
    category: "integration",
    icon: "vercel",
    homepage: "https://docs.prometheus.dev/plugins/vercel",
    tags: ["vercel", "deployment", "preview", "hosting", "ci-cd", "serverless"],
    permissions: ["network:outbound", "mcp:tool:register", "events:publish"],
  },
  configSchema: {
    type: "object",
    properties: {
      accessToken: {
        type: "string",
        description: "Vercel access token",
      },
      teamId: { type: "string", description: "Vercel team ID (optional)" },
      projectId: {
        type: "string",
        description: "Default Vercel project ID",
      },
      autoPreview: {
        type: "boolean",
        description: "Auto-create preview deployments for PRs",
        default: true,
      },
    },
    required: ["accessToken"],
  },
  lifecycle: createNoopLifecycle("Vercel"),
  readme: `# Vercel Integration

Deploy your projects to Vercel with one-click preview and production releases.

## Features
- **Preview Deployments**: Automatic preview URLs for every pull request
- **Production Releases**: One-click production deployments from Prometheus
- **Environment Management**: Manage environment variables across environments
- **Build Monitoring**: Track build status and deployment logs
- **Rollback**: Quick rollback to previous deployments

## Configuration
1. Generate an access token at https://vercel.com/account/tokens
2. Select your Vercel team and project
3. Enable auto-preview for pull requests`,
};

// ---------------------------------------------------------------------------
// Sentry
// ---------------------------------------------------------------------------

export const SENTRY_PLUGIN: BuiltinPluginDefinition = {
  manifest: {
    id: "plugin-sentry",
    name: "Sentry",
    version: "1.1.0",
    description:
      "Sentry integration: error tracking, performance monitoring, issue assignment, and AI-powered error resolution.",
    author: "Prometheus",
    category: "integration",
    icon: "sentry",
    homepage: "https://docs.prometheus.dev/plugins/sentry",
    tags: ["sentry", "errors", "monitoring", "performance", "debugging"],
    permissions: ["network:outbound", "mcp:tool:register", "events:subscribe"],
  },
  configSchema: {
    type: "object",
    properties: {
      dsn: { type: "string", description: "Sentry DSN" },
      authToken: { type: "string", description: "Sentry auth token" },
      orgSlug: { type: "string", description: "Sentry organization slug" },
      projectSlug: { type: "string", description: "Sentry project slug" },
      autoAssign: {
        type: "boolean",
        description: "Auto-assign errors to AI agents for resolution",
        default: false,
      },
    },
    required: ["authToken", "orgSlug", "projectSlug"],
  },
  lifecycle: createNoopLifecycle("Sentry"),
  readme: `# Sentry Integration

Surface Sentry errors in context and auto-assign to AI agents for resolution.

## Features
- **Error Tracking**: View Sentry errors directly in Prometheus
- **Performance Monitoring**: Track transaction performance and bottlenecks
- **AI Resolution**: Auto-assign errors to agents for automated fix suggestions
- **Issue Linking**: Link Sentry issues to Prometheus tasks
- **Alert Routing**: Route Sentry alerts to specific teams or channels

## Configuration
1. Generate an auth token at https://sentry.io/settings/account/api/auth-tokens/
2. Enter your organization and project slugs
3. Configure auto-assignment preferences`,
};

// ---------------------------------------------------------------------------
// Datadog
// ---------------------------------------------------------------------------

export const DATADOG_PLUGIN: BuiltinPluginDefinition = {
  manifest: {
    id: "plugin-datadog",
    name: "Datadog",
    version: "1.0.0",
    description:
      "Datadog integration: application monitoring, log aggregation, APM traces, and infrastructure metrics.",
    author: "Prometheus",
    category: "integration",
    icon: "datadog",
    homepage: "https://docs.prometheus.dev/plugins/datadog",
    tags: ["datadog", "monitoring", "apm", "logs", "metrics", "infrastructure"],
    permissions: ["network:outbound", "mcp:tool:register", "events:subscribe"],
  },
  configSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string", description: "Datadog API key" },
      appKey: { type: "string", description: "Datadog application key" },
      site: {
        type: "string",
        description: "Datadog site (e.g., datadoghq.com, datadoghq.eu)",
        default: "datadoghq.com",
      },
      environment: {
        type: "string",
        description: "Default environment to monitor",
        default: "production",
      },
    },
    required: ["apiKey", "appKey"],
  },
  lifecycle: createNoopLifecycle("Datadog"),
  readme: `# Datadog Integration

Stream application metrics, logs, and APM traces from Datadog into Prometheus.

## Features
- **Application Monitoring**: View Datadog dashboards in Prometheus
- **Log Aggregation**: Search and filter logs from the Prometheus interface
- **APM Traces**: Trace request flows and identify bottlenecks
- **Infrastructure Metrics**: Monitor server health and resource usage
- **Alert Forwarding**: Route Datadog alerts to Prometheus notifications

## Configuration
1. Generate API and application keys at https://app.datadoghq.com/organization-settings/api-keys
2. Select your Datadog site region
3. Configure the default environment to monitor`,
};

// ---------------------------------------------------------------------------
// All built-in plugins
// ---------------------------------------------------------------------------

export const BUILTIN_PLUGINS: BuiltinPluginDefinition[] = [
  GITHUB_PLUGIN,
  SLACK_PLUGIN,
  JIRA_PLUGIN,
  LINEAR_PLUGIN,
  VERCEL_PLUGIN,
  SENTRY_PLUGIN,
  DATADOG_PLUGIN,
];

/**
 * Marketplace catalog entry — flat representation for search/display.
 */
export interface MarketplaceCatalogEntry {
  author: string;
  category: string;
  configSchema: Record<string, unknown>;
  description: string;
  downloads: number;
  icon: string;
  id: string;
  name: string;
  rating: number;
  ratingCount: number;
  readme: string;
  tags: string[];
  verified: boolean;
  version: string;
}

/**
 * Convert built-in plugins to marketplace catalog entries with realistic
 * download and rating data.
 */
export function getBuiltinCatalog(): MarketplaceCatalogEntry[] {
  const stats: Record<
    string,
    { downloads: number; rating: number; ratingCount: number }
  > = {
    "plugin-github": { downloads: 14_200, rating: 4.8, ratingCount: 312 },
    "plugin-slack": { downloads: 11_500, rating: 4.6, ratingCount: 248 },
    "plugin-jira": { downloads: 7800, rating: 4.4, ratingCount: 156 },
    "plugin-linear": { downloads: 9100, rating: 4.7, ratingCount: 203 },
    "plugin-vercel": { downloads: 10_300, rating: 4.9, ratingCount: 187 },
    "plugin-sentry": { downloads: 6400, rating: 4.5, ratingCount: 142 },
    "plugin-datadog": { downloads: 4700, rating: 4.3, ratingCount: 98 },
  };

  return BUILTIN_PLUGINS.map((p) => {
    const s = stats[p.manifest.id] ?? {
      downloads: 1000,
      rating: 4.0,
      ratingCount: 50,
    };
    return {
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      category: p.manifest.category,
      icon: p.manifest.icon ?? "puzzle",
      tags: p.manifest.tags ?? [],
      downloads: s.downloads,
      rating: s.rating,
      ratingCount: s.ratingCount,
      verified: true,
      configSchema: p.configSchema,
      readme: p.readme,
    };
  });
}
