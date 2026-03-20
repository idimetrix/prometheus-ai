import { createHmac, timingSafeEqual } from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("utils:hmac-signing");

const SIGNATURE_HEADER = "X-Prometheus-Signature";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

// ─── Signing ──────────────────────────────────────────────────────────────────

/**
 * Sign an HTTP request using HMAC-SHA256.
 *
 * The signature covers: method + path + body + timestamp.
 *
 * @returns The signature string to set in X-Prometheus-Signature header
 */
export function signRequest(
  method: string,
  path: string,
  body: string,
  secret: string,
  timestamp?: number
): string {
  const ts = timestamp ?? Date.now();
  const payload = `${method.toUpperCase()}\n${path}\n${body}\n${ts}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return `t=${ts},s=${hmac.digest("hex")}`;
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify an HMAC-SHA256 signature from an HTTP request.
 *
 * @returns true if the signature is valid and within the clock skew window
 */
export function verifyRequest(
  method: string,
  path: string,
  body: string,
  signature: string,
  secret: string
): boolean {
  // Parse signature: t=<timestamp>,s=<hex>
  const parts = signature.split(",");
  const tsPart = parts.find((p) => p.startsWith("t="));
  const sigPart = parts.find((p) => p.startsWith("s="));

  if (!(tsPart && sigPart)) {
    return false;
  }

  const timestamp = Number(tsPart.slice(2));
  const providedSig = sigPart.slice(2);

  if (Number.isNaN(timestamp)) {
    return false;
  }

  // Check clock skew
  const now = Date.now();
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) {
    logger.warn(
      { timestamp, now, skewMs: Math.abs(now - timestamp) },
      "HMAC signature rejected: clock skew too large"
    );
    return false;
  }

  // Recompute signature
  const payload = `${method.toUpperCase()}\n${path}\n${body}\n${timestamp}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const expectedSig = hmac.digest("hex");

  // Timing-safe comparison
  try {
    const a = Buffer.from(providedSig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Multi-Key Signing ────────────────────────────────────────────────────────

/**
 * Sign an HTTP request using HMAC-SHA256 with a specific key ID.
 *
 * The key ID is included in the signature header so the verifier knows
 * which key was used. This supports key rotation: deploy a new key,
 * start signing with it, and retire the old key once all services
 * have the new key.
 *
 * @returns The signature string including key ID: `kid=<keyId>,t=<ts>,s=<hex>`
 */
export function signRequestWithKeyId(
  method: string,
  path: string,
  body: string,
  keyId: string,
  secret: string,
  timestamp?: number
): string {
  const ts = timestamp ?? Date.now();
  const payload = `${method.toUpperCase()}\n${path}\n${body}\n${ts}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return `kid=${keyId},t=${ts},s=${hmac.digest("hex")}`;
}

/**
 * Verify an HMAC-SHA256 signature against multiple possible signing keys.
 *
 * Parses the `kid` (key ID) from the signature if present and uses it
 * to look up the correct key. If no `kid` is present, tries all keys
 * until one matches (backward-compatible with single-key signatures).
 *
 * @param keys - Map of key ID to secret (e.g., `{ "v1": "secret1", "v2": "secret2" }`)
 * @returns true if the signature is valid for any of the provided keys
 */
export function verifyRequestMultiKey(
  method: string,
  path: string,
  body: string,
  signature: string,
  keys: Record<string, string>
): boolean {
  // Parse key ID from signature if present
  const parts = signature.split(",");
  const kidPart = parts.find((p) => p.startsWith("kid="));
  const keyId = kidPart?.slice(4);

  // Strip the kid= prefix from the signature for verification
  const signatureWithoutKid = parts
    .filter((p) => !p.startsWith("kid="))
    .join(",");

  if (keyId) {
    // Key ID specified: only try that key
    const secret = keys[keyId];
    if (!secret) {
      logger.warn({ keyId }, "HMAC verification failed: unknown key ID");
      return false;
    }
    return verifyRequest(method, path, body, signatureWithoutKid, secret);
  }

  // No key ID: try all keys (backward compatibility with single-key signatures)
  for (const secret of Object.values(keys)) {
    if (verifyRequest(method, path, body, signature, secret)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the HMAC signature header name.
 */
export function getSignatureHeaderName(): string {
  return SIGNATURE_HEADER;
}
