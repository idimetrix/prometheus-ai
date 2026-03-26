import {
  creditBalances,
  organizations,
  orgMembers,
  userSettings,
  users,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:user");

export const userRouter = router({
  profile: protectedProcedure.query(async ({ ctx }) => {
    // Look up by clerkId first, then fall back to user id (for dev seed data)
    const user =
      (await ctx.db.query.users.findFirst({
        where: eq(users.clerkId, ctx.auth.userId),
        with: { settings: true },
      })) ??
      (await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
        with: { settings: true },
      }));
    return user ?? null;
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        notifyOnComplete: z.boolean(),
        notifyOnFail: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user =
        (await ctx.db.query.users.findFirst({
          where: eq(users.clerkId, ctx.auth.userId),
          columns: { id: true },
        })) ??
        (await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.auth.userId),
          columns: { id: true },
        }));
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      await ctx.db
        .update(users)
        .set({ name: input.name })
        .where(eq(users.id, user.id));

      const existing = await ctx.db.query.userSettings.findFirst({
        where: eq(userSettings.userId, user.id),
      });

      if (existing) {
        await ctx.db
          .update(userSettings)
          .set({
            notificationsEnabled: input.notifyOnComplete || input.notifyOnFail,
          })
          .where(eq(userSettings.userId, user.id));
      } else {
        await ctx.db.insert(userSettings).values({
          userId: user.id,
          notificationsEnabled: input.notifyOnComplete || input.notifyOnFail,
        });
      }

      return { success: true };
    }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        theme: z.enum(["light", "dark", "system"]).optional(),
        defaultModel: z.string().nullable().optional(),
        notificationsEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user =
        (await ctx.db.query.users.findFirst({
          where: eq(users.clerkId, ctx.auth.userId),
          columns: { id: true },
        })) ??
        (await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.auth.userId),
          columns: { id: true },
        }));
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const existing = await ctx.db.query.userSettings.findFirst({
        where: eq(userSettings.userId, user.id),
      });

      if (existing) {
        await ctx.db
          .update(userSettings)
          .set(input)
          .where(eq(userSettings.userId, user.id));
      } else {
        await ctx.db.insert(userSettings).values({
          userId: user.id,
          theme: input.theme ?? "system",
          defaultModel: input.defaultModel ?? null,
          notificationsEnabled: input.notificationsEnabled ?? true,
        });
      }

      return { success: true };
    }),

  organizations: protectedProcedure.query(async ({ ctx }) => {
    const user =
      (await ctx.db.query.users.findFirst({
        where: eq(users.clerkId, ctx.auth.userId),
        columns: { id: true },
      })) ??
      (await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
        columns: { id: true },
      }));
    if (!user) {
      return { organizations: [] };
    }

    const memberships = await ctx.db.query.orgMembers.findMany({
      where: eq(orgMembers.userId, user.id),
      with: { organization: true },
    });

    return {
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        planTier: m.organization.planTier,
        role: m.role,
      })),
    };
  }),

  /**
   * Check whether the current user needs onboarding (has no organizations).
   */
  needsOnboarding: protectedProcedure.query(async ({ ctx }) => {
    const user =
      (await ctx.db.query.users.findFirst({
        where: eq(users.clerkId, ctx.auth.userId),
        columns: { id: true },
      })) ??
      (await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.auth.userId),
        columns: { id: true },
      }));

    if (!user) {
      return { needsOnboarding: true };
    }

    const membership = await ctx.db.query.orgMembers.findFirst({
      where: eq(orgMembers.userId, user.id),
      columns: { id: true },
    });

    return { needsOnboarding: !membership };
  }),

  /**
   * Create an organization during onboarding.
   * Creates the org, a credit balance, and makes the user the owner.
   *
   * If the org was already created via Clerk webhook (race condition), this
   * will link the user as owner instead of duplicating.
   */
  createOrg: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, "Organization name is required").max(100),
        slug: z
          .string()
          .min(3)
          .max(50)
          .regex(
            /^[a-z0-9-]+$/,
            "Slug must be lowercase alphanumeric with hyphens"
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Resolve the user's internal ID
      const user =
        (await ctx.db.query.users.findFirst({
          where: eq(users.clerkId, ctx.auth.userId),
          columns: { id: true },
        })) ??
        (await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.auth.userId),
          columns: { id: true },
        }));

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Generate slug from name if not provided
      const slug =
        input.slug ??
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50);

      // Check slug uniqueness
      const existingOrg = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.slug, slug),
        columns: { id: true },
      });

      if (existingOrg) {
        // Org with this slug already exists (likely from Clerk webhook).
        // Ensure user is a member, then return it.
        await ctx.db
          .insert(orgMembers)
          .values({
            id: generateId("om"),
            orgId: existingOrg.id,
            userId: user.id,
            role: "owner",
            joinedAt: new Date(),
          })
          .onConflictDoNothing();

        return { id: existingOrg.id, slug, name: input.name };
      }

      const orgId = generateId("org");

      await ctx.db.insert(organizations).values({
        id: orgId,
        name: input.name,
        slug,
        planTier: "hobby",
      });

      await ctx.db.insert(creditBalances).values({
        orgId,
        balance: 50,
        reserved: 0,
      });

      await ctx.db.insert(orgMembers).values({
        id: generateId("om"),
        orgId,
        userId: user.id,
        role: "owner",
        joinedAt: new Date(),
      });

      logger.info(
        { orgId, userId: user.id, slug },
        "Organization created via onboarding"
      );

      return { id: orgId, slug, name: input.name };
    }),
});
