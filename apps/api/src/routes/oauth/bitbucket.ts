import { db, oauthTokens } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { encrypt, generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { parseOAuthState } from "./utils";

const logger = createLogger("api:oauth:bitbucket");

const BITBUCKET_CLIENT_ID = process.env.BITBUCKET_OAUTH_CLIENT_ID ?? "";
const BITBUCKET_CLIENT_SECRET = process.env.BITBUCKET_OAUTH_CLIENT_SECRET ?? "";
const BITBUCKET_REDIRECT_URI =
  process.env.BITBUCKET_OAUTH_REDIRECT_URI ??
  "http://localhost:4000/oauth/bitbucket/callback";

const SCOPES = "repository pullrequest";

interface BitBucketTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
  scopes?: string;
  token_type?: string;
}

async function exchangeCodeForToken(
  code: string
): Promise<BitBucketTokenResponse> {
  const basicAuth = Buffer.from(
    `${BITBUCKET_CLIENT_ID}:${BITBUCKET_CLIENT_SECRET}`
  ).toString("base64");

  const resp = await fetch("https://bitbucket.org/site/oauth2/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: BITBUCKET_REDIRECT_URI,
    }).toString(),
  });
  return (await resp.json()) as BitBucketTokenResponse;
}

async function fetchBitBucketUser(accessToken: string) {
  const resp = await fetch("https://api.bitbucket.org/2.0/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (await resp.json()) as {
    display_name?: string;
    nickname?: string;
    username?: string;
    uuid?: string;
  };
}

async function upsertOAuthToken(
  orgId: string,
  userId: string,
  tokenData: BitBucketTokenResponse,
  userData: { uuid?: string; nickname?: string; username?: string }
) {
  const encryptedAccessToken = encrypt(tokenData.access_token ?? "");
  const encryptedRefreshToken = tokenData.refresh_token
    ? encrypt(tokenData.refresh_token)
    : null;
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;
  const displayName = userData.nickname ?? userData.username ?? null;

  const existing = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.orgId, orgId),
      eq(oauthTokens.userId, userId),
      eq(oauthTokens.provider, "bitbucket")
    ),
  });

  const values = {
    accessToken: encryptedAccessToken,
    refreshToken: encryptedRefreshToken,
    expiresAt,
    scopes: tokenData.scopes ?? SCOPES,
    providerAccountId: userData.uuid ?? null,
    providerUsername: displayName,
  };

  if (existing) {
    await db
      .update(oauthTokens)
      .set(values)
      .where(eq(oauthTokens.id, existing.id));
  } else {
    await db.insert(oauthTokens).values({
      id: generateId("oat"),
      orgId,
      userId,
      provider: "bitbucket",
      ...values,
    });
  }
}

export const bitbucketOAuthApp = new Hono();

bitbucketOAuthApp.get("/authorize", (c) => {
  const userId = c.req.query("userId");
  const orgId = c.req.query("orgId");

  if (!(userId && orgId)) {
    return c.json(
      { error: "userId and orgId query parameters are required" },
      400
    );
  }

  const state = Buffer.from(JSON.stringify({ userId, orgId })).toString(
    "base64url"
  );

  const params = new URLSearchParams({
    client_id: BITBUCKET_CLIENT_ID,
    response_type: "code",
    state,
  });

  return c.redirect(
    `https://bitbucket.org/site/oauth2/authorize?${params.toString()}`
  );
});

bitbucketOAuthApp.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!(code && state)) {
    return c.json({ error: "Missing code or state parameter" }, 400);
  }

  const stateData = parseOAuthState(state);
  if (!stateData) {
    return c.json({ error: "Invalid state parameter" }, 400);
  }

  const { userId, orgId } = stateData;

  try {
    const tokenData = await exchangeCodeForToken(code);

    if (tokenData.error || !tokenData.access_token) {
      logger.error(
        { error: tokenData.error, description: tokenData.error_description },
        "BitBucket OAuth token exchange failed"
      );
      return c.json(
        { error: tokenData.error_description ?? "Token exchange failed" },
        400
      );
    }

    const userData = await fetchBitBucketUser(tokenData.access_token);
    await upsertOAuthToken(orgId, userId, tokenData, userData);

    const displayName = userData.nickname ?? userData.username ?? null;
    logger.info(
      { orgId, userId, provider: "bitbucket", username: displayName },
      "BitBucket OAuth connected"
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    return c.redirect(
      `${frontendUrl}/dashboard/projects/import?provider=bitbucket&connected=true`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ error: msg }, "BitBucket OAuth callback failed");
    return c.json({ error: "OAuth callback failed" }, 500);
  }
});
