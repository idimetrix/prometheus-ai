import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { marketplaceComponents } from "./marketplace";
import { marketplaceReviews } from "./marketplace-reviews";

export const insertMarketplaceComponentSchema = createInsertSchema(
  marketplaceComponents
);
export const selectMarketplaceComponentSchema = createSelectSchema(
  marketplaceComponents
);
export type MarketplaceComponent = typeof marketplaceComponents.$inferSelect;
export type NewMarketplaceComponent = typeof marketplaceComponents.$inferInsert;

export const insertMarketplaceReviewSchema =
  createInsertSchema(marketplaceReviews);
export const selectMarketplaceReviewSchema =
  createSelectSchema(marketplaceReviews);
export type MarketplaceReview = typeof marketplaceReviews.$inferSelect;
export type NewMarketplaceReview = typeof marketplaceReviews.$inferInsert;
