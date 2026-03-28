/**
 * GAP-072: Data Residency / Multi-Region
 *
 * List available regions, set org's primary data region,
 * and get data residency policy.
 */

import { organizations } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const logger = createLogger("api:data-residency");

const AVAILABLE_REGIONS = [
  {
    id: "us-east-1",
    name: "US East (Virginia)",
    country: "US",
    available: true,
  },
  { id: "us-west-2", name: "US West (Oregon)", country: "US", available: true },
  {
    id: "eu-west-1",
    name: "EU West (Ireland)",
    country: "IE",
    available: true,
  },
  {
    id: "eu-central-1",
    name: "EU Central (Frankfurt)",
    country: "DE",
    available: true,
  },
  {
    id: "ap-southeast-1",
    name: "Asia Pacific (Singapore)",
    country: "SG",
    available: true,
  },
  {
    id: "ap-northeast-1",
    name: "Asia Pacific (Tokyo)",
    country: "JP",
    available: false,
  },
] as const;

export const dataResidencyRouter = router({
  getRegions: protectedProcedure.query(() => ({
    regions: AVAILABLE_REGIONS.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      available: r.available,
    })),
  })),

  setOrgRegion: orgAdminProcedure
    .input(
      z.object({
        regionId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const region = AVAILABLE_REGIONS.find((r) => r.id === input.regionId);
      if (!region) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid region" });
      }
      if (!region.available) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Region not yet available",
        });
      }

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

      await ctx.db
        .update(organizations)
        .set({
          metadata: { ...metadata, dataRegion: input.regionId },
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(organizations.id, ctx.orgId));

      logger.info(
        { orgId: ctx.orgId, regionId: input.regionId },
        "Organization data region updated"
      );

      return {
        regionId: input.regionId,
        regionName: region.name,
        message: "Data residency region updated. Migration will be scheduled.",
      };
    }),

  getPolicy: protectedProcedure.query(async ({ ctx }) => {
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
    const regionId = (metadata.dataRegion as string) ?? "us-east-1";
    const region = AVAILABLE_REGIONS.find((r) => r.id === regionId);

    return {
      primaryRegion: regionId,
      regionName: region?.name ?? "Unknown",
      country: region?.country ?? "Unknown",
      dataRetentionDays: (metadata.retentionDays as number) ?? 365,
      encryptionStandard: "AES-256",
      complianceFrameworks: ["SOC2", "GDPR"],
    };
  }),
});
