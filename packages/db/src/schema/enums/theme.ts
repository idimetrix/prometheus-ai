import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const themeValues = ["light", "dark", "system"] as const;
export type Theme = (typeof themeValues)[number];
export const themeEnum = pgEnum("theme", themeValues);
export const ThemeEnum = createEnumMap(themeValues);
