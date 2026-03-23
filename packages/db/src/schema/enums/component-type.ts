import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const componentTypeValues = [
  "page",
  "api_route",
  "db_table",
  "component",
  "service",
  "middleware",
  "hook",
  "utility",
  "test",
] as const;
export type ComponentType = (typeof componentTypeValues)[number];
export const componentTypeEnum = pgEnum("component_type", componentTypeValues);
export const ComponentTypeEnum = createEnumMap(componentTypeValues);
