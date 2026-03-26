import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
} from "drizzle-orm/pg-core";
import { marketplaceCategoryEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { users } from "../users/users";

export const marketplaceComponents = pgTable(
  "marketplace_components",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    category: marketplaceCategoryEnum("category"),
    tags: text("tags").array(),
    code: text("code").notNull(),
    language: text("language").notNull().default("tsx"),
    dependencies: text("dependencies").array(),
    previewImageUrl: text("preview_image_url"),
    demoUrl: text("demo_url"),
    downloads: integer("downloads").notNull().default(0),
    rating: real("rating").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    isApproved: boolean("is_approved").notNull().default(false),
    version: text("version").notNull().default("1.0.0"),
    ...timestamps,
  },
  (table) => [
    index("marketplace_components_author_id_idx").on(table.authorId),
    index("marketplace_components_category_idx").on(table.category),
    index("marketplace_components_name_idx").on(table.name),
    index("marketplace_components_downloads_idx").on(table.downloads),
    index("marketplace_components_rating_idx").on(table.rating),
  ]
);
