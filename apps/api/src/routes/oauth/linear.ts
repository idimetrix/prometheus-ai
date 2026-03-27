import { db, oauthTokens } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { encrypt, generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { parseOAuthState } from "./utils";

const logger = createLogger("api:oauth:linear");

const LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID ?? "";
const LINEAR_CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET ?? "";
const LINEAR_REDIRECT_URI =
  process.env.LINEAR_REDIRECT_URI ??
  "http://localhost:4000/oauth/linear/callback";

const SCOPES = "read write issues:create";

interface LinearTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  scope?: string[];
  token_type?: string;
}

interface LinearViewer {
  email?: string;
  id?: string;
  name?: string;
}

interface LinearGraphQLResponse {
  data?: {
    viewer?: LinearViewer;
  };
  errors?: Array<{ message: string }>;
}

async function exchangeCodeForToken(
  code: string
): Promise<LinearTokenResponse> {
  const resp = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: LINEAR_CLIENT_ID,
      client_secret: LINEAR_CLIENT_SECRET,
      code,
      redirect_uri: LINEAR_REDIRECT_URI,
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    logger.error(
      { status: resp.status, body: text },
      "Linear token exchange HTTP error"
    );
    return { error: "token_exchange_failed", error_description: text };
  }

  return (await resp.json()) as LinearTokenResponse;
}

async function fetchLinearViewer(accessToken: string): Promise<LinearViewer> {
  const resp = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "{ viewer { id email name } }",
    }),
  });

  if (!resp.ok) {
    logger.warn({ status: resp.status }, "Failed to fetch Linear viewer");
    return {};
  }

  const body = (await resp.json()) as LinearGraphQLResponse;

  if (body.errors?.length) {
    logger.warn({ errors: body.errors }, "Linear GraphQL errors");
    return {};
  }

  return body.data?.viewer ?? {};
}

async function upsertOAuthToken(
  orgId: string,
  userId: string,
  tokenData: LinearTokenResponse,
  viewer: LinearViewer
) {
  const encryptedAccessToken = encrypt(tokenData.access_token ?? "");
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  const existing = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.orgId, orgId),
      eq(oauthTokens.userId, userId),
      eq(oauthTokens.provider, "linear")
    ),
  });

  const scopeStr = Array.isArray(tokenData.scope)
    ? tokenData.scope.join(" ")
    : SCOPES;

  const values = {
    accessToken: encryptedAccessToken,
    refreshToken: null,
    expiresAt,
    scopes: scopeStr,
    providerAccountId: viewer.id ?? null,
    providerUsername: viewer.email ?? null,
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
      provider: "linear",
      ...values,
    });
  }
}

export const linearOAuthApp = new Hono();

linearOAuthApp.get("/authorize", (c) => {
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

  const url = new URL("https://linear.app/oauth/authorize");
  url.searchParams.set("client_id", LINEAR_CLIENT_ID);
  url.searchParams.set("redirect_uri", LINEAR_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");

  return c.redirect(url.toString());
});

linearOAuthApp.get("/callback", async (c) => {
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
        "Linear OAuth token exchange failed"
      );
      return c.json(
        { error: tokenData.error_description ?? "Token exchange failed" },
        400
      );
    }

    // Fetch the authenticated user's profile via Linear's GraphQL API
    const viewer = await fetchLinearViewer(tokenData.access_token);

    await upsertOAuthToken(orgId, userId, tokenData, viewer);

    logger.info(
      { orgId, userId, provider: "linear", email: viewer.email },
      "Linear OAuth connected"
    );

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    return c.redirect(
      `${frontendUrl}/dashboard/settings?tab=integrations&provider=linear&status=connected`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ error: msg }, "Linear OAuth callback failed");
    return c.json({ error: "OAuth callback failed" }, 500);
  }
});
