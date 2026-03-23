import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { apiKeys } from "./api-keys";

export const insertApiKeySchema = createInsertSchema(apiKeys);
export const selectApiKeySchema = createSelectSchema(apiKeys);
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
