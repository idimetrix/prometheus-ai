import { relations } from "drizzle-orm";
import { users } from "../users/users";
import { marketplaceComponents } from "./marketplace";
import { marketplaceReviews } from "./marketplace-reviews";

export const marketplaceComponentsRelations = relations(
  marketplaceComponents,
  ({ one, many }) => ({
    author: one(users, {
      fields: [marketplaceComponents.authorId],
      references: [users.id],
    }),
    reviews: many(marketplaceReviews),
  })
);

export const marketplaceReviewsRelations = relations(
  marketplaceReviews,
  ({ one }) => ({
    component: one(marketplaceComponents, {
      fields: [marketplaceReviews.componentId],
      references: [marketplaceComponents.id],
    }),
    user: one(users, {
      fields: [marketplaceReviews.userId],
      references: [users.id],
    }),
  })
);
