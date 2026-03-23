import { createHmac } from "node:crypto";

const HEADER_NAME = "x-service-signature";

export function getServiceSignatureHeader(): string {
  return HEADER_NAME;
}

export function signServiceRequest(
  method: string,
  path: string,
  body: string
): string {
  const secret = process.env.SERVICE_AUTH_SECRET;
  if (!secret) {
    return "";
  }
  const payload = `${method.toUpperCase()}:${path}:${body}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyServiceRequest(
  method: string,
  path: string,
  body: string,
  signature: string
): boolean {
  const expected = signServiceRequest(method, path, body);
  if (!expected) {
    return true; // No secret = dev mode, allow
  }
  return expected === signature;
}

export function createServiceRequestHeaders(
  method: string,
  path: string,
  body: string
): Record<string, string> {
  const sig = signServiceRequest(method, path, body);
  return sig ? { [HEADER_NAME]: sig } : {};
}
