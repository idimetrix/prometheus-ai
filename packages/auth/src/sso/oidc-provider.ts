import { createLogger } from "@prometheus/logger";

const logger = createLogger("auth:oidc-provider");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OIDCConfig {
  /** The OAuth 2.0 client ID registered with the IdP */
  clientId: string;
  /** The OAuth 2.0 client secret */
  clientSecret: string;
  /** Clock skew tolerance in seconds for token validation (default: 120) */
  clockSkewToleranceSec?: number;
  /** OpenID Connect issuer URL (used for discovery) */
  issuerUrl: string;
  /** Post-logout redirect URI for RP-initiated logout */
  postLogoutRedirectUri?: string;
  /** The redirect URI (callback URL) for the authorization code flow */
  redirectUri: string;
  /** Scopes to request (defaults to ["openid", "profile", "email"]) */
  scopes?: string[];
}

export interface OIDCUser {
  /** Raw claims from the ID token / userinfo endpoint */
  claims: Record<string, unknown>;
  email: string;
  emailVerified: boolean;
  familyName: string;
  givenName: string;
  name: string;
  picture?: string;
  /** Subject identifier from the ID token */
  sub: string;
}

export interface OIDCAuthResult {
  /** The raw access token from the token exchange */
  accessToken: string;
  /** Token expiry in seconds */
  expiresIn: number;
  /** The raw ID token (JWT) */
  idToken: string;
  /** Refresh token, if provided */
  refreshToken?: string;
  /** The authenticated user */
  user: OIDCUser;
}

export interface OIDCTokenRefreshResult {
  /** The new access token */
  accessToken: string;
  /** Token expiry in seconds */
  expiresIn: number;
  /** New ID token, if the IdP issued one */
  idToken?: string;
  /** New refresh token, if rotated by the IdP */
  refreshToken?: string;
}

export interface OIDCDiscovery {
  authorization_endpoint: string;
  end_session_endpoint?: string;
  issuer: string;
  jwks_uri: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

interface TokenResponseBody {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
  token_type: string;
}

// ---------------------------------------------------------------------------
// Top-level regex for JWT segment extraction (per useTopLevelRegex)
// ---------------------------------------------------------------------------

const JWT_SEGMENTS_RE = /^[\w-]+\.([\w-]+)\.[\w-]+$/;

// ---------------------------------------------------------------------------
// OpenID Connect Provider
// ---------------------------------------------------------------------------

/**
 * Production-ready OpenID Connect SSO provider.
 *
 * Implements the Authorization Code Flow with support for:
 *  - OIDC Discovery (/.well-known/openid-configuration)
 *  - Authorization URL generation with state and nonce
 *  - Token exchange (authorization code for tokens)
 *  - UserInfo endpoint retrieval
 *  - Token refresh via refresh_token grant
 *  - RP-Initiated Logout (end_session_endpoint)
 *  - Basic JWT payload decoding for ID token claims
 */
export class OIDCProvider {
  private readonly config: OIDCConfig;
  private readonly scopes: string[];
  private readonly clockSkewToleranceSec: number;
  private discoveryCache: OIDCDiscovery | null = null;

  /** In-flight state values for CSRF protection */
  private readonly pendingStates = new Map<
    string,
    { issuedAt: Date; nonce?: string }
  >();

  constructor(config: OIDCConfig) {
    this.config = config;
    this.scopes = config.scopes ?? ["openid", "profile", "email"];
    this.clockSkewToleranceSec = config.clockSkewToleranceSec ?? 120;

    logger.info(
      { issuerUrl: config.issuerUrl, clientId: config.clientId },
      "OIDC provider initialized"
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate the authorization URL to redirect the user to the IdP.
   *
   * @param state - Opaque state value for CSRF protection
   * @param nonce - Nonce value to bind the ID token to the session
   * @returns The full authorization URL to redirect the user to
   */
  async getAuthUrl(state: string, nonce?: string): Promise<string> {
    const discovery = await this.discover();
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: this.scopes.join(" "),
      state,
    });

    if (nonce) {
      params.set("nonce", nonce);
    }

    // Track the state for validation on callback
    this.pendingStates.set(state, { issuedAt: new Date(), nonce });
    this.pruneExpiredStates();

    const authUrl = `${discovery.authorization_endpoint}?${params.toString()}`;

    logger.info({ state }, "OIDC authorization URL generated");

    return authUrl;
  }

