import { z } from "zod";

// ---------- Enums ----------
export const integrationProviderSchema = z.enum([
  "github",
  "gitlab",
  "slack",
  "jira",
  "linear",
  "notion",
  "vercel",
  "aws",
  "gcp",
  "azure",
  "custom",
]);

export const integrationStatusSchema = z.enum([
  "connected",
  "disconnected",
  "error",
]);

// ---------- Connect / Configure ----------
export const connectIntegrationSchema = z.object({
  provider: integrationProviderSchema,
  credentials: z
    .object({
      accessToken: z.string().min(1).optional(),
      refreshToken: z.string().optional(),
      apiKey: z.string().optional(),
      webhookUrl: z.string().url().optional(),
    })
    .refine((data) => data.accessToken || data.apiKey, {
      message: "Either accessToken or apiKey must be provided",
    }),
  config: z.record(z.unknown()).default({}),
});

export const configureIntegrationSchema = z.object({
  integrationId: z.string().min(1),
  config: z.record(z.unknown()),
});

export const disconnectIntegrationSchema = z.object({
  integrationId: z.string().min(1),
});

// ---------- Test ----------
export const testIntegrationSchema = z.object({
  integrationId: z.string().min(1),
});

// ---------- MCP tools ----------
export const configureMcpToolSchema = z.object({
  projectId: z.string().min(1),
  toolName: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

export const listMcpToolsSchema = z.object({
  projectId: z.string().min(1),
});

// ---------- List / Query ----------
export const listIntegrationsSchema = z.object({
  status: integrationStatusSchema.optional(),
  provider: integrationProviderSchema.optional(),
});

export const getIntegrationSchema = z.object({
  integrationId: z.string().min(1),
});

// ---------- Output schemas ----------
export const integrationOutputSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  provider: z.string(),
  status: integrationStatusSchema,
  connectedAt: z.string().datetime().nullable(),
});

export const integrationListOutputSchema = z.object({
  items: z.array(integrationOutputSchema),
});

export const integrationTestOutputSchema = z.object({
  success: z.boolean(),
  latencyMs: z.number(),
  message: z.string().optional(),
});

export const mcpToolOutputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  toolName: z.string(),
  enabled: z.boolean(),
  config: z.record(z.unknown()),
});

// ---------- Types ----------
export type ConnectIntegrationInput = z.infer<typeof connectIntegrationSchema>;
export type ConfigureIntegrationInput = z.infer<
  typeof configureIntegrationSchema
>;
export type DisconnectIntegrationInput = z.infer<
  typeof disconnectIntegrationSchema
>;
export type TestIntegrationInput = z.infer<typeof testIntegrationSchema>;
export type ConfigureMcpToolInput = z.infer<typeof configureMcpToolSchema>;
export type ListMcpToolsInput = z.infer<typeof listMcpToolsSchema>;
export type ListIntegrationsInput = z.infer<typeof listIntegrationsSchema>;
export type GetIntegrationInput = z.infer<typeof getIntegrationSchema>;
export type IntegrationOutput = z.infer<typeof integrationOutputSchema>;
export type IntegrationListOutput = z.infer<typeof integrationListOutputSchema>;
export type IntegrationTestOutput = z.infer<typeof integrationTestOutputSchema>;
export type McpToolOutput = z.infer<typeof mcpToolOutputSchema>;
