/**
 * Parse and validate the base64url-encoded OAuth state parameter.
 * Returns null if the state is invalid.
 */
export function parseOAuthState(
  state: string
): { userId: string; orgId: string } | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8")
    ) as { userId?: string; orgId?: string };

    if (parsed.userId && parsed.orgId) {
      return { userId: parsed.userId, orgId: parsed.orgId };
    }
    return null;
  } catch {
    return null;
  }
}
