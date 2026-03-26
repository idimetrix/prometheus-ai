import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { projectSecrets } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import {
  bulkImportSecretsSchema,
  createSecretSchema,
  deleteSecretSchema,
  listSecretsSchema,
  updateSecretSchema,
} from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:secrets");

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const _AUTH_TAG_LENGTH = 16;

/**
 * Derive the encryption key from the environment variable.
 * Falls back to a deterministic dev key if not set (NOT for production).
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.SECRETS_ENCRYPTION_KEY;
  if (keyHex) {
    return Buffer.from(keyHex, "hex");
  }
  // Dev fallback -- 32 bytes of zeros. In production SECRETS_ENCRYPTION_KEY must be set.
  return Buffer.alloc(32, 0);
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted value format");
  }
  const iv = Buffer.from(parts[0] as string, "hex");
  const authTag = Buffer.from(parts[1] as string, "hex");
  const encrypted = Buffer.from(parts[2] as string, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// ---------------------------------------------------------------------------
// .env parser
// ---------------------------------------------------------------------------

function parseEnvContent(
  content: string
): Array<{ key: string; value: string }> {
  const results: Array<{ key: string; value: string }> = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      results.push({ key, value });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const secretsRouter = router({
  /**
   * List secrets for a project. Values for isSecret=true entries are masked.
   */
  list: protectedProcedure
    .input(listSecretsSchema)
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(projectSecrets.orgId, ctx.orgId),
        eq(projectSecrets.projectId, input.projectId),
      ];

      if (input.environment) {
        conditions.push(eq(projectSecrets.environment, input.environment));
      }

      const secrets = await ctx.db
        .select()
        .from(projectSecrets)
        .where(and(...conditions));

      return {
        secrets: secrets.map((s) => ({
          id: s.id,
          key: s.key,
          environment: s.environment,
          description: s.description,
          isSecret: s.isSecret,
          value: s.isSecret ? "********" : decrypt(s.encryptedValue),
          createdBy: s.createdBy,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
      };
    }),

  /**
   * Create a new secret.
   */
  create: protectedProcedure
    .input(createSecretSchema)
    .mutation(async ({ input, ctx }) => {
      const id = generateId("sec");
      const encryptedValue = encrypt(input.value);

      try {
        await ctx.db.insert(projectSecrets).values({
          id,
          projectId: input.projectId,
          orgId: ctx.orgId,
          key: input.key,
          encryptedValue,
          environment: input.environment,
          description: input.description,
          isSecret: input.isSecret,
          createdBy: ctx.auth.userId,
        });
      } catch (error) {
        // Unique constraint violation
        if (error instanceof Error && error.message.includes("unique")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Secret "${input.key}" already exists for environment "${input.environment}"`,
          });
        }
        throw error;
      }

      logger.info(
        { orgId: ctx.orgId, projectId: input.projectId, key: input.key },
        "Secret created"
      );

      return { id, key: input.key };
    }),

  /**
   * Update an existing secret.
   */
  update: protectedProcedure
    .input(updateSecretSchema)
    .mutation(async ({ input, ctx }) => {
      const updateData: Record<string, unknown> = {};

      if (input.value !== undefined) {
        updateData.encryptedValue = encrypt(input.value);
      }
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.environment !== undefined) {
        updateData.environment = input.environment;
      }

      if (Object.keys(updateData).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No fields to update",
        });
      }

      const [updated] = await ctx.db
        .update(projectSecrets)
        .set(updateData)
        .where(
          and(
            eq(projectSecrets.id, input.id),
            eq(projectSecrets.orgId, ctx.orgId)
          )
        )
        .returning({ id: projectSecrets.id });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found",
        });
      }

      logger.info({ orgId: ctx.orgId, secretId: input.id }, "Secret updated");

      return { success: true };
    }),

  /**
   * Delete a secret.
   */
  delete: protectedProcedure
    .input(deleteSecretSchema)
    .mutation(async ({ input, ctx }) => {
      const [deleted] = await ctx.db
        .delete(projectSecrets)
        .where(
          and(
            eq(projectSecrets.id, input.id),
            eq(projectSecrets.projectId, input.projectId),
            eq(projectSecrets.orgId, ctx.orgId)
          )
        )
        .returning({ id: projectSecrets.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found",
        });
      }

      logger.info({ orgId: ctx.orgId, secretId: input.id }, "Secret deleted");

      return { success: true };
    }),

  /**
   * Bulk import secrets from .env format string.
   */
  bulkImport: protectedProcedure
    .input(bulkImportSecretsSchema)
    .mutation(async ({ input, ctx }) => {
      const entries = parseEnvContent(input.envContent);

      if (entries.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No valid environment variables found in input",
        });
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const entry of entries) {
        const encryptedValue = encrypt(entry.value);

        // Check if key already exists for this project + environment
        const [existing] = await ctx.db
          .select({ id: projectSecrets.id })
          .from(projectSecrets)
          .where(
            and(
              eq(projectSecrets.projectId, input.projectId),
              eq(projectSecrets.orgId, ctx.orgId),
              eq(projectSecrets.key, entry.key),
              eq(projectSecrets.environment, input.environment)
            )
          )
          .limit(1);

        if (existing) {
          if (input.overwrite) {
            await ctx.db
              .update(projectSecrets)
              .set({ encryptedValue })
              .where(eq(projectSecrets.id, existing.id));
            updated++;
          } else {
            skipped++;
          }
        } else {
          await ctx.db.insert(projectSecrets).values({
            id: generateId("sec"),
            projectId: input.projectId,
            orgId: ctx.orgId,
            key: entry.key,
            encryptedValue,
            environment: input.environment,
            isSecret: true,
            createdBy: ctx.auth.userId,
          });
          created++;
        }
      }

      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          created,
          updated,
          skipped,
        },
        "Bulk secret import completed"
      );

      return { created, updated, skipped, total: entries.length };
    }),
});
