import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const integrationStatusValues = [
  "connected",
  "disconnected",
  "error",
] as const;
export type IntegrationStatus = (typeof integrationStatusValues)[number];
export const integrationStatusEnum = pgEnum(
  "integration_status",
  integrationStatusValues
);
export const IntegrationStatusEnum = createEnumMap(integrationStatusValues);
