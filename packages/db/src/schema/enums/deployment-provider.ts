import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const deploymentProviderValues = [
  "vercel",
  "netlify",
  "cloudflare",
  "docker",
] as const;
export type DeploymentProvider = (typeof deploymentProviderValues)[number];
export const deploymentProviderEnum = pgEnum(
  "deployment_provider",
  deploymentProviderValues
);
export const DeploymentProviderEnum = createEnumMap(deploymentProviderValues);
