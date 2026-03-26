import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const secretEnvironmentValues = [
  "development",
  "staging",
  "production",
  "all",
] as const;
export type SecretEnvironment = (typeof secretEnvironmentValues)[number];
export const secretEnvironmentEnum = pgEnum(
  "secret_environment",
  secretEnvironmentValues
);
export const SecretEnvironmentEnum = createEnumMap(secretEnvironmentValues);
