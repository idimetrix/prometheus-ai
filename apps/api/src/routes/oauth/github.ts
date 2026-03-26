import { db, oauthTokens } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { encrypt, generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { parseOAuthState } from "./utils";

const logger = createLogger("api:oauth:github");

const GITHUB_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "";
const GITHUB_REDIRECT_URI =
  process.env.GITHUB_OAUTH_REDIRECT_URI ??
  "http://localhost:4000/oauth/github/callback";

const SCOPES = "repo read:org";

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  scope?: string;
  token_type?: string;
}

async function exchangeCodeForToken(
  code: string
): Promise<GitHubTokenResponse> {
  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_REDIRECT_URI,
    }),
  });
  return (await resp.json()) as GitHubTokenResponse;
}

async function fetchGitHubUser(accessToken: string) {
  const resp = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  return (await resp.json()) as { id?: number; login?: string };
}

async function upsertOAuthToken(
  orgId: string,
  userId: string,
  encryptedAccessToken: string,
  scopes: string,
  providerAccountId: string | null,
  providerUsername: string | null
) {
  const existing = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.orgId, orgId),
      eq(oauthTokens.userId, userId),
      eq(oauthTokens.provider, "github")
    ),
  });

  const tokenData = {
    accessToken: encryptedAccessToken,
    refreshToken: null,
    expiresAt: null,
    scopes,
    providerAccountId,
    providerUsername,
  };

  if (existing) {
    await db
      .update(oauthTokens)
      .set(tokenData)
      .where(eq(oauthTokens.id, existing.id));
  } else {
    await db.insert(oauthTokens).values({
      id: generateId("oat"),
      orgId,
      userId,
      provider: "github",
      ...tokenData,
    });
  }
}

export const githubOAuthApp = new Hono();

githubOAuthApp.get("/authorize", (c) => {
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
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: SCOPES,
    state,
    allow_signup: "false",
  });

  return c.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  );
});

githubOAuthApp.get("/callback", async (c) => {
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
        "GitHub OAuth token exchange failed"
      );
      return c.json(
        { error: tokenData.error_description ?? "Token exchange failed" },
        400
      );
    }

    const userData = await fetchGitHubUser(tokenData.access_token);

    await upsertOAuthToken(
      orgId,
      userId,
      encrypt(tokenData.access_token),
      tokenData.scope ?? SCOPES,
      userData.id ? String(userData.id) : null,
      userData.login ?? null
    );

    logger.info(
      { orgId, userId, provider: "github", username: userData.login },
      "GitHub OAuth connected"
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    return c.redirect(
      `${frontendUrl}/dashboard/projects/import?provider=github&connected=true`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ error: msg }, "GitHub OAuth callback failed");
    return c.json({ error: "OAuth callback failed" }, 500);
  }
});
