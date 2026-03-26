/**
 * Slack App Manifest
 *
 * Defines the Slack App configuration for Prometheus AI.
 * This manifest can be used with `https://api.slack.com/apps` to create
 * or update the Slack App programmatically.
 *
 * @see https://api.slack.com/reference/manifests
 */

export interface SlackManifest {
  _metadata: { major_version: number; minor_version: number };
  display_information: {
    background_color?: string;
    description?: string;
    long_description?: string;
    name: string;
  };
  features: {
    bot_user: { always_online: boolean; display_name: string };
    shortcuts: Array<{
      callback_id: string;
      description: string;
      name: string;
      type: string;
    }>;
    slash_commands: Array<{
      command: string;
      description: string;
      should_escape: boolean;
      url: string;
    }>;
  };
  oauth_config: {
    redirect_urls: string[];
    scopes: {
      bot: string[];
    };
  };
  settings: {
    event_subscriptions: {
      bot_events: string[];
      request_url: string;
    };
    interactivity: {
      is_enabled: boolean;
      request_url: string;
    };
    org_deploy_enabled: boolean;
    socket_mode_enabled: boolean;
    token_rotation_enabled: boolean;
  };
}

/**
 * Generate the Slack App manifest for a given API base URL.
 */
export function generateSlackManifest(apiBaseUrl: string): SlackManifest {
  return {
    _metadata: {
      major_version: 2,
      minor_version: 0,
    },
    display_information: {
      name: "Prometheus AI",
      description: "AI-powered engineering platform with specialist agents",
      long_description:
        "Prometheus AI is an AI-powered engineering platform with 12 specialist agents. Submit tasks via Slack commands, mentions, or message shortcuts. Get real-time progress updates in threads and approve or reject agent actions with interactive buttons.",
      background_color: "#1a1a2e",
    },
    features: {
      bot_user: {
        display_name: "Prometheus",
        always_online: true,
      },
      slash_commands: [
        {
          command: "/prometheus",
          description: "Submit a task to Prometheus AI",
          url: `${apiBaseUrl}/webhooks/slack/commands`,
          should_escape: false,
        },
      ],
      shortcuts: [
        {
          name: "Send to Prometheus",
          type: "message",
          callback_id: "create_task_from_message",
          description: "Create a Prometheus task from this message",
        },
      ],
    },
    oauth_config: {
      scopes: {
        bot: [
          "chat:write",
          "commands",
          "app_mentions:read",
          "channels:read",
          "groups:read",
          "im:read",
          "im:write",
          "im:history",
          "files:read",
          "reactions:write",
          "users:read",
        ],
      },
      redirect_urls: [`${apiBaseUrl}/oauth/slack/callback`],
    },
    settings: {
      event_subscriptions: {
        request_url: `${apiBaseUrl}/webhooks/slack/events`,
        bot_events: [
          "app_mention",
          "message.im",
          "file_shared",
          "message.channels",
        ],
      },
      interactivity: {
        is_enabled: true,
        request_url: `${apiBaseUrl}/webhooks/slack/interactions`,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/**
 * Export the manifest as a JSON-serializable object.
 */
export function getSlackManifestJSON(apiBaseUrl?: string): SlackManifest {
  const baseUrl =
    apiBaseUrl ?? process.env.API_BASE_URL ?? "https://api.prometheus.dev";
  return generateSlackManifest(baseUrl);
}
