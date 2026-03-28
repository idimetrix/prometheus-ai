/**
 * GAP-069: White-Label Configuration
 *
 * Configure org branding (logo, colors, domain), get current branding,
 * and preview branded experience.
 */

import { organizations } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const logger = createLogger("api:white-label");

export const whiteLabelRouter = router({
  configure: orgAdminProcedure
    .input(
      z.object({
        logoUrl: z.string().url().max(2048).optional(),
        primaryColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        secondaryColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        appName: z.string().min(1).max(100).optional(),
        customDomain: z.string().max(253).optional(),
        faviconUrl: z.string().url().max(2048).optional(),
        footerText: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const org = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
      });

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const metadata =
        ((org as Record<string, unknown>).metadata as Record<
          string,
          unknown
        >) ?? {};
      const existingWhiteLabel = (metadata.whiteLabel ?? {}) as Record<
        string,
        unknown
      >;

      const updated: Record<string, unknown> = { ...existingWhiteLabel };
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) {
          updated[key] = value;
        }
      }

      await ctx.db
        .update(organizations)
        .set({
          metadata: { ...metadata, whiteLabel: updated },
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(organizations.id, ctx.orgId));

      logger.info(
        { orgId: ctx.orgId, fields: Object.keys(input) },
        "White-label configured"
      );

      return { success: true, config: updated };
    }),

  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
    });

    if (!org) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    const metadata =
      ((org as Record<string, unknown>).metadata as Record<string, unknown>) ??
      {};
    const whiteLabel = (metadata.whiteLabel ?? {}) as Record<string, unknown>;

    return {
      logoUrl: (whiteLabel.logoUrl as string) ?? null,
      primaryColor: (whiteLabel.primaryColor as string) ?? "#6366f1",
      secondaryColor: (whiteLabel.secondaryColor as string) ?? "#a855f7",
      appName: (whiteLabel.appName as string) ?? org.name,
      customDomain: (whiteLabel.customDomain as string) ?? null,
      faviconUrl: (whiteLabel.faviconUrl as string) ?? null,
      footerText: (whiteLabel.footerText as string) ?? null,
    };
  }),

  preview: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
    });

    if (!org) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    const metadata =
      ((org as Record<string, unknown>).metadata as Record<string, unknown>) ??
      {};
    const whiteLabel = (metadata.whiteLabel ?? {}) as Record<string, unknown>;

    return {
      previewUrl: `/preview/white-label?org=${ctx.orgId}`,
      config: whiteLabel,
      orgName: org.name,
    };
  }),
});
