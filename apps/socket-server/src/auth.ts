import { getAuthContext } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import type { Socket } from "socket.io";

const logger = createLogger("socket-server:auth");

/** Time before JWT expiry to emit warning (5 minutes) */
const TOKEN_EXPIRY_WARNING_MS = 5 * 60 * 1000;

export interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    orgId: string | null;
    orgRole: string | null;
    tokenExpiresAt?: number;
    expiryTimer?: ReturnType<typeof setTimeout>;
  };
}

/**
 * Parse JWT payload to extract expiration time without full verification.
 * Returns the exp claim as a millisecond timestamp, or null if not present.
 */
function getTokenExpiry(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = JSON.parse(
      Buffer.from(parts[1] as string, "base64url").toString()
    ) as Record<string, unknown>;
    if (typeof payload.exp === "number") {
      return payload.exp * 1000; // Convert seconds to milliseconds
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Schedule a token_expiring event to be emitted 5 minutes before JWT expiry.
 * Also sets up automatic disconnect when the token actually expires.
 */
function scheduleTokenExpiryWarning(socket: AuthenticatedSocket): void {
  const expiresAt = socket.data.tokenExpiresAt;
  if (!expiresAt) {
    return;
  }

  // Clear any existing timer
  if (socket.data.expiryTimer) {
    clearTimeout(socket.data.expiryTimer);
  }

  const now = Date.now();
  const timeUntilExpiry = expiresAt - now;

  if (timeUntilExpiry <= 0) {
    // Token already expired
    logger.warn(
      { userId: socket.data.userId },
      "Token already expired, disconnecting"
    );
    socket.emit("token_expired");
    socket.disconnect(true);
    return;
  }

  // Schedule warning before expiry
  const warningDelay = timeUntilExpiry - TOKEN_EXPIRY_WARNING_MS;
  if (warningDelay > 0) {
    socket.data.expiryTimer = setTimeout(() => {
      logger.info(
        {
          userId: socket.data.userId,
          expiresAt: new Date(expiresAt).toISOString(),
        },
        "Token expiring soon, notifying client"
      );
      socket.emit("token_expiring", {
        expiresAt,
        expiresIn: TOKEN_EXPIRY_WARNING_MS,
      });

      // Schedule disconnect at actual expiry
      const disconnectTimer = setTimeout(() => {
        logger.warn(
          { userId: socket.data.userId },
          "Token expired, disconnecting socket"
        );
        socket.emit("token_expired");
        socket.disconnect(true);
      }, TOKEN_EXPIRY_WARNING_MS);

      // Store so it can be cleaned up
      socket.data.expiryTimer = disconnectTimer;
    }, warningDelay);
  } else {
    // Less than 5 minutes until expiry - emit warning immediately
    socket.emit("token_expiring", {
      expiresAt,
      expiresIn: timeUntilExpiry,
    });

    // Schedule disconnect at actual expiry
    socket.data.expiryTimer = setTimeout(() => {
      logger.warn(
        { userId: socket.data.userId },
        "Token expired, disconnecting socket"
      );
      socket.emit("token_expired");
      socket.disconnect(true);
    }, timeUntilExpiry);
  }
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

      const authSocket = socket as AuthenticatedSocket;
      authSocket.data.userId = ctx.userId;
      authSocket.data.orgId = ctx.orgId;
      authSocket.data.orgRole = ctx.orgRole;

      // Extract token expiry and schedule warnings
      const expiresAt = getTokenExpiry(token);
      if (expiresAt) {
        authSocket.data.tokenExpiresAt = expiresAt;
        scheduleTokenExpiryWarning(authSocket);
      }

      logger.debug({ userId: ctx.userId }, "Socket authenticated");
      next();
    })
    .catch((error) => {
      logger.error({ error }, "Socket auth error");
      next(new Error("Authentication failed"));
    });
}

/**
 * Register the refresh_token handler on an authenticated socket.
 * Validates the new token and reschedules expiry warnings.
 */
export function registerTokenRefreshHandler(socket: AuthenticatedSocket): void {
  socket.on(
    "refresh_token",
    (
      data: { token?: string },
      ack?: (result: { success: boolean; error?: string }) => void
    ) => {
      const newToken = data?.token;
      if (!newToken) {
        logger.warn(
          { userId: socket.data.userId },
          "Token refresh attempted without token"
        );
        if (ack) {
          ack({ success: false, error: "Token is required" });
        }
        return;
      }

      getAuthContext(newToken)
        .then((ctx) => {
          if (!ctx) {
            logger.warn(
              { userId: socket.data.userId },
              "Token refresh failed: invalid new token"
            );
            if (ack) {
              ack({ success: false, error: "Invalid token" });
            }
            return;
          }

          // Verify same user
          if (ctx.userId !== socket.data.userId) {
            logger.warn(
              {
                existingUserId: socket.data.userId,
                newUserId: ctx.userId,
              },
              "Token refresh failed: user mismatch"
            );
            if (ack) {
              ack({ success: false, error: "User mismatch" });
            }
            return;
          }

          // Update socket data
          socket.data.orgId = ctx.orgId;
          socket.data.orgRole = ctx.orgRole;

          // Update expiry and reschedule warnings
          const expiresAt = getTokenExpiry(newToken);
          if (expiresAt) {
            socket.data.tokenExpiresAt = expiresAt;
            scheduleTokenExpiryWarning(socket);
          }

          logger.info({ userId: ctx.userId }, "Token refreshed successfully");
          if (ack) {
            ack({ success: true });
          }
        })
        .catch((error) => {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(
            { userId: socket.data.userId, error: msg },
            "Token refresh error"
          );
          if (ack) {
            ack({ success: false, error: "Token refresh failed" });
          }
        });
    }
  );

  // Clean up expiry timer on disconnect
  socket.on("disconnect", () => {
    if (socket.data.expiryTimer) {
      clearTimeout(socket.data.expiryTimer);
    }
  });
}
