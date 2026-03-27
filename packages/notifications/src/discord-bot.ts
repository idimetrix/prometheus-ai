import { createLogger } from "@prometheus/logger";

const logger = createLogger("notifications:discord");

export interface DiscordConfig {
  botToken: string;
  defaultChannelId?: string;
  guildId?: string;
}

export interface DiscordMessage {
  channelId: string;
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
  }>;
}

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Discord bot integration for Prometheus notifications.
 * Supports sending messages, embeds, and handling slash command interactions.
 */
function getTaskStatusColor(status: string): number {
  if (status === "completed") {
    return 0x00_ff_00;
  }
  if (status === "failed") {
    return 0xff_00_00;
  }
  return 0xff_aa_00;
}

export class DiscordBot {
  private readonly config: DiscordConfig;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  async sendMessage(message: DiscordMessage): Promise<boolean> {
    try {
      const resp = await fetch(
        `${DISCORD_API}/channels/${message.channelId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${this.config.botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: message.content,
            embeds: message.embeds,
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!resp.ok) {
        logger.error(
          { status: resp.status, channelId: message.channelId },
          "Discord message send failed"
        );
        return false;
      }
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Discord send error");
      return false;
    }
  }

  async sendTaskNotification(
    channelId: string,
    task: { title: string; status: string; projectName: string; url?: string }
  ): Promise<boolean> {
    const color = getTaskStatusColor(task.status);
    return await this.sendMessage({
      channelId,
      embeds: [
        {
          title: `Task ${task.status}: ${task.title}`,
          description: `Project: **${task.projectName}**`,
          color,
          fields: task.url ? [{ name: "Link", value: task.url }] : [],
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  async sendPRNotification(
    channelId: string,
    pr: { title: string; url: string; projectName: string; action: string }
  ): Promise<boolean> {
    return await this.sendMessage({
      channelId,
      embeds: [
        {
          title: `PR ${pr.action}: ${pr.title}`,
          description: `Project: **${pr.projectName}**\n[View PR](${pr.url})`,
          color: 0x58_65_f2,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  async sendDeployNotification(
    channelId: string,
    deploy: {
      environment: string;
      version: string;
      status: string;
      projectName: string;
    }
  ): Promise<boolean> {
    const color = deploy.status === "succeeded" ? 0x00_ff_00 : 0xff_00_00;
    return await this.sendMessage({
      channelId,
      embeds: [
        {
          title: `Deployment ${deploy.status}`,
          description: `Project: **${deploy.projectName}**`,
          color,
          fields: [
            { name: "Environment", value: deploy.environment, inline: true },
            { name: "Version", value: deploy.version, inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  /**
   * Register slash commands with Discord.
   */
  async registerCommands(applicationId: string): Promise<boolean> {
    const commands = [
      {
        name: "prometheus-task",
        description: "Create a new Prometheus task",
        options: [
          {
            name: "description",
            description: "Task description",
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: "prometheus-status",
        description: "Check Prometheus platform status",
      },
      {
        name: "prometheus-sessions",
        description: "List active agent sessions",
      },
    ];

    try {
      const resp = await fetch(
        `${DISCORD_API}/applications/${applicationId}/commands`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bot ${this.config.botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(commands),
          signal: AbortSignal.timeout(10_000),
        }
      );
      return resp.ok;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Discord command registration failed");
      return false;
    }
  }
}
