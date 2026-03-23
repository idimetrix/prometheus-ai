import { createHmac, timingSafeEqual } from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("utils:webhook-delivery");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookEndpoint {
  /** Whether the endpoint is active */
  active: boolean;
  /** Optional description */
  description?: string;
  /** Event types this endpoint is subscribed to (empty = all) */
  events: string[];
  /** Unique identifier for this endpoint */
  id: string;
  /** HMAC-SHA256 signing secret for this endpoint */
  secret: string;
  /** The URL to deliver webhooks to */
  url: string;
}

export interface WebhookDeliveryResult {
  /** Number of attempts made */
  attempt: number;
  /** Timestamp of the delivery attempt */
  deliveredAt: Date;
  /** Unique delivery ID */
  deliveryId: string;
  /** Time taken in milliseconds */
  durationMs: number;
  /** The endpoint the webhook was delivered to */
  endpointId: string;
  /** Error message if failed */
  error?: string;
  /** The event type */
  eventType: string;
  /** Response body snippet (first 512 chars) */
  responseBody: string;
  /** HTTP status code from the endpoint (0 if network error) */
  statusCode: number;
  /** Whether delivery succeeded */
  success: boolean;
}

export interface WebhookEvent {
  /** Event payload */
  data: Record<string, unknown>;
  /** Unique event ID */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Event type (e.g., "task.completed", "session.created") */
  type: string;
}

