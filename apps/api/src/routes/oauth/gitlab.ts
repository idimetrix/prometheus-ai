import { db, oauthTokens } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { encrypt, generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { parseOAuthState } from "./utils";

const logger = createLogger("api:oauth:gitlab");

const GITLAB_CLIENT_ID = process.env.GITLAB_OAUTH_CLIENT_ID ?? "";
const GITLAB_CLIENT_SECRET = process.env.GITLAB_OAUTH_CLIENT_SECRET ?? "";
const GITLAB_REDIRECT_URI =
  process.env.GITLAB_OAUTH_REDIRECT_URI ??
  "http://localhost:4000/oauth/gitlab/callback";

const SCOPES = "api read_repository";

interface GitLabTokenResponse {
  access_token?: string;
  created_at?: number;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

async function exchangeCodeForToken(
  code: string
): Promise<GitLabTokenResponse> {
  const resp = await fetch("https://gitlab.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: GITLAB_CLIENT_ID,
      client_secret: GITLAB_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: GITLAB_REDIRECT_URI,
    }),
  });
  return (await resp.json()) as GitLabTokenResponse;
}

async function fetchGitLabUser(accessToken: string) {
  const resp = await fetch("https://gitlab.com/api/v4/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (await resp.json()) as { id?: number; username?: string };
}

async function upsertOAuthToken(
  orgId: string,
  userId: string,
  tokenData: GitLabTokenResponse,
  userData: { id?: number; username?: string }
) {
  const encryptedAccessToken = encrypt(tokenData.access_token ?? "");
  const encryptedRefreshToken = tokenData.refresh_token
    ? encrypt(tokenData.refresh_token)
    : null;
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  const existing = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.orgId, orgId),
      eq(oauthTokens.userId, userId),
      eq(oauthTokens.provider, "gitlab")
    ),
  });

  const values = {
    accessToken: encryptedAccessToken,
    refreshToken: encryptedRefreshToken,
    expiresAt,
    scopes: tokenData.scope ?? SCOPES,
    providerAccountId: userData.id ? String(userData.id) : null,
    providerUsername: userData.username ?? null,
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
      provider: "gitlab",
      ...values,
    });
  }
}

export const gitlabOAuthApp = new Hono();

gitlabOAuthApp.get("/authorize", (c) => {
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
    client_id: GITLAB_CLIENT_ID,
    redirect_uri: GITLAB_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    state,
  });

  return c.redirect(`https://gitlab.com/oauth/authorize?${params.toString()}`);
});

gitlabOAuthApp.get("/callback", async (c) => {
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
        "GitLab OAuth token exchange failed"
      );
      return c.json(
        { error: tokenData.error_description ?? "Token exchange failed" },
        400
      );
    }

    const userData = await fetchGitLabUser(tokenData.access_token);
    await upsertOAuthToken(orgId, userId, tokenData, userData);

    logger.info(
      { orgId, userId, provider: "gitlab", username: userData.username },
      "GitLab OAuth connected"
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    return c.redirect(
      `${frontendUrl}/dashboard/projects/import?provider=gitlab&connected=true`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ error: msg }, "GitLab OAuth callback failed");
    return c.json({ error: "OAuth callback failed" }, 500);
  }
});
