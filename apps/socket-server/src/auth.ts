import type { Socket } from "socket.io";
import { getAuthContext } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("socket-server:auth");

export interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    orgId: string | null;
    orgRole: string | null;
  };
}

export function authMiddleware(socket: Socket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token as string | undefined;

  if (!token) {
    logger.warn("Socket connection rejected: no auth token");
    return next(new Error("Authentication required"));
  }

  getAuthContext(token)
    .then((ctx) => {
      if (!ctx) {
        logger.warn("Socket connection rejected: invalid token");
        return next(new Error("Invalid authentication token"));
      }

      socket.data.userId = ctx.userId;
      socket.data.orgId = ctx.orgId;
      socket.data.orgRole = ctx.orgRole;

      logger.debug({ userId: ctx.userId }, "Socket authenticated");
      next();
    })
    .catch((error) => {
      logger.error({ error }, "Socket auth error");
      next(new Error("Authentication failed"));
    });
}
