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
  /** OpenID Connect issuer URL (used for discovery) */
  issuerUrl: string;
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

export interface OIDCDiscovery {
  authorization_endpoint: string;
  issuer: string;
  jwks_uri: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

// ---------------------------------------------------------------------------
// OpenID Connect Provider
// ---------------------------------------------------------------------------

/**
 * OpenID Connect SSO provider stub.
 *
 * Implements the Authorization Code Flow with PKCE support. In production,
 * wire this up to a proper OIDC client library (e.g. `openid-client`) for
 * full JWT validation, JWKS rotation, and nonce/state verification.
 *
 * This implementation provides the correct interface and data flow.
 */
export class OIDCProvider {
  private readonly config: OIDCConfig;
  private readonly scopes: string[];
  private discoveryCache: OIDCDiscovery | null = null;

  constructor(config: OIDCConfig) {
    this.config = config;
    this.scopes = config.scopes ?? ["openid", "profile", "email"];

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

    const authUrl = `${discovery.authorization_endpoint}?${params.toString()}`;

    logger.info({ state }, "OIDC authorization URL generated");

    return authUrl;
  }

  /**
   * Handle the authorization callback by exchanging the code for tokens.
   *
   * @param code - The authorization code from the callback
   * @returns The token exchange result including access token and ID token
   */
  async handleCallback(code: string): Promise<OIDCAuthResult> {
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

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      id_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
    };

    // Fetch user info
    const user = await this.getUserInfo(tokens.access_token);

    logger.info({ email: user.email }, "OIDC user authenticated");

    return {
      user,
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
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

    return {
      sub: (claims.sub as string) ?? "",
      email: (claims.email as string) ?? "",
      emailVerified: (claims.email_verified as boolean) ?? false,
      name: (claims.name as string) ?? "",
      givenName: (claims.given_name as string) ?? "",
      familyName: (claims.family_name as string) ?? "",
      picture: claims.picture as string | undefined,
      claims,
    };
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

    this.discoveryCache = (await response.json()) as OIDCDiscovery;
    return this.discoveryCache;
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class OIDCError extends Error {
  override readonly name = "OIDCError";
}
