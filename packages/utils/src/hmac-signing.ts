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

/**
 * Get the HMAC signature header name.
 */
export function getSignatureHeaderName(): string {
  return SIGNATURE_HEADER;
}