  /**
   * Handle the authorization callback by exchanging the code for tokens.
   *
   * Validates the state parameter, exchanges the authorization code,
   * and fetches user information from the userinfo endpoint.
   *
   * @param code - The authorization code from the callback
   * @param state - The state parameter to validate against pending states
   * @returns The token exchange result including access token, ID token, and user info
   */
  async handleCallback(code: string, state?: string): Promise<OIDCAuthResult> {
    // Validate state if provided
    if (state) {
      const pending = this.pendingStates.get(state);
      if (!pending) {
        logger.warn({ state }, "Unknown or expired state parameter");
        throw new OIDCError("Invalid or expired state parameter");
      }
      this.pendingStates.delete(state);
    }

    const discovery = await this.discover();

    logger.info("Exchanging authorization code for tokens");

    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error(
        { status: tokenResponse.status, error: errorText },
        "Token exchange failed"
      );
      throw new OIDCError(
        `Token exchange failed: ${tokenResponse.status} - ${errorText}`
      );
    }

    const tokens = (await tokenResponse.json()) as TokenResponseBody;

    // Fetch user info from the userinfo endpoint
    const user = await this.getUserInfo(tokens.access_token);

    logger.info(
      { email: user.email, sub: user.sub },
      "OIDC user authenticated"
    );

    return {
      user,
      accessToken: tokens.access_token,
      idToken: tokens.id_token ?? "",
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
    };
  }

