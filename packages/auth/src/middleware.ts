import { getAuthContext } from "./server";
import type { AuthContext } from "./server";

export interface AuthenticatedRequest {
  auth: AuthContext;
}

export function authMiddleware() {
  return async (req: Request): Promise<AuthContext> => {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.slice(7);
    const ctx = await getAuthContext(token);
    if (!ctx) {
      throw new Error("Invalid token");
    }

    return ctx;
  };
}
