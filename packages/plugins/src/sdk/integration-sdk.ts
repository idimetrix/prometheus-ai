import { createLogger } from "@prometheus/logger";

const logger = createLogger("plugins:integration-sdk");

// ---------------------------------------------------------------------------
// Integration Types
// ---------------------------------------------------------------------------

interface CIProviderConfig {
  /** Base URL for the CI API */
  apiUrl: string;
  /** Description of this CI provider */
  description: string;
  /** Provider name (e.g., "github-actions", "circleci") */
  name: string;
  /** Supported pipeline trigger types */
  triggers: string[];
}

interface DeployTargetConfig {
  /** Description of this deploy target */
  description: string;
  /** Environment labels (e.g., ["staging", "production"]) */
  environments: string[];
  /** Target name (e.g., "vercel", "aws-ecs") */
  name: string;
  /** Provider-specific settings */
  settings: Record<string, unknown>;
}

interface NotificationChannelConfig {
  /** Channel name (e.g., "slack", "email", "webhook") */
  name: string;
  /** Channel-specific settings (webhook URL, channel ID, etc.) */
  settings: Record<string, unknown>;
  /** Notification severity levels to subscribe to */
  severityLevels: Array<"info" | "warning" | "error" | "critical">;
}

interface CIProvider extends CIProviderConfig {
  triggerBuild: (params: {
    branch: string;
    commit?: string;
    env?: Record<string, string>;
  }) => Promise<{ buildId: string; url: string }>;
}

interface DeployTarget extends DeployTargetConfig {
  deploy: (params: {
    version: string;
    environment: string;
    config?: Record<string, unknown>;
  }) => Promise<{ deploymentId: string; url: string }>;
}

interface NotificationChannel extends NotificationChannelConfig {
  send: (params: {
    title: string;
    message: string;
    severity: "info" | "warning" | "error" | "critical";
    metadata?: Record<string, unknown>;
  }) => Promise<{ delivered: boolean }>;
}

// ---------------------------------------------------------------------------
// Integration SDK
// ---------------------------------------------------------------------------

/**
 * SDK for registering CI/CD providers, deployment targets, and notification
 * channels with the Prometheus platform.
 */
export class IntegrationSDK {
  private readonly ciProviders = new Map<string, CIProvider>();
  private readonly deployTargets = new Map<string, DeployTarget>();
  private readonly notificationChannels = new Map<
    string,
    NotificationChannel
  >();

  /**
   * Register a CI/CD provider.
   */
  registerCIProvider(name: string, config: Omit<CIProvider, "name">): void {
    this.ciProviders.set(name, { ...config, name });
    logger.info({ provider: name }, "CI provider registered");
  }

  /**
   * Register a deployment target.
   */
  registerDeployTarget(name: string, config: Omit<DeployTarget, "name">): void {
    this.deployTargets.set(name, { ...config, name });
    logger.info({ target: name }, "Deploy target registered");
  }

  /**
   * Register a notification channel.
   */
  registerNotificationChannel(
    name: string,
    config: Omit<NotificationChannel, "name">
  ): void {
    this.notificationChannels.set(name, { ...config, name });
    logger.info({ channel: name }, "Notification channel registered");
  }

  /**
   * Get a CI provider by name.
   */
  getCIProvider(name: string): CIProvider | undefined {
    return this.ciProviders.get(name);
  }

  /**
   * Get a deploy target by name.
   */
  getDeployTarget(name: string): DeployTarget | undefined {
    return this.deployTargets.get(name);
  }

  /**
   * Get a notification channel by name.
   */
  getNotificationChannel(name: string): NotificationChannel | undefined {
    return this.notificationChannels.get(name);
  }

  /**
   * List all registered CI providers.
   */
  listCIProviders(): CIProvider[] {
    return Array.from(this.ciProviders.values());
  }

  /**
   * List all registered deploy targets.
   */
  listDeployTargets(): DeployTarget[] {
    return Array.from(this.deployTargets.values());
  }

  /**
   * List all registered notification channels.
   */
  listNotificationChannels(): NotificationChannel[] {
    return Array.from(this.notificationChannels.values());
  }

  /**
   * Trigger a build on a named CI provider.
   */
  triggerBuild(
    providerName: string,
    params: { branch: string; commit?: string; env?: Record<string, string> }
  ): Promise<{ buildId: string; url: string }> {
    const provider = this.ciProviders.get(providerName);
    if (!provider) {
      throw new Error(`CI provider not found: ${providerName}`);
    }
    return provider.triggerBuild(params);
  }

  /**
   * Deploy to a named target.
   */
  deploy(
    targetName: string,
    params: {
      version: string;
      environment: string;
      config?: Record<string, unknown>;
    }
  ): Promise<{ deploymentId: string; url: string }> {
    const target = this.deployTargets.get(targetName);
    if (!target) {
      throw new Error(`Deploy target not found: ${targetName}`);
    }
    return target.deploy(params);
  }

  /**
   * Send a notification via a named channel.
   */
  notify(
    channelName: string,
    params: {
      title: string;
      message: string;
      severity: "info" | "warning" | "error" | "critical";
      metadata?: Record<string, unknown>;
    }
  ): Promise<{ delivered: boolean }> {
    const channel = this.notificationChannels.get(channelName);
    if (!channel) {
      throw new Error(`Notification channel not found: ${channelName}`);
    }
    return channel.send(params);
  }
}

export type {
  CIProvider,
  CIProviderConfig,
  DeployTarget,
  DeployTargetConfig,
  NotificationChannel,
  NotificationChannelConfig,
};
