import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("utils:envelope-encryption");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EncryptedPayload {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded encrypted data encryption key */
  dekEncrypted: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Encryption version for rotation support */
  version: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const DEK_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

// ─── Master Key ───────────────────────────────────────────────────────────────

function getMasterKey(): Buffer {
  const key = process.env.KMS_MASTER_KEY ?? process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "KMS_MASTER_KEY or ENCRYPTION_KEY environment variable is required"
    );
  }
  return Buffer.from(key, "hex");
}

// ─── Internal: Encrypt/Decrypt DEK with master key ────────────────────────────

function encryptDek(dek: Buffer, masterKey: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptDek(encryptedDek: string, masterKey: Buffer): Buffer {
  const data = Buffer.from(encryptedDek, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ─── Envelope Encryption ──────────────────────────────────────────────────────

/**
 * Envelope encryption: KMS master key encrypts per-org DEKs, DEKs encrypt data.
 *
 * This provides key hierarchy separation so that rotating the master key
 * only requires re-encrypting DEKs, not all data.
 */
export class EnvelopeEncryption {
  private readonly orgDeks = new Map<
    string,
    { dek: Buffer; encrypted: string; version: number }
  >();
  private currentVersion = 1;

  /**
   * Generate or retrieve the data encryption key for an organization.
   */
  private getOrgDek(orgId: string): {
    dek: Buffer;
    encrypted: string;
    version: number;
  } {
    const existing = this.orgDeks.get(orgId);
    if (existing) {
      return existing;
    }

    // Generate a new DEK for this org
    const dek = randomBytes(DEK_LENGTH);
    const masterKey = getMasterKey();
    const encrypted = encryptDek(dek, masterKey);
    const entry = { dek, encrypted, version: this.currentVersion };
    this.orgDeks.set(orgId, entry);

    logger.info(
      { orgId, version: this.currentVersion },
      "Generated new DEK for org"
    );
    return entry;
  }

  /**
   * Encrypt plaintext for a specific organization.
   */
  encryptForOrg(orgId: string, plaintext: string): EncryptedPayload {
    const { dek, encrypted: dekEncrypted, version } = this.getOrgDek(orgId);

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, dek, iv);
    const encryptedData = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: Buffer.concat([authTag, encryptedData]).toString("base64"),
      iv: iv.toString("base64"),
      dekEncrypted,
      version,
    };
  }

  /**
   * Decrypt a payload for a specific organization.
   */
  decryptForOrg(_orgId: string, payload: EncryptedPayload): string {
    const masterKey = getMasterKey();
    const dek = decryptDek(payload.dekEncrypted, masterKey);

    const iv = Buffer.from(payload.iv, "base64");
    const ciphertextBuf = Buffer.from(payload.ciphertext, "base64");
    const authTag = ciphertextBuf.subarray(0, AUTH_TAG_LENGTH);
    const encrypted = ciphertextBuf.subarray(AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, dek, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  /**
   * Rotate the data encryption key for an organization.
   * Generates a new DEK and increments the version.
   */
  rotateOrgKey(orgId: string): void {
    this.currentVersion++;
    const dek = randomBytes(DEK_LENGTH);
    const masterKey = getMasterKey();
    const encrypted = encryptDek(dek, masterKey);

    this.orgDeks.set(orgId, {
      dek,
      encrypted,
      version: this.currentVersion,
    });

    logger.info(
      { orgId, newVersion: this.currentVersion },
      "Rotated DEK for org"
    );
  }

  /**
   * Derive a deterministic key fingerprint for an org's current DEK.
   * Useful for verifying key identity without exposing the key.
   */
  getKeyFingerprint(orgId: string): string {
    const { dek } = this.getOrgDek(orgId);
    return createHash("sha256").update(dek).digest("hex").slice(0, 16);
  }
}
