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

export async function getAuthContext(
  token: string
): Promise<AuthContext | null> {
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
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

    const raw = session as Record<string, unknown>;
    const orgRole = (raw.org_role as string | null) ?? null;

    return {
      userId: session.sub,
      orgId: (raw.org_id as string | null) ?? null,
      orgRole: (() => {
        if (orgRole && ORG_ROLES.includes(orgRole as OrgRole)) {
          return orgRole as OrgRole;
        }
        if (orgRole) {
          return "member" as OrgRole;
        }
        return null;
      })(),
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
