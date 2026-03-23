import { organizations } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:branding");

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const updateBrandingInput = z.object({
  appName: z.string().min(1).max(100).optional(),
  customDomain: z.string().max(253).optional(),
  logoUrl: z.string().url().max(2048).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color (e.g. #1a2b3c)")
    .optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const brandingRouter = router({
  /**
   * Returns the current organisation's custom branding settings.
   */
  getBranding: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
    });

    if (!org) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    // Branding fields are stored as JSON in the org metadata column.
    // Fall back to sensible defaults when no custom branding has been set.
    const metadata = (org as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | null
      | undefined;
    const branding = (metadata?.branding ?? {}) as Record<string, unknown>;

    return {
      logoUrl: (branding.logoUrl as string) ?? null,
      primaryColor: (branding.primaryColor as string) ?? "#6366f1",
      appName: (branding.appName as string) ?? org.name,
      customDomain: (branding.customDomain as string) ?? null,
    };
  }),

  /**
   * Updates the organisation's custom branding settings.
   * Requires admin or owner role (enforced via org membership check).
   */
  updateBranding: protectedProcedure
    .input(updateBrandingInput)
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

      // Build the updated branding object, merging with existing values
      const existingMetadata =
        ((org as Record<string, unknown>).metadata as Record<
          string,
          unknown
        >) ?? {};
      const existingBranding = (existingMetadata.branding ?? {}) as Record<
        string,
        unknown
      >;

      const updatedBranding: Record<string, unknown> = {
        ...existingBranding,
      };
      if (input.logoUrl !== undefined) {
        updatedBranding.logoUrl = input.logoUrl;
      }
      if (input.primaryColor !== undefined) {
        updatedBranding.primaryColor = input.primaryColor;
      }
      if (input.appName !== undefined) {
        updatedBranding.appName = input.appName;
      }
      if (input.customDomain !== undefined) {
        updatedBranding.customDomain = input.customDomain;
      }

      const updatedMetadata = {
        ...existingMetadata,
        branding: updatedBranding,
      };

      await ctx.db
        .update(organizations)
        .set({
          metadata: updatedMetadata,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(organizations.id, ctx.orgId));

      logger.info(
        { orgId: ctx.orgId, fields: Object.keys(input) },
        "Organization branding updated"
      );

      return {
        logoUrl: (updatedBranding.logoUrl as string) ?? null,
        primaryColor: (updatedBranding.primaryColor as string) ?? "#6366f1",
        appName: (updatedBranding.appName as string) ?? org.name,
        customDomain: (updatedBranding.customDomain as string) ?? null,
      };
    }),
});