  /**
   * Fetch user information from the IdP's userinfo endpoint.
   *
   * @param accessToken - A valid access token
   * @returns The user's profile information
   */
  async getUserInfo(accessToken: string): Promise<OIDCUser> {
    const discovery = await this.discover();

    const response = await fetch(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText },
        "UserInfo request failed"
      );
      throw new OIDCError(
        `UserInfo request failed: ${response.status} - ${errorText}`
      );
    }

    const claims = (await response.json()) as Record<string, unknown>;

    return mapClaimsToUser(claims);
  }

  /**
   * Refresh an access token using a refresh_token grant.
   *
   * @param refreshToken - The refresh token from a previous token exchange
   * @returns New tokens from the IdP
   */
  async refreshAccessToken(
    refreshToken: string
  ): Promise<OIDCTokenRefreshResult> {
    const discovery = await this.discover();

    logger.info("Refreshing access token via refresh_token grant");

    const response = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText },
        "Token refresh failed"
      );
      throw new OIDCError(
        `Token refresh failed: ${response.status} - ${errorText}`
      );
    }

    const tokens = (await response.json()) as TokenResponseBody;

    logger.info("Access token refreshed successfully");

    return {
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token,
    };
  }

  /**
   * Generate a logout URL for RP-Initiated Logout.
   *
   * If the IdP supports the `end_session_endpoint`, this returns a URL
   * the user can be redirected to for single logout. Returns null if the
   * IdP does not advertise an end_session_endpoint.
   *
   * @param idTokenHint - The ID token to hint which session to terminate
   * @param state - Optional state for the logout callback
   * @returns The logout URL, or null if not supported
   */
  async getLogoutUrl(
    idTokenHint?: string,
    state?: string
  ): Promise<string | null> {
    const discovery = await this.discover();

    if (!discovery.end_session_endpoint) {
      logger.debug("IdP does not support end_session_endpoint");
      return null;
    }

    const params = new URLSearchParams();

    if (idTokenHint) {
      params.set("id_token_hint", idTokenHint);
    }

    if (this.config.postLogoutRedirectUri) {
      params.set("post_logout_redirect_uri", this.config.postLogoutRedirectUri);
    }

    if (state) {
      params.set("state", state);
    }

    const paramString = params.toString();
    const logoutUrl = paramString
      ? `${discovery.end_session_endpoint}?${paramString}`
      : discovery.end_session_endpoint;

    logger.info("OIDC logout URL generated");

    return logoutUrl;
  }

  /**
   * Decode the payload of a JWT ID token without verification.
   *
   * This is useful for extracting claims from the ID token for display
   * purposes. For security-critical validation, use a proper JWT library
   * with JWKS verification.
   *
   * @param idToken - The raw JWT ID token string
   * @returns The decoded payload claims
   */
  decodeIdTokenPayload(idToken: string): Record<string, unknown> {
    const match = JWT_SEGMENTS_RE.exec(idToken);
    if (!match?.[1]) {
      throw new OIDCError(
        "Invalid JWT format: expected three dot-separated segments"
      );
    }

    try {
      const payload = Buffer.from(match[1], "base64url").toString("utf-8");
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      throw new OIDCError("Failed to decode ID token payload");
    }
  }

  /**
   * Validate basic temporal claims (exp, iat, nbf) on a decoded ID token.
   *
   * @param claims - Decoded JWT payload claims
   * @returns Whether the token is temporally valid
   */
  validateTokenTiming(claims: Record<string, unknown>): {
    valid: boolean;
    error?: string;
  } {
    const now = Math.floor(Date.now() / 1000);
    const tolerance = this.clockSkewToleranceSec;

    if (typeof claims.exp === "number" && claims.exp + tolerance < now) {
      return { valid: false, error: "ID token has expired" };
    }

    if (typeof claims.nbf === "number" && now + tolerance < claims.nbf) {
      return { valid: false, error: "ID token is not yet valid" };
    }

    return { valid: true };
  }

  /**
   * Invalidate the cached discovery document, forcing a refresh on next use.
   */
  clearDiscoveryCache(): void {
    this.discoveryCache = null;
    logger.debug("OIDC discovery cache cleared");
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Fetch and cache the OpenID Connect discovery document.
   */
  private async discover(): Promise<OIDCDiscovery> {
    if (this.discoveryCache) {
      return this.discoveryCache;
    }

    const wellKnownUrl = `${this.config.issuerUrl}/.well-known/openid-configuration`;

    logger.debug({ url: wellKnownUrl }, "Fetching OIDC discovery document");

    const response = await fetch(wellKnownUrl);
    if (!response.ok) {
      throw new OIDCError(
        `Failed to fetch OIDC discovery document: ${response.status}`
      );
    }

    const doc = (await response.json()) as OIDCDiscovery;

    // Validate required fields
    if (!doc.authorization_endpoint) {
      throw new OIDCError("Discovery document missing authorization_endpoint");
    }
    if (!doc.token_endpoint) {
      throw new OIDCError("Discovery document missing token_endpoint");
    }
    if (!doc.userinfo_endpoint) {
      throw new OIDCError("Discovery document missing userinfo_endpoint");
    }
    if (!doc.jwks_uri) {
      throw new OIDCError("Discovery document missing jwks_uri");
    }

    this.discoveryCache = doc;
    return doc;
  }

  /**
   * Remove pending states older than 10 minutes to prevent unbounded
   * memory growth from abandoned auth flows.
   */
  private pruneExpiredStates(): void {
    const maxAge = 10 * 60 * 1000;
    const now = Date.now();

    for (const [key, value] of this.pendingStates) {
      if (now - value.issuedAt.getTime() > maxAge) {
        this.pendingStates.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map raw OIDC claims to the structured OIDCUser type.
 */
function mapClaimsToUser(claims: Record<string, unknown>): OIDCUser {
  return {
    sub: typeof claims.sub === "string" ? claims.sub : "",
    email: typeof claims.email === "string" ? claims.email : "",
    emailVerified:
      typeof claims.email_verified === "boolean"
        ? claims.email_verified
        : false,
    name: typeof claims.name === "string" ? claims.name : "",
    givenName: typeof claims.given_name === "string" ? claims.given_name : "",
    familyName:
      typeof claims.family_name === "string" ? claims.family_name : "",
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
    claims,
  };
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class OIDCError extends Error {
  override readonly name = "OIDCError";
}
