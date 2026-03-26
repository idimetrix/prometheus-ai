import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const marketplaceCategoryValues = [
  "button",
  "form",
  "layout",
  "navigation",
  "data-display",
  "feedback",
  "overlay",
  "chart",
  "other",
] as const;
export type MarketplaceCategory = (typeof marketplaceCategoryValues)[number];
export const marketplaceCategoryEnum = pgEnum(
  "marketplace_category",
  marketplaceCategoryValues
);
export const MarketplaceCategoryEnum = createEnumMap(marketplaceCategoryValues);
