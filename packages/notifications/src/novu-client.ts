import { createLogger } from "@prometheus/logger";

const logger = createLogger("notifications:novu");

interface NovuClientConfig {
  apiKey: string;
  baseUrl: string;
}

export class NovuClient {
  private readonly config: NovuClientConfig | null;

  constructor() {
    const apiKey = process.env.NOVU_API_KEY;
    const baseUrl = process.env.NOVU_URL ?? "https://api.novu.co";

    if (!apiKey) {
      logger.warn("NOVU_API_KEY not set — notifications will be skipped");
      this.config = null;
      return;
    }

    this.config = { apiKey, baseUrl };
  }

  async send(
    subscriberId: string,
    templateId: string,
    payload: Record<string, string>
  ): Promise<void> {
    if (!this.config) {
      logger.debug({ subscriberId, templateId }, "Skipping send — no API key");
      return;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/events/trigger`, {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: templateId,
        to: { subscriberId },
        payload,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "unknown");
      logger.error(
        { subscriberId, templateId, status: response.status, body },
        "Failed to send Novu notification"
      );
    }
  }

  async createSubscriber(
    userId: string,
    email: string,
    name?: string
  ): Promise<void> {
    if (!this.config) {
      logger.debug({ userId }, "Skipping createSubscriber — no API key");
      return;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/subscribers`, {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subscriberId: userId,
        email,
        firstName: name,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "unknown");
      logger.error(
        { userId, status: response.status, body },
        "Failed to create Novu subscriber"
      );
    }
  }

  async sendInApp(
    subscriberId: string,
    title: string,
    body: string
  ): Promise<void> {
    if (!this.config) {
      logger.debug({ subscriberId }, "Skipping sendInApp — no API key");
      return;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/events/trigger`, {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "in-app-notification",
        to: { subscriberId },
        payload: { title, body },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown");
      logger.error(
        { subscriberId, status: response.status, body: text },
        "Failed to send in-app notification"
      );
    }
  }
}
