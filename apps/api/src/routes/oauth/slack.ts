/**
 * Slack OAuth Flow
 *
 * Handles the OAuth 2.0 flow to install the Prometheus Slack App
 * to a workspace. Stores the bot token in the oauthTokens table.
 *
 * Flow:
 * 1. GET /oauth/slack/authorize?userId=...&orgId=... -> Redirects to Slack
 * 2. Slack redirects to GET /oauth/slack/callback?code=...&state=...
 * 3. Exchange code for bot token, store in DB
 * 4. Redirect user to settings page
 */

import { db, oauthTokens } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { encrypt, generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { parseOAuthState } from "./utils";

const logger = createLogger("api:oauth:slack");

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID ?? "";
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET ?? "";
const SLACK_REDIRECT_URI =
  process.env.SLACK_OAUTH_REDIRECT_URI ??
  "http://localhost:4000/oauth/slack/callback";

const BOT_SCOPES = [
  "chat:write",
  "commands",
  "app_mentions:read",
  "channels:read",
  "groups:read",
  "im:read",
  "im:write",
  "im:history",
  "files:read",
  "reactions:write",
  "users:read",
].join(",");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackOAuthResponse {
  access_token?: string;
  app_id?: string;
  authed_user?: { id: string };
  bot_user_id?: string;
  error?: string;
  ok: boolean;
  scope?: string;
  team?: { id: string; name: string };
  token_type?: string;
}

interface SlackAuthTestResponse {
  ok: boolean;
  team?: string;
  team_id?: string;
  url?: string;
  user?: string;
  user_id?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function exchangeCodeForToken(code: string): Promise<SlackOAuthResponse> {
  const resp = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code,
      redirect_uri: SLACK_REDIRECT_URI,
    }).toString(),
  });

  return (await resp.json()) as SlackOAuthResponse;
}

async function fetchSlackAuthTest(
  token: string
): Promise<SlackAuthTestResponse> {
  const resp = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  return (await resp.json()) as SlackAuthTestResponse;
}

async function upsertSlackOAuthToken(
  orgId: string,
  userId: string,
  encryptedAccessToken: string,
  scopes: string,
  teamId: string | null,
  teamName: string | null
) {
  const existing = await db.query.oauthTokens.findFirst({
    where: and(eq(oauthTokens.orgId, orgId), eq(oauthTokens.provider, "slack")),
  });

  const tokenData = {
    accessToken: encryptedAccessToken,
    refreshToken: null,
    expiresAt: null,
    scopes,
    providerAccountId: teamId,
    providerUsername: teamName,
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
      provider: "slack",
      ...tokenData,
    });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const slackOAuthApp = new Hono();

/**
 * GET /oauth/slack/authorize
 *
 * Initiates the Slack OAuth flow by redirecting the user to Slack's
 * authorization page.
 */
slackOAuthApp.get("/authorize", (c) => {
  const userId = c.req.query("userId");
  const orgId = c.req.query("orgId");

  if (!(userId && orgId)) {
    return c.json(
      { error: "userId and orgId query parameters are required" },
      400
    );
  }

  if (!SLACK_CLIENT_ID) {
    return c.json({ error: "Slack OAuth is not configured" }, 500);
  }

  const state = Buffer.from(JSON.stringify({ userId, orgId })).toString(
    "base64url"
  );

  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    scope: BOT_SCOPES,
    redirect_uri: SLACK_REDIRECT_URI,
    state,
  });

  return c.redirect(
    `https://slack.com/oauth/v2/authorize?${params.toString()}`
  );
});

/**
 * GET /oauth/slack/callback
 *
 * Handles the OAuth callback from Slack, exchanges the code for
 * a bot token, and stores it in the database.
 */
slackOAuthApp.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    logger.warn({ error }, "Slack OAuth flow was denied or errored");
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    return c.redirect(
      `${frontendUrl}/dashboard/settings?tab=integrations&slack=error&reason=${encodeURIComponent(error)}`
    );
  }

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

    if (!(tokenData.ok && tokenData.access_token)) {
      logger.error(
        { error: tokenData.error },
        "Slack OAuth token exchange failed"
      );
      return c.json({ error: tokenData.error ?? "Token exchange failed" }, 400);
    }

    // Verify the token works
    const authTest = await fetchSlackAuthTest(tokenData.access_token);

    const teamId = tokenData.team?.id ?? authTest.team_id ?? null;
    const teamName = tokenData.team?.name ?? authTest.team ?? null;

    await upsertSlackOAuthToken(
      orgId,
      userId,
      encrypt(tokenData.access_token),
      tokenData.scope ?? BOT_SCOPES,
      teamId,
      teamName
    );

    logger.info(
      {
        orgId,
        userId,
        provider: "slack",
        teamId,
        teamName,
      },
      "Slack OAuth connected"
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    return c.redirect(
      `${frontendUrl}/dashboard/settings?tab=integrations&slack=connected`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ error: msg }, "Slack OAuth callback failed");
    return c.json({ error: "OAuth callback failed" }, 500);
  }
});

/**
 * GET /oauth/slack/status
 *
 * Returns the connection status for a given org.
 * Used by the frontend settings page to display workspace info.
 */
slackOAuthApp.get("/status", async (c) => {
  const orgId = c.req.query("orgId");
  if (!orgId) {
    return c.json({ error: "orgId query parameter is required" }, 400);
  }

  const token = await db.query.oauthTokens.findFirst({
    where: and(eq(oauthTokens.orgId, orgId), eq(oauthTokens.provider, "slack")),
  });

  if (!token) {
    return c.json({
      connected: false,
      workspace: null,
    });
  }

  return c.json({
    connected: true,
    workspace: {
      id: token.providerAccountId,
      name: token.providerUsername,
    },
    connectedAt: token.createdAt,
  });
});
