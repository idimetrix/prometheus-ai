import { z } from "zod";

// ---------- Enums ----------
export const secretEnvironmentValues = [
  "development",
  "staging",
  "production",
  "all",
] as const;

export const secretEnvironmentSchema = z.enum(secretEnvironmentValues);

// ---------- Create ----------
export const createSecretSchema = z.object({
  projectId: z.string().min(1),
  key: z
    .string()
    .min(1, "Key is required")
    .max(256, "Key must be 256 characters or fewer")
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Key must be a valid environment variable name"
    ),
  value: z.string().min(1, "Value is required").max(10_000),
  environment: secretEnvironmentSchema.default("all"),
  description: z.string().max(500).optional(),
  isSecret: z.boolean().default(true),
});

// ---------- Update ----------
export const updateSecretSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1).max(10_000).optional(),
  description: z.string().max(500).optional(),
  environment: secretEnvironmentSchema.optional(),
});

// ---------- Delete ----------
export const deleteSecretSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
});

// ---------- List ----------
export const listSecretsSchema = z.object({
  projectId: z.string().min(1),
  environment: secretEnvironmentSchema.optional(),
});

// ---------- Bulk Import ----------
export const bulkImportSecretsSchema = z.object({
  projectId: z.string().min(1),
  /** Raw .env file content, e.g. "DATABASE_URL=postgres://...\nAPI_KEY=sk-..." */
  envContent: z.string().min(1).max(100_000),
  environment: secretEnvironmentSchema.default("all"),
  /** If true, overwrite existing keys */
  overwrite: z.boolean().default(false),
});

// ---------- Types ----------
export type CreateSecretInput = z.infer<typeof createSecretSchema>;
export type UpdateSecretInput = z.infer<typeof updateSecretSchema>;
export type DeleteSecretInput = z.infer<typeof deleteSecretSchema>;
export type ListSecretsInput = z.infer<typeof listSecretsSchema>;
export type BulkImportSecretsInput = z.infer<typeof bulkImportSecretsSchema>;