export interface WebhookDeliveryConfig {
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Initial retry delay in milliseconds (default: 1000) */
  initialRetryDelayMs?: number;
  /** Maximum number of retry attempts (default: 5) */
  maxRetries?: number;
  /** Maximum retry delay in milliseconds (default: 60000) */
  maxRetryDelayMs?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** User-Agent header value */
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// Webhook Signing
// ---------------------------------------------------------------------------

const SIGNATURE_HEADER = "X-Webhook-Signature-256";
const TIMESTAMP_HEADER = "X-Webhook-Timestamp";
const EVENT_HEADER = "X-Webhook-Event";
const DELIVERY_HEADER = "X-Webhook-Delivery";

/**
 * Sign a webhook payload using HMAC-SHA256.
 *
 * The signature covers: timestamp + "." + payload body.
 * This prevents replay attacks when combined with timestamp validation.
 */
export function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp: number
): string {
  const signatureInput = `${timestamp}.${payload}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(signatureInput);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verify a webhook signature.
 *
 * @param payload - The raw request body
 * @param signature - The signature from the X-Webhook-Signature-256 header
 * @param secret - The endpoint's signing secret
 * @param timestamp - The timestamp from the X-Webhook-Timestamp header
 * @param toleranceSec - Maximum allowed clock skew in seconds (default: 300)
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp: number,
  toleranceSec = 300
): boolean {
  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSec) {
    return false;
  }

  const expected = signWebhookPayload(payload, secret, timestamp);

  // Constant-time comparison
  if (expected.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ---------------------------------------------------------------------------
// Webhook Delivery Service
// ---------------------------------------------------------------------------

/**
 * Webhook delivery service with retry, signing, and delivery logging.
 *
 * Usage:
 *   const service = new WebhookDeliveryService();
 *   service.registerEndpoint({ id: "ep_1", url: "https://...", secret: "...", events: ["task.completed"], active: true });
 *   const results = await service.deliver({ id: "evt_1", type: "task.completed", timestamp: new Date().toISOString(), data: { ... } });
 */
export class WebhookDeliveryService {
  private readonly endpoints = new Map<string, WebhookEndpoint>();
  private readonly deliveryLog: WebhookDeliveryResult[] = [];
  private readonly config: Required<WebhookDeliveryConfig>;

  constructor(config: WebhookDeliveryConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 5,
      initialRetryDelayMs: config.initialRetryDelayMs ?? 1000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 60_000,
      timeoutMs: config.timeoutMs ?? 30_000,
      userAgent: config.userAgent ?? "Prometheus-Webhook/1.0",
    };
  }

  // -------------------------------------------------------------------------
  // Endpoint management
  // -------------------------------------------------------------------------

  registerEndpoint(endpoint: WebhookEndpoint): void {
    this.endpoints.set(endpoint.id, endpoint);
    logger.info(
      { endpointId: endpoint.id, url: endpoint.url, events: endpoint.events },
      "Webhook endpoint registered"
    );
  }

  removeEndpoint(endpointId: string): boolean {
    const removed = this.endpoints.delete(endpointId);
    if (removed) {
      logger.info({ endpointId }, "Webhook endpoint removed");
    }
    return removed;
  }

  getEndpoint(endpointId: string): WebhookEndpoint | undefined {
    return this.endpoints.get(endpointId);
  }

  listEndpoints(): WebhookEndpoint[] {
    return [...this.endpoints.values()];
  }

  updateEndpoint(
    endpointId: string,
    updates: Partial<Omit<WebhookEndpoint, "id">>
  ): boolean {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      return false;
    }
    this.endpoints.set(endpointId, { ...endpoint, ...updates });
    logger.info({ endpointId }, "Webhook endpoint updated");
    return true;
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  /**
   * Deliver a webhook event to all matching endpoints.
   *
   * Endpoints match if they are active and either subscribe to no specific
   * events (wildcard) or include the event type in their events list.
   */
  async deliver(event: WebhookEvent): Promise<WebhookDeliveryResult[]> {
    const matchingEndpoints = [...this.endpoints.values()].filter(
      (ep) =>
        ep.active && (ep.events.length === 0 || ep.events.includes(event.type))
    );

    if (matchingEndpoints.length === 0) {
      logger.debug(
        { eventType: event.type },
        "No matching endpoints for webhook event"
      );
      return [];
    }

    const results = await Promise.allSettled(
      matchingEndpoints.map((ep) => this.deliverToEndpoint(event, ep))
    );

    return results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : {
            deliveryId: `dlv_err_${Date.now()}`,
            endpointId: "unknown",
            eventType: event.type,
            success: false,
            statusCode: 0,
            responseBody: "",
            durationMs: 0,
            attempt: 0,
            error:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
            deliveredAt: new Date(),
          }
    );
  }

  /**
   * Get delivery logs, optionally filtered by endpoint or event type.
   */
  getDeliveryLog(filters?: {
    endpointId?: string;
    eventType?: string;
    limit?: number;
  }): WebhookDeliveryResult[] {
    let results = [...this.deliveryLog];

    if (filters?.endpointId) {
      results = results.filter((r) => r.endpointId === filters.endpointId);
    }
    if (filters?.eventType) {
      results = results.filter((r) => r.eventType === filters.eventType);
    }

    // Return most recent first
    results.sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime());

    const limit = filters?.limit ?? 100;
    return results.slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async deliverToEndpoint(
    event: WebhookEvent,
    endpoint: WebhookEndpoint
  ): Promise<WebhookDeliveryResult> {
    const deliveryId = `dlv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(payload, endpoint.secret, timestamp);

    let lastResult: WebhookDeliveryResult | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
      const start = performance.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        );

        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [SIGNATURE_HEADER]: signature,
            [TIMESTAMP_HEADER]: String(timestamp),
            [EVENT_HEADER]: event.type,
            [DELIVERY_HEADER]: deliveryId,
            "User-Agent": this.config.userAgent,
          },
          body: payload,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const durationMs = Math.round(performance.now() - start);
        let responseBody = "";
        try {
          responseBody = await response.text();
        } catch {
          // Ignore response body read errors
        }

        const result: WebhookDeliveryResult = {
          deliveryId,
          endpointId: endpoint.id,
          eventType: event.type,
          success: response.ok,
          statusCode: response.status,
          responseBody: responseBody.slice(0, 512),
          durationMs,
          attempt,
          deliveredAt: new Date(),
        };

        this.recordDelivery(result);

        if (response.ok) {
          logger.info(
            {
              deliveryId,
              endpointId: endpoint.id,
              eventType: event.type,
              statusCode: response.status,
              attempt,
              durationMs,
            },
            "Webhook delivered successfully"
          );
          return result;
        }

        lastResult = result;

        // Don't retry 4xx errors (except 429 Too Many Requests)
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          logger.warn(
            {
              deliveryId,
              endpointId: endpoint.id,
              statusCode: response.status,
              attempt,
            },
            "Webhook delivery failed with client error — not retrying"
          );
          return result;
        }
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        const errorMsg = err instanceof Error ? err.message : String(err);

        lastResult = {
          deliveryId,
          endpointId: endpoint.id,
          eventType: event.type,
          success: false,
          statusCode: 0,
          responseBody: "",
          durationMs,
          attempt,
          error: errorMsg,
          deliveredAt: new Date(),
        };

        this.recordDelivery(lastResult);
      }

      // Wait before retrying (exponential backoff)
      if (attempt <= this.config.maxRetries) {
        const delay = Math.min(
          this.config.initialRetryDelayMs *
            this.config.backoffMultiplier ** (attempt - 1),
          this.config.maxRetryDelayMs
        );

        logger.debug(
          {
            deliveryId,
            endpointId: endpoint.id,
            attempt,
            nextRetryMs: delay,
          },
          "Webhook delivery failed, retrying"
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    logger.error(
      {
        deliveryId,
        endpointId: endpoint.id,
        eventType: event.type,
        totalAttempts: this.config.maxRetries + 1,
      },
      "Webhook delivery failed after all retries"
    );

    return (
      lastResult ?? {
        deliveryId,
        endpointId: endpoint.id,
        eventType: event.type,
        success: false,
        statusCode: 0,
        responseBody: "",
        durationMs: 0,
        attempt: 0,
        error: "No delivery attempts made",
        deliveredAt: new Date(),
      }
    );
  }

  private recordDelivery(result: WebhookDeliveryResult): void {
    this.deliveryLog.push(result);

    // Keep only the last 10,000 entries in memory
    if (this.deliveryLog.length > 10_000) {
      this.deliveryLog.splice(0, this.deliveryLog.length - 10_000);
    }
  }
}
