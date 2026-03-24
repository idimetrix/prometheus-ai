import { randomBytes } from "node:crypto";
import { resolve as dnsResolve } from "node:dns/promises";
import { verifyToken } from "@clerk/backend";

// ---------------------------------------------------------------------------
// Role types
// ---------------------------------------------------------------------------

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

/**
 * Returns true if `userRole` meets or exceeds `requiredRole`.
 */
export function hasOrgRole(
  userRole: OrgRole | string | null,
  requiredRole: OrgRole
): boolean {
  if (!userRole) {
    return false;
  }
  const userRank = ORG_ROLE_RANK[userRole as OrgRole] ?? -1;
  const requiredRank = ORG_ROLE_RANK[requiredRole] ?? 0;
  return userRank >= requiredRank;
}

// ---------------------------------------------------------------------------
// Auth context
// ---------------------------------------------------------------------------

export interface AuthContext {
  orgId: string | null;
  orgRole: OrgRole | null;
  sessionId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Dev auth bypass — allows testing without Clerk credentials
// ---------------------------------------------------------------------------

const DEV_TOKEN_PREFIX = "dev_token_";

/**
 * Parse a dev-mode token of the form `dev_token_<userId>` or
 * `dev_token_<userId>__<orgId>` into a synthetic AuthContext.
 *
 * Only active when `DEV_AUTH_BYPASS=true` and `NODE_ENV !== "production"`.
 */
function tryDevAuthBypass(token: string): AuthContext | null {
  if (
    process.env.DEV_AUTH_BYPASS !== "true" ||
    process.env.NODE_ENV === "production"
  ) {
    return null;
  }

  if (!token.startsWith(DEV_TOKEN_PREFIX)) {
    return null;
  }

  const payload = token.slice(DEV_TOKEN_PREFIX.length);
  if (!payload) {
    return null;
  }

  // Format: <userId> or <userId>__<orgId>
  const [userId, orgId] = payload.split("__");

  return {
    userId: userId ?? "usr_seed_dev001",
    orgId: orgId ?? "org_seed_dev001",
    orgRole: "owner",
    sessionId: `dev-session-${userId ?? "usr_seed_dev001"}`,
  };
}

export async function getAuthContext(
  token: string
): Promise<AuthContext | null> {
  // Check for dev auth bypass first
  const devAuth = tryDevAuthBypass(token);
  if (devAuth) {
    return devAuth;
  }

  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      if (process.env.NODE_ENV !== "production") {
        // In development, return null instead of crashing when Clerk is not configured
        return null;
      }
      throw new Error("CLERK_SECRET_KEY is required");
    }

    const session = await verifyToken(token, {
      secretKey,
      // Accept tokens with up to 60s clock skew to avoid spurious rejections
      clockSkewInMs: 60_000,
    });
    if (!session) {
      return null;
    }

    const raw: Record<string, unknown> = session;
    const orgRoleRaw = typeof raw.org_role === "string" ? raw.org_role : null;
    const orgIdRaw = typeof raw.org_id === "string" ? raw.org_id : null;

    let orgRole: OrgRole | null = null;
    if (orgRoleRaw && ORG_ROLES.includes(orgRoleRaw as OrgRole)) {
      orgRole = orgRoleRaw as OrgRole;
    } else if (orgRoleRaw) {
      orgRole = "member";
    }

    return {
      userId: session.sub,
      orgId: orgIdRaw,
      orgRole,
      sessionId: session.sid ?? "",
    };
  } catch {
    return null;
  }
}

export async function requireAuth(token: string): Promise<AuthContext> {
  const ctx = await getAuthContext(token);
  if (!ctx) {
    throw new Error("Unauthorized");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// SSO Domain Verification
// ---------------------------------------------------------------------------

export interface DomainVerification {
  domain: string;
  method: "dns_txt" | "dns_cname" | "meta_tag";
  token: string;
  verified: boolean;
  verifiedAt?: Date;
}

/**
 * Generate a domain verification challenge. The org must prove ownership
 * of the email domain before SSO can be enforced for that domain.
 *
 * Verification methods:
 * - dns_txt: Add a TXT record `_prometheus-verify=<token>` to the domain
 * - dns_cname: Add a CNAME `_prometheus-verify.<domain>` → `verify.prometheus.dev`
 * - meta_tag: Add `<meta name="prometheus-verify" content="<token>">` to root page
 */
export function generateDomainChallenge(
  domain: string,
  method: DomainVerification["method"] = "dns_txt"
): DomainVerification {
  const token = randomBytes(16).toString("hex");

  return {
    domain,
    method,
    token,
    verified: false,
  };
}

/**
 * Verify domain ownership by checking the DNS TXT record.
 * Returns true if the expected token is found.
 */
export async function verifyDomainOwnership(
  challenge: DomainVerification
): Promise<boolean> {
  if (challenge.method === "dns_txt") {
    try {
      const records = await dnsResolve(
        `_prometheus-verify.${challenge.domain}`,
        "TXT"
      );
      const flatRecords = records.map((r) =>
        Array.isArray(r) ? r.join("") : String(r)
      );
      return flatRecords.some((r) => r.includes(challenge.token));
    } catch {
      return false;
    }
  }

  if (challenge.method === "dns_cname") {
    try {
      const records = await dnsResolve(
        `_prometheus-verify.${challenge.domain}`,
        "CNAME"
      );
      return records.some((r) => String(r).includes("verify.prometheus.dev"));
    } catch {
      return false;
    }
  }

  if (challenge.method === "meta_tag") {
    try {
      const response = await fetch(`https://${challenge.domain}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const html = await response.text();
      return html.includes(`content="${challenge.token}"`);
    } catch {
      return false;
    }
  }

  return false;
}
