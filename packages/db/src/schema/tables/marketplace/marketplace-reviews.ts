import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { users } from "../users/users";
import { marketplaceComponents } from "./marketplace";

export const marketplaceReviews = pgTable(
  "marketplace_reviews",
  {
    id: text("id").primaryKey(),
    componentId: text("component_id")
      .notNull()
      .references(() => marketplaceComponents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    ...timestamps,
  },
  (table) => [
    index("marketplace_reviews_component_id_idx").on(table.componentId),
    index("marketplace_reviews_user_id_idx").on(table.userId),
    index("marketplace_reviews_component_user_idx").on(
      table.componentId,
      table.userId
    ),
  ]
);
