import { orgMembers, userSettings, users } from "@prometheus/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

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
});
