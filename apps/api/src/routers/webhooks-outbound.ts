import { randomBytes } from "node:crypto";
import {
  auditLogs,
  webhookDeliveries,
  webhookSubscriptions,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId, signWebhookPayload } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const logger = createLogger("webhooks-outbound-router");

const WEBHOOK_EVENTS = [
  "session.created",
  "session.completed",
  "session.failed",
  "task.submitted",
  "task.completed",
  "task.failed",
  "pr.created",
  "pr.merged",
  "credit.low",
  "credit.depleted",
] as const;

export const webhooksOutboundRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const subs = await ctx.db.query.webhookSubscriptions.findMany({
      where: eq(webhookSubscriptions.orgId, ctx.orgId),
      orderBy: [desc(webhookSubscriptions.createdAt)],
    });

    return {
      subscriptions: subs.map((s) => ({
        id: s.id,
        url: s.url,
        events: s.events as string[],
        enabled: s.enabled,
        description: s.description,
        createdAt: s.createdAt,
        lastDeliveredAt: s.lastDeliveredAt,
        failureCount: Number(s.failureCount),
      })),
    };
  }),

  create: orgAdminProcedure
    .input(
      z.object({
        url: z.string().url("Must be a valid URL"),
        events: z
          .array(z.enum(WEBHOOK_EVENTS))
          .min(1, "Select at least one event"),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const secret = `whsec_${randomBytes(32).toString("hex")}`;
      const id = generateId("whk");

      await ctx.db.insert(webhookSubscriptions).values({
        id,
        orgId: ctx.orgId,
        url: input.url,
        secret,
        events: input.events,
        description: input.description ?? null,
      });

      logger.info(
        { orgId: ctx.orgId, webhookId: id, events: input.events },
        "Webhook subscription created"
      );

      return {
        id,
        secret,
        url: input.url,
        events: input.events,
        message:
          "Store the signing secret securely. It will not be shown again.",
      };
    }),

  update: orgAdminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        url: z.string().url().optional(),
        events: z.array(z.enum(WEBHOOK_EVENTS)).optional(),
        enabled: z.boolean().optional(),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const updates: Record<string, unknown> = {};
      if (input.url !== undefined) {
        updates.url = input.url;
      }
      if (input.events !== undefined) {
        updates.events = input.events;
      }
      if (input.enabled !== undefined) {
        updates.enabled = input.enabled;
      }
      if (input.description !== undefined) {
        updates.description = input.description;
      }

      const [updated] = await ctx.db
        .update(webhookSubscriptions)
        .set(updates)
        .where(
          and(
            eq(webhookSubscriptions.id, input.id),
            eq(webhookSubscriptions.orgId, ctx.orgId)
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook subscription not found",
        });
      }

      return { success: true };
    }),

  delete: orgAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [deleted] = await ctx.db
        .delete(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, input.id),
            eq(webhookSubscriptions.orgId, ctx.orgId)
          )
        )
        .returning();

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook subscription not found",
        });
      }

      logger.info(
        { orgId: ctx.orgId, webhookId: input.id },
        "Webhook subscription deleted"
      );

      return { success: true };
    }),

  getDeliveries: protectedProcedure
    .input(
      z.object({
        subscriptionId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify ownership
      const [sub] = await ctx.db
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, input.subscriptionId),
            eq(webhookSubscriptions.orgId, ctx.orgId)
          )
        )
        .limit(1);

      if (!sub) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook subscription not found",
        });
      }

      const deliveries = await ctx.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.subscriptionId, input.subscriptionId))
        .orderBy(desc(webhookDeliveries.deliveredAt))
        .limit(input.limit);

      return {
        deliveries: deliveries.map((d) => ({
          id: d.id,
          event: d.event,
          statusCode: d.statusCode,
          success: d.success,
          attempt: Number(d.attempt),
          deliveredAt: d.deliveredAt,
        })),
      };
    }),

  test: orgAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [sub] = await ctx.db
        .select()
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, input.id),
            eq(webhookSubscriptions.orgId, ctx.orgId)
          )
        )
        .limit(1);

      if (!sub) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook subscription not found",
        });
      }

      const testPayload = {
        event: "test.ping",
        timestamp: new Date().toISOString(),
        data: { message: "Webhook test from Prometheus" },
      };

      const body = JSON.stringify(testPayload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signWebhookPayload(body, sub.secret, timestamp);

      try {
        const response = await fetch(sub.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature-256": signature,
            "X-Webhook-Timestamp": String(timestamp),
            "X-Prometheus-Event": "test.ping",
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        const deliveryId = generateId("whd");
        await ctx.db.insert(webhookDeliveries).values({
          id: deliveryId,
          subscriptionId: sub.id,
          event: "test.ping",
          payload: testPayload,
          statusCode: String(response.status),
          success: response.ok,
          attempt: "1",
        });

        return {
          success: response.ok,
          statusCode: response.status,
          deliveryId,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        logger.warn(
          { webhookId: sub.id, error: errMsg },
          "Webhook test delivery failed"
        );

        return {
          success: false,
          statusCode: null,
          error: errMsg,
        };
      }
    }),

  rotateSecret: orgAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [sub] = await ctx.db
        .select()
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, input.id),
            eq(webhookSubscriptions.orgId, ctx.orgId)
          )
        )
        .limit(1);

      if (!sub) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook subscription not found",
        });
      }

      const newSecret = `whsec_${randomBytes(32).toString("hex")}`;

      await ctx.db
        .update(webhookSubscriptions)
        .set({ secret: newSecret })
        .where(eq(webhookSubscriptions.id, input.id));

      // Audit log
      await ctx.db.insert(auditLogs).values({
        id: generateId("audit"),
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        action: "webhook.secret_rotated",
        resource: "webhook_subscription",
        resourceId: input.id,
      });

      logger.info(
        { orgId: ctx.orgId, webhookId: input.id },
        "Webhook secret rotated"
      );

      return {
        secret: newSecret,
        message:
          "Store the new signing secret securely. It will not be shown again.",
      };
    }),

  availableEvents: protectedProcedure.query(() => ({
    events: WEBHOOK_EVENTS.map((e) => ({
      name: e,
      category: e.split(".")[0],
    })),
  })),
});
