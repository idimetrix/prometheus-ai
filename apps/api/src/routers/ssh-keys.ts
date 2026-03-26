import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { sshKeys } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:ssh-keys");

// ---------------------------------------------------------------------------
// Encryption helpers (same pattern as secrets router)
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const keyHex = process.env.SECRETS_ENCRYPTION_KEY;
  if (keyHex) {
    return Buffer.from(keyHex, "hex");
  }
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
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function _decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted value format");
  }
  const ivHex = parts[0] as string;
  const authTagHex = parts[1] as string;
  const encryptedHex = parts[2] as string;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// ---------------------------------------------------------------------------
// Key generation helpers
// ---------------------------------------------------------------------------

function generateEd25519KeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

function computeFingerprint(publicKey: string): string {
  const hash = createHash("sha256").update(publicKey).digest("base64");
  return `SHA256:${hash}`;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const listSshKeysSchema = z.object({
  projectId: z.string().optional(),
});

const generateSshKeySchema = z.object({
  name: z.string().min(1).max(255),
  projectId: z.string().optional(),
  keyType: z.enum(["ed25519", "rsa"]).default("ed25519"),
});

const getSshKeySchema = z.object({
  keyId: z.string(),
});

const deleteSshKeySchema = z.object({
  keyId: z.string(),
});

const getPublicKeySchema = z.object({
  keyId: z.string(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const sshKeysRouter = router({
  /** List SSH keys for the org, optionally filtered by project. */
  list: protectedProcedure
    .input(listSshKeysSchema)
    .query(async ({ input, ctx }) => {
      const conditions = [eq(sshKeys.orgId, ctx.orgId)];

      if (input.projectId) {
        conditions.push(eq(sshKeys.projectId, input.projectId));
      }

      const keys = await ctx.db.query.sshKeys.findMany({
        where: and(...conditions),
        columns: {
          id: true,
          orgId: true,
          projectId: true,
          name: true,
          publicKey: true,
          fingerprint: true,
          keyType: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return keys;
    }),

  /** Generate a new SSH key pair. Returns the public key. */
  generate: protectedProcedure
    .input(generateSshKeySchema)
    .mutation(async ({ input, ctx }) => {
      const { publicKey, privateKey } = generateEd25519KeyPair();
      const fingerprint = computeFingerprint(publicKey);
      const encryptedPrivateKey = encrypt(privateKey);

      const id = generateId();

      await ctx.db.insert(sshKeys).values({
        id,
        orgId: ctx.orgId,
        projectId: input.projectId ?? null,
        name: input.name,
        publicKey,
        encryptedPrivateKey,
        fingerprint,
        keyType: input.keyType,
      });

      logger.info(
        {
          keyId: id,
          orgId: ctx.orgId,
          projectId: input.projectId,
          name: input.name,
        },
        "SSH key generated"
      );

      return {
        id,
        name: input.name,
        publicKey,
        fingerprint,
        keyType: input.keyType,
      };
    }),

  /** Get key details (public key only, never private). */
  get: protectedProcedure
    .input(getSshKeySchema)
    .query(async ({ input, ctx }) => {
      const key = await ctx.db.query.sshKeys.findFirst({
        where: and(eq(sshKeys.id, input.keyId), eq(sshKeys.orgId, ctx.orgId)),
        columns: {
          id: true,
          orgId: true,
          projectId: true,
          name: true,
          publicKey: true,
          fingerprint: true,
          keyType: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SSH key not found",
        });
      }

      return key;
    }),

  /** Delete an SSH key. */
  delete: protectedProcedure
    .input(deleteSshKeySchema)
    .mutation(async ({ input, ctx }) => {
      const key = await ctx.db.query.sshKeys.findFirst({
        where: and(eq(sshKeys.id, input.keyId), eq(sshKeys.orgId, ctx.orgId)),
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SSH key not found",
        });
      }

      await ctx.db
        .delete(sshKeys)
        .where(and(eq(sshKeys.id, input.keyId), eq(sshKeys.orgId, ctx.orgId)));

      logger.info({ keyId: input.keyId, orgId: ctx.orgId }, "SSH key deleted");

      return { success: true };
    }),

  /** Get just the public key text for copying to external services. */
  getPublicKey: protectedProcedure
    .input(getPublicKeySchema)
    .query(async ({ input, ctx }) => {
      const key = await ctx.db.query.sshKeys.findFirst({
        where: and(eq(sshKeys.id, input.keyId), eq(sshKeys.orgId, ctx.orgId)),
        columns: { publicKey: true },
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SSH key not found",
        });
      }

      return { publicKey: key.publicKey };
    }),
});
