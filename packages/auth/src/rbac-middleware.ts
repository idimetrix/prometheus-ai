import { createLogger } from "@prometheus/logger";
import type { AuthContext, OrgRole } from "./server";

const logger = createLogger("auth:rbac");

// ---------------------------------------------------------------------------
// Permission Levels (hierarchical)
// ---------------------------------------------------------------------------

export const PERMISSION_LEVELS = [
  "viewer",
  "member",
  "admin",
  "owner",
] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

// ---------------------------------------------------------------------------
// Resource Actions
// ---------------------------------------------------------------------------

export type ResourceAction = "read" | "write" | "delete" | "manage" | "admin";

/**
 * Maps resource actions to the minimum permission level required.
 */
const ACTION_PERMISSION_MAP: Record<ResourceAction, PermissionLevel> = {
  read: "viewer",
  write: "member",
  delete: "admin",
  manage: "admin",
  admin: "owner",
};

// ---------------------------------------------------------------------------
// Permission Store Interface (swappable backend)
// ---------------------------------------------------------------------------

/**
 * Interface for permission backends. The default implementation uses a
 * simple role-based check, but this can be swapped for OpenFGA, Oso,
 * or any other authorization engine.
 */
export interface PermissionStore {
  check(params: PermissionCheckParams): Promise<PermissionCheckResult>;
}

export interface PermissionCheckParams {
  action: ResourceAction;
  orgId: string;
  resource: string;
  resourceId?: string;
  userId: string;
  userRole: OrgRole | null;
}

export interface PermissionCheckResult {
  allowed: boolean;
  cachedAt?: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Redis Permission Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  expiresAt: number;
  result: PermissionCheckResult;
}

/**
 * Interface for a Redis-like cache client.
 * Accepts any object with get/set/del methods that return promises.
 */
export interface RbacCacheClient {
  del(key: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    flag: string,
    ttlSec: number
  ): Promise<unknown>;
}

/**
 * In-memory fallback cache when Redis is unavailable.
 */
class InMemoryPermissionCache {
  private readonly store = new Map<string, CacheEntry>();

