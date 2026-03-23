/**
 * Human-in-the-Loop Approval Bridge
 *
 * Redis-based bridge that enables human approval workflows for tool executions.
 * Publishes approval requests to a Redis channel and waits for responses,
 * with configurable timeouts and automatic cleanup.
 */

import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";
import type {
  HumanInputRequestEvent,
  HumanInputResponseEvent,
} from "./execution-events";

const logger = createLogger("orchestrator:human-bridge");

export class HumanApprovalBridge {
  private readonly sessionId: string;
  private readonly defaultTimeoutMs: number;
  private readonly subscriber: ReturnType<typeof redis.duplicate>;
  private disposed = false;

  constructor(sessionId: string, defaultTimeoutMs = 300_000) {
    this.sessionId = sessionId;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.subscriber = redis.duplicate();
  }

  /**
   * Publish an approval request and wait for a human response via Redis pub/sub.
   * Returns the approval result or a timeout rejection.
   */
  requestApproval(request: {
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
    question: string;
    context?: string;
    suggestedResponses?: string[];
  }): Promise<{
    approved: boolean;
    message: string;
    action: "approve" | "reject" | "respond";
  }> {
    const { requestId } = request;
    const requestChannel = `session:${this.sessionId}:approval:request`;
    const responseChannel = `session:${this.sessionId}:approval:response:${requestId}`;

    const event: HumanInputRequestEvent = {
      type: "human_input_request",
      requestId,
      question: request.question,
      context: request.context,
      suggestedResponses: request.suggestedResponses,
      sessionId: this.sessionId,
      agentRole: "",
      sequence: 0,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      { requestId, toolName: request.toolName, sessionId: this.sessionId },
      "Publishing human approval request"
    );

    return new Promise<{
      approved: boolean;
      message: string;
      action: "approve" | "reject" | "respond";
    }>((resolve) => {
      let settled = false;

      const cleanup = async () => {
        if (!settled) {
          settled = true;
          try {
            await this.subscriber.unsubscribe(responseChannel);
          } catch (error) {
            logger.warn(
              { error, responseChannel },
              "Failed to unsubscribe from response channel"
            );
          }
        }
      };

      const timeout = setTimeout(async () => {
        await cleanup();
        logger.warn(
          { requestId, timeoutMs: this.defaultTimeoutMs },
          "Human approval request timed out"
        );
        resolve({
          approved: false,
          message: `Approval timed out after ${Math.round(this.defaultTimeoutMs / 60_000)} minutes`,
          action: "reject",
        });
      }, this.defaultTimeoutMs);

      this.subscriber.subscribe(responseChannel, (error) => {
        if (error) {
          clearTimeout(timeout);
          logger.error(
            { error, responseChannel },
            "Failed to subscribe to response channel"
          );
          cleanup();
          resolve({
            approved: false,
            message: "Failed to subscribe for approval response",
            action: "reject",
          });
        }
      });

      this.subscriber.on("message", async (channel: string, data: string) => {
        if (channel !== responseChannel || settled) {
          return;
        }

        clearTimeout(timeout);
        await cleanup();

        try {
          const response = JSON.parse(data) as HumanInputResponseEvent;

          logger.info(
            { requestId, action: response.action, message: response.message },
            "Received human approval response"
          );

          resolve({
            approved: response.action === "approve",
            message: response.message,
            action: response.action,
          });
        } catch (parseError) {
          logger.error(
            { parseError, data },
            "Failed to parse approval response"
          );
          resolve({
            approved: false,
            message: "Invalid response format",
            action: "reject",
          });
        }
      });

      // Publish the request after subscribing to avoid race conditions
      redis.publish(requestChannel, JSON.stringify(event)).catch((error) => {
        logger.error(
          { error, requestChannel },
          "Failed to publish approval request"
        );
      });
    });
  }

  /**
   * Submit a human response to a pending approval request.
   */
  async submitResponse(
    requestId: string,
    response: { action: "approve" | "reject" | "respond"; message: string }
  ): Promise<void> {
    const responseChannel = `session:${this.sessionId}:approval:response:${requestId}`;

    const event: HumanInputResponseEvent = {
      type: "human_input_response",
      requestId,
      action: response.action,
      message: response.message,
      sessionId: this.sessionId,
      agentRole: "",
      sequence: 0,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      { requestId, action: response.action, sessionId: this.sessionId },
      "Submitting human approval response"
    );

    await redis.publish(responseChannel, JSON.stringify(event));
  }

  /**
   * Clean up all Redis subscriptions.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    logger.info(
      { sessionId: this.sessionId },
      "Disposing human approval bridge"
    );

    this.subscriber.disconnect();
  }
}

/**
 * Factory function to create a HumanApprovalBridge instance.
 */
export function createHumanBridge(
  sessionId: string,
  timeoutMs?: number
): HumanApprovalBridge {
  return new HumanApprovalBridge(sessionId, timeoutMs);
}
