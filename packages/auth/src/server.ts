import { verifyToken } from "@clerk/backend";

export interface AuthContext {
  userId: string;
  orgId: string | null;
  orgRole: string | null;
  sessionId: string;
}

export async function getAuthContext(token: string): Promise<AuthContext | null> {
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new Error("CLERK_SECRET_KEY is required");

    const session = await verifyToken(token, { secretKey });
    if (!session) return null;

    return {
      userId: session.sub,
      orgId: (session as Record<string, unknown>).org_id as string | null ?? null,
      orgRole: (session as Record<string, unknown>).org_role as string | null ?? null,
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