  get(key: string): PermissionCheckResult | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return { ...entry.result, cachedAt: entry.expiresAt - CACHE_TTL_MS };
  }

  set(key: string, result: PermissionCheckResult): void {
    this.store.set(key, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  invalidate(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Default Permission Store (role-based)
// ---------------------------------------------------------------------------

/**
 * Default role-based permission store.
 * Maps org roles to permission levels and checks hierarchy.
 */
class RoleBasedPermissionStore implements PermissionStore {
  /**
   * Custom overrides per resource type.
   * E.g., { "billing": { read: "admin", write: "owner" } }
   */
  private readonly resourceOverrides: Record<
    string,
    Partial<Record<ResourceAction, PermissionLevel>>
  >;

  constructor(
    overrides?: Record<string, Partial<Record<ResourceAction, PermissionLevel>>>
  ) {
    this.resourceOverrides = overrides ?? {};
  }

  check(params: PermissionCheckParams): Promise<PermissionCheckResult> {
    const { action, resource, userRole } = params;

    if (!userRole) {
      return Promise.resolve({
        allowed: false,
        reason: "No org role assigned",
      });
    }

    // Determine the required permission level
    const overrides = this.resourceOverrides[resource];
    const requiredLevel = overrides?.[action] ?? ACTION_PERMISSION_MAP[action];

    if (!requiredLevel) {
      return Promise.resolve({
        allowed: false,
        reason: `Unknown action: ${action}`,
      });
    }

    // Map org role to permission level
    const userLevel = orgRoleToPermissionLevel(userRole);
    const userRank = PERMISSION_RANK[userLevel];
    const requiredRank = PERMISSION_RANK[requiredLevel];

    const allowed = userRank >= requiredRank;

    return Promise.resolve({
      allowed,
      reason: allowed
        ? undefined
        : `Requires ${requiredLevel} permission, user has ${userLevel}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map an OrgRole to a PermissionLevel.
 */
function orgRoleToPermissionLevel(role: OrgRole): PermissionLevel {
  switch (role) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "member":
      return "member";
    default:
      return "viewer";
  }
}

function buildCacheKey(params: PermissionCheckParams): string {
  return `rbac:${params.orgId}:${params.userId}:${params.resource}:${params.resourceId ?? "*"}:${params.action}`;
}

// ---------------------------------------------------------------------------
// RBAC Middleware
// ---------------------------------------------------------------------------

export interface RbacMiddlewareOptions {
  /** Custom resource overrides for the permission store */
  overrides?: Record<string, Partial<Record<ResourceAction, PermissionLevel>>>;
  /** Optional Redis client for distributed caching */
  redisClient?: RbacCacheClient;
  /** Custom permission store (replaces default role-based store) */
  store?: PermissionStore;
}

/**
 * Creates an RBAC permission checker with 30s Redis/memory cache.
 *
 * Usage in tRPC:
 * ```ts
 * const rbac = createRbacMiddleware();
 * const result = await rbac.check({
 *   userId: ctx.auth.userId,
 *   orgId: ctx.auth.orgId,
 *   userRole: ctx.auth.orgRole,
 *   resource: "sessions",
 *   action: "write",
 * });
 * if (!result.allowed) throw new TRPCError({ code: "FORBIDDEN" });
 * ```
 */
export function createRbacMiddleware(options?: RbacMiddlewareOptions) {
  const store: PermissionStore =
    options?.store ?? new RoleBasedPermissionStore(options?.overrides);
  const memoryCache = new InMemoryPermissionCache();
  const redisClient = options?.redisClient;

  async function getFromRedis(
    key: string
  ): Promise<PermissionCheckResult | null> {
    if (!redisClient) {
      return null;
    }
    try {
      const cached = await redisClient.get(key);
      if (cached) {
        return JSON.parse(cached) as PermissionCheckResult;
      }
    } catch {
      // Fall back to memory cache on Redis error
    }
    return null;
  }

  async function setInRedis(
    key: string,
    result: PermissionCheckResult
  ): Promise<void> {
    if (!redisClient) {
      return;
    }
    try {
      await redisClient.set(
        key,
        JSON.stringify(result),
        "EX",
        Math.ceil(CACHE_TTL_MS / 1000)
      );
    } catch {
      // Ignore cache write failures
    }
  }

  return {
    /**
     * Check if a user has permission to perform an action on a resource.
     * Results are cached for 30 seconds.
     */
    async check(params: PermissionCheckParams): Promise<PermissionCheckResult> {
      const cacheKey = buildCacheKey(params);

      // Check memory cache first
      const memoryCached = memoryCache.get(cacheKey);
      if (memoryCached) {
        return memoryCached;
      }

      // Check Redis cache
      const redisCached = await getFromRedis(cacheKey);
      if (redisCached) {
        memoryCache.set(cacheKey, redisCached);
        return redisCached;
      }

      // Perform the actual permission check
      const result = await store.check(params);

      // Cache the result
      memoryCache.set(cacheKey, result);
      await setInRedis(cacheKey, result);

      if (!result.allowed) {
        logger.warn(
          {
            userId: params.userId,
            orgId: params.orgId,
            resource: params.resource,
            action: params.action,
            reason: result.reason,
          },
          "RBAC permission denied"
        );
      }

      return result;
    },

    /**
     * Invalidate cached permissions for a user in an org.
     * Call this when roles change.
     */
    async invalidate(orgId: string, userId: string): Promise<void> {
      const pattern = `${orgId}:${userId}`;
      memoryCache.invalidate(pattern);

      if (redisClient) {
        try {
          // Delete known cache keys for this user/org combination
          const actions: ResourceAction[] = [
            "read",
            "write",
            "delete",
            "manage",
            "admin",
          ];
          const resources = [
            "sessions",
            "projects",
            "fleet",
            "billing",
            "settings",
            "members",
            "apiKeys",
          ];
          const promises: Promise<unknown>[] = [];
          for (const resource of resources) {
            for (const action of actions) {
              promises.push(
                redisClient.del(
                  `rbac:${orgId}:${userId}:${resource}:*:${action}`
                )
              );
            }
          }
          await Promise.allSettled(promises);
        } catch {
          // Ignore cache invalidation errors
        }
      }

      logger.info({ orgId, userId }, "RBAC cache invalidated");
    },

    /**
     * Create a tRPC-compatible middleware function that checks permissions.
     */
    requirePermission(resource: string, action: ResourceAction) {
      return (ctx: { auth: AuthContext }): Promise<PermissionCheckResult> => {
        const { auth } = ctx;
        if (!auth.orgId) {
          return Promise.resolve({
            allowed: false,
            reason: "No org context",
          });
        }

        return this.check({
          userId: auth.userId,
          orgId: auth.orgId,
          userRole: auth.orgRole,
          resource,
          action,
        });
      };
    },
  };
}

export type RbacMiddleware = ReturnType<typeof createRbacMiddleware>;
