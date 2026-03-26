import { createHash, randomBytes } from "node:crypto";
import type { AuthContext } from "@prometheus/auth";
import type { ApiKeyScope, Database } from "@prometheus/db";
import { API_KEY_SCOPES, apiKeys } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:v1:api-keys");

const MAX_KEYS_PER_ORG = 25;
const KEY_PREFIX = "pk_live_";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

interface V1Env {
  Variables: {
    apiKeyAuth: AuthContext;
    apiKeyId: string;
    db: Database;
    orgId: string;
    userId: string;
  };
}

const apiKeysV1 = new Hono<V1Env>();

// POST /api/v1/api-keys - Create new API key
apiKeysV1.post("/", async (c) => {
  const auth = c.get("apiKeyAuth");
  const orgId = c.get("orgId");
  const db = c.get("db");

  const body = await c.req.json<{
    expiresAt?: string;
    name: string;
    projectIds?: string[];
    scopes: string[];
  }>();

  if (!(body.name && body.scopes && Array.isArray(body.scopes))) {
    return c.json(
      { error: "Bad Request", message: "name and scopes are required" },
      400
    );
  }

  // Validate scopes
  const validScopes: readonly string[] = API_KEY_SCOPES;
  for (const scope of body.scopes) {
    if (!validScopes.includes(scope)) {
      return c.json(
        { error: "Bad Request", message: `Invalid scope: ${scope}` },
        400
      );
    }
  }

  // Check key limit
  const existingKeys = await db.query.apiKeys.findMany({
    where: and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)),
    columns: { id: true },
  });

  if (existingKeys.length >= MAX_KEYS_PER_ORG) {
    return c.json(
      {
        error: "Precondition Failed",
        message: `Maximum of ${MAX_KEYS_PER_ORG} active API keys per organization`,
      },
      412
    );
  }

  const rawKey = `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  const keyHash = hashKey(rawKey);
  const id = generateId("key");

  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  await db.insert(apiKeys).values({
    id,
    orgId,
    userId: auth.userId,
    keyHash,
    name: body.name,
    scopes: body.scopes as ApiKeyScope[],
    projectIds: body.projectIds ?? null,
    expiresAt,
  });

  logger.info({ orgId, keyId: id }, "API key created via REST API v1");

  return c.json(
    {
      id,
      key: rawKey,
      name: body.name,
      scopes: body.scopes,
      projectIds: body.projectIds ?? null,
      expiresAt: expiresAt?.toISOString() ?? null,
      createdAt: new Date().toISOString(),
      message: "Store this key securely. It will not be shown again.",
    },
    201
  );
});

// GET /api/v1/api-keys - List API keys (without key values)
apiKeysV1.get("/", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");

  const keys = await db.query.apiKeys.findMany({
    where: and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)),
    columns: {
      id: true,
      name: true,
      scopes: true,
      projectIds: true,
      lastUsed: true,
      expiresAt: true,
      requestCount: true,
      createdAt: true,
    },
    orderBy: [desc(apiKeys.createdAt)],
  });

  return c.json({
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      scopes: k.scopes,
      projectIds: k.projectIds,
      lastUsed: k.lastUsed?.toISOString() ?? null,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      requestCount: k.requestCount,
      createdAt: k.createdAt.toISOString(),
    })),
  });
});

// DELETE /api/v1/api-keys/:id - Revoke key
apiKeysV1.delete("/:id", async (c) => {
  const orgId = c.get("orgId");
  const db = c.get("db");
  const keyId = c.req.param("id");

  const [updated] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.orgId, orgId),
        isNull(apiKeys.revokedAt)
      )
    )
    .returning();

  if (!updated) {
    return c.json(
      { error: "Not Found", message: "API key not found or already revoked" },
      404
    );
  }

  logger.info({ orgId, keyId }, "API key revoked via REST API v1");

  return c.json({ id: keyId, revoked: true });
});

export { apiKeysV1 };
