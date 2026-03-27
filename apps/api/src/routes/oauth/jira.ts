import { db, oauthTokens } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { encrypt, generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { parseOAuthState } from "./utils";

const logger = createLogger("api:oauth:jira");

const JIRA_CLIENT_ID = process.env.JIRA_CLIENT_ID ?? "";
const JIRA_CLIENT_SECRET = process.env.JIRA_CLIENT_SECRET ?? "";
const JIRA_REDIRECT_URI =
  process.env.JIRA_REDIRECT_URI ?? "http://localhost:4000/oauth/jira/callback";

const SCOPES = "read:jira-work write:jira-work read:jira-user offline_access";

interface JiraTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface AtlassianResource {
  avatarUrl: string;
  id: string;
  name: string;
  scopes: string[];
  url: string;
}

interface AtlassianUser {
  account_id?: string;
  email?: string;
  name?: string;
}

async function exchangeCodeForToken(code: string): Promise<JiraTokenResponse> {
  const resp = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: JIRA_CLIENT_ID,
      client_secret: JIRA_CLIENT_SECRET,
      code,
      redirect_uri: JIRA_REDIRECT_URI,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.error(
      { status: resp.status, body: text },
      "Jira token exchange HTTP error"
    );
    return { error: "token_exchange_failed", error_description: text };
  }

  return (await resp.json()) as JiraTokenResponse;
}

async function fetchAccessibleResources(
  accessToken: string
): Promise<AtlassianResource[]> {
  const resp = await fetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!resp.ok) {
    logger.warn(
      { status: resp.status },
      "Failed to fetch Jira accessible resources"
    );
    return [];
  }

  return (await resp.json()) as AtlassianResource[];
}

async function fetchAtlassianUser(accessToken: string): Promise<AtlassianUser> {
  const resp = await fetch("https://api.atlassian.com/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    logger.warn({ status: resp.status }, "Failed to fetch Atlassian user info");
    return {};
  }

  return (await resp.json()) as AtlassianUser;
}

async function upsertOAuthToken(
  orgId: string,
  userId: string,
  tokenData: JiraTokenResponse,
  domain: string,
  email: string
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
      eq(oauthTokens.provider, "jira")
    ),
  });

  const values = {
    accessToken: encryptedAccessToken,
    refreshToken: encryptedRefreshToken,
    expiresAt,
    scopes: tokenData.scope ?? SCOPES,
    providerAccountId: domain || null,
    providerUsername: email || null,
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
      provider: "jira",
      ...values,
    });
  }
}

export const jiraOAuthApp = new Hono();

jiraOAuthApp.get("/authorize", (c) => {
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

  const url = new URL("https://auth.atlassian.com/authorize");
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", JIRA_CLIENT_ID);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("redirect_uri", JIRA_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");

  return c.redirect(url.toString());
});

jiraOAuthApp.get("/callback", async (c) => {
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
        "Jira OAuth token exchange failed"
      );
      return c.json(
        { error: tokenData.error_description ?? "Token exchange failed" },
        400
      );
    }

    // Fetch accessible Jira sites
    const resources = await fetchAccessibleResources(tokenData.access_token);
    let domain = "";
    if (resources.length > 0 && resources[0]) {
      domain = resources[0].url.replace("https://", "");
    }

    // Fetch Atlassian user profile
    const userData = await fetchAtlassianUser(tokenData.access_token);
    const email = userData.email ?? "";

    await upsertOAuthToken(orgId, userId, tokenData, domain, email);

    logger.info(
      { orgId, userId, provider: "jira", domain },
      "Jira OAuth connected"
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    return c.redirect(
      `${frontendUrl}/dashboard/settings?tab=integrations&provider=jira&status=connected`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ error: msg }, "Jira OAuth callback failed");
    return c.json({ error: "OAuth callback failed" }, 500);
  }
});
