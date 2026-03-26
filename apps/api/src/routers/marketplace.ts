import { marketplaceComponents, marketplaceReviews } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import {
  getMarketplaceComponentSchema,
  installMarketplaceComponentSchema,
  listMarketplaceSchema,
  myMarketplaceComponentsSchema,
  publishMarketplaceComponentSchema,
  reviewMarketplaceComponentSchema,
  unpublishMarketplaceComponentSchema,
  updateMarketplaceComponentSchema,
} from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("marketplace-router");

export const marketplaceRouter = router({
  list: protectedProcedure
    .input(listMarketplaceSchema)
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(marketplaceComponents.isPublic, true),
        eq(marketplaceComponents.isApproved, true),
      ];

      if (input.search) {
        conditions.push(
          or(
            ilike(marketplaceComponents.name, `%${input.search}%`),
            ilike(marketplaceComponents.displayName, `%${input.search}%`),
            ilike(marketplaceComponents.description, `%${input.search}%`)
          ) ?? sql`true`
        );
      }

      if (input.category) {
        conditions.push(eq(marketplaceComponents.category, input.category));
      }

      if (input.cursor) {
        const cursorComponent =
          await ctx.db.query.marketplaceComponents.findFirst({
            where: eq(marketplaceComponents.id, input.cursor),
            columns: { createdAt: true },
          });
        if (cursorComponent) {
          conditions.push(
            lt(marketplaceComponents.createdAt, cursorComponent.createdAt)
          );
        }
      }

      let orderBy = [desc(marketplaceComponents.downloads)];
      if (input.sortBy === "rating") {
        orderBy = [desc(marketplaceComponents.rating)];
      } else if (input.sortBy === "newest") {
        orderBy = [desc(marketplaceComponents.createdAt)];
      }

      const results = await ctx.db.query.marketplaceComponents.findMany({
        where: and(...conditions),
        orderBy,
        limit: input.limit + 1,
        with: {
          author: { columns: { id: true, name: true, avatarUrl: true } },
        },
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        components: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  get: protectedProcedure
    .input(getMarketplaceComponentSchema)
    .query(async ({ input, ctx }) => {
      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
        with: {
          author: { columns: { id: true, name: true, avatarUrl: true } },
          reviews: {
            limit: 20,
            orderBy: [desc(marketplaceReviews.createdAt)],
          },
        },
      });

      if (!component) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Component not found",
        });
      }

      return component;
    }),

  publish: protectedProcedure
    .input(publishMarketplaceComponentSchema)
    .mutation(async ({ input, ctx }) => {
      const id = generateId("mpc");
      const [component] = await ctx.db
        .insert(marketplaceComponents)
        .values({
          id,
          authorId: ctx.auth.userId,
          orgId: ctx.orgId,
          name: input.name,
          displayName: input.displayName,
          description: input.description ?? null,
          category: input.category ?? null,
          tags: input.tags ?? null,
          code: input.code,
          language: input.language,
          dependencies: input.dependencies ?? null,
          previewImageUrl: input.previewImageUrl ?? null,
          demoUrl: input.demoUrl ?? null,
          isPublic: input.isPublic,
          version: input.version,
        })
        .returning();

      logger.info({ componentId: id }, "Marketplace component published");
      return component as NonNullable<typeof component>;
    }),

  update: protectedProcedure
    .input(updateMarketplaceComponentSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Component not found",
        });
      }

      if (existing.authorId !== ctx.auth.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only update your own components",
        });
      }

      const [updated] = await ctx.db
        .update(marketplaceComponents)
        .set({ ...input.data, updatedAt: new Date() })
        .where(eq(marketplaceComponents.id, input.componentId))
        .returning();

      logger.info(
        { componentId: input.componentId },
        "Marketplace component updated"
      );
      return updated as NonNullable<typeof updated>;
    }),

  unpublish: protectedProcedure
    .input(unpublishMarketplaceComponentSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Component not found",
        });
      }

      if (existing.authorId !== ctx.auth.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only unpublish your own components",
        });
      }

      await ctx.db
        .delete(marketplaceComponents)
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info(
        { componentId: input.componentId },
        "Marketplace component unpublished"
      );
      return { success: true };
    }),

  install: protectedProcedure
    .input(installMarketplaceComponentSchema)
    .mutation(async ({ input, ctx }) => {
      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
      });

      if (!component) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Component not found",
        });
      }

      await ctx.db
        .update(marketplaceComponents)
        .set({
          downloads: sql`${marketplaceComponents.downloads} + 1`,
        })
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info(
        { componentId: input.componentId },
        "Marketplace component installed"
      );

      return {
        code: component.code,
        language: component.language,
        dependencies: component.dependencies,
        name: component.name,
      };
    }),

  review: protectedProcedure
    .input(reviewMarketplaceComponentSchema)
    .mutation(async ({ input, ctx }) => {
      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
      });

      if (!component) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Component not found",
        });
      }

      const existingReview = await ctx.db.query.marketplaceReviews.findFirst({
        where: and(
          eq(marketplaceReviews.componentId, input.componentId),
          eq(marketplaceReviews.userId, ctx.auth.userId)
        ),
      });

      if (existingReview) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You have already reviewed this component",
        });
      }

      const id = generateId("mpr");
      const [review] = await ctx.db
        .insert(marketplaceReviews)
        .values({
          id,
          componentId: input.componentId,
          userId: ctx.auth.userId,
          rating: input.rating,
          comment: input.comment ?? null,
        })
        .returning();

      // Update component rating
      const newCount = component.ratingCount + 1;
      const newRating =
        (component.rating * component.ratingCount + input.rating) / newCount;

      await ctx.db
        .update(marketplaceComponents)
        .set({
          rating: newRating,
          ratingCount: newCount,
        })
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info(
        { componentId: input.componentId, rating: input.rating },
        "Marketplace review submitted"
      );

      return review as NonNullable<typeof review>;
    }),

  myComponents: protectedProcedure
    .input(myMarketplaceComponentsSchema)
    .query(async ({ input, ctx }) => {
      const conditions = [eq(marketplaceComponents.authorId, ctx.auth.userId)];

      if (input.cursor) {
        const cursorComponent =
          await ctx.db.query.marketplaceComponents.findFirst({
            where: eq(marketplaceComponents.id, input.cursor),
            columns: { createdAt: true },
          });
        if (cursorComponent) {
          conditions.push(
            lt(marketplaceComponents.createdAt, cursorComponent.createdAt)
          );
        }
      }

      const results = await ctx.db.query.marketplaceComponents.findMany({
        where: and(...conditions),
        orderBy: [desc(marketplaceComponents.createdAt)],
        limit: input.limit + 1,
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        components: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),
});
