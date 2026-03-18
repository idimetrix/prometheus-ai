import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { themeEnum } from "../../enums";
import { timestamps } from "../../helpers";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: themeEnum("theme").notNull().default("system"),
  defaultModel: text("default_model"),
  notificationsEnabled: boolean("notifications_enabled")
    .notNull()
    .default(true),
});
