import { createLogger } from "@prometheus/logger";

const logger = createLogger("auth:oidc");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OIDCConfig {
  /** OAuth 2.0 client ID */
  clientId: string;
  /** OAuth 2.0 client secret */
  clientSecret: string;
  /** OpenID Connect issuer URL (e.g., https://accounts.google.com) */
  issuer: string;
  /** Redirect URI registered with the IdP */
  redirectUri: string;
  /** Scopes to request (defaults to openid, email, profile) */
  scopes?: string[];
}

export interface OIDCTokenResponse {
  accessToken: string;
  expiresIn?: number;
  idToken: string;
  refreshToken?: string;
  tokenType: string;
}

export interface OIDCUserInfo {
  email: string;
  emailVerified?: boolean;
  groups?: string[];
  name?: string;
  picture?: string;
  sub: string;
}

interface OIDCDiscovery {
  authorization_endpoint: string;
  issuer: string;
  jwks_uri: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

// ---------------------------------------------------------------------------
// OIDC Provider
// ---------------------------------------------------------------------------

export class OIDCProvider {
  private readonly config: OIDCConfig;
  private readonly scopes: string[];
  private discoveryCache: OIDCDiscovery | null = null;

  constructor(config: OIDCConfig) {
    if (!config.issuer) {
      throw new Error("OIDC issuer is required");
    }
    if (!config.clientId) {
      throw new Error("OIDC clientId is required");
    }
    if (!config.clientSecret) {
      throw new Error("OIDC clientSecret is required");
    }
    if (!config.redirectUri) {
      throw new Error("OIDC redirectUri is required");
    }

    this.config = config;
    this.scopes = config.scopes ?? ["openid", "email", "profile"];

    logger.info({ issuer: config.issuer }, "OIDC provider initialized");
  }

  /**
   * Fetch the OpenID Connect discovery document from the IdP.
   */
  async discover(): Promise<OIDCDiscovery> {
    if (this.discoveryCache) {
      return this.discoveryCache;
    }

    const discoveryUrl = `${this.config.issuer}/.well-known/openid-configuration`;

    const response = await fetch(discoveryUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch OIDC discovery document: ${response.status} ${response.statusText}`
      );
    }

    const doc = (await response.json()) as OIDCDiscovery;

    if (!(doc.authorization_endpoint && doc.token_endpoint)) {
      throw new Error("OIDC discovery document missing required endpoints");
    }

    this.discoveryCache = doc;
    logger.info({ issuer: doc.issuer }, "OIDC discovery document loaded");

    return doc;
  }

  /**
   * Generate the authorization URL to redirect the user to the IdP.
   *
   * @param state - Opaque value for CSRF protection (should be stored in session)
   * @param nonce - Optional nonce for ID token replay protection
   */
  async getAuthorizationUrl(state: string, nonce?: string): Promise<string> {
    const discovery = await this.discover();

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.scopes.join(" "),
      state,
    });

    if (nonce) {
      params.set("nonce", nonce);
    }

    const url = `${discovery.authorization_endpoint}?${params.toString()}`;

    logger.info(
      { issuer: this.config.issuer },
      "OIDC authorization URL generated"
    );

    return url;
  }

  /**
   * Exchange an authorization code for tokens.
   *
   * @param code - Authorization code received from the IdP callback
   */
  async exchangeCode(code: string): Promise<OIDCTokenResponse> {
    if (!code) {
      throw new Error("Authorization code is required");
    }

    const discovery = await this.discover();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
    });

    const response = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        { status: response.status, body: errorBody },
        "OIDC token exchange failed"
      );
      throw new Error(
        `OIDC token exchange failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      id_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
    };

    if (!(data.access_token && data.id_token)) {
      throw new Error("OIDC token response missing required tokens");
    }

    logger.info("OIDC code exchange successful");

    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
    };
  }

  /**
   * Fetch user information from the IdP's userinfo endpoint.
   *
   * @param accessToken - Access token obtained from exchangeCode
   */
  async getUserInfo(accessToken: string): Promise<OIDCUserInfo> {
    if (!accessToken) {
      throw new Error("Access token is required");
    }

    const discovery = await this.discover();

    const response = await fetch(discovery.userinfo_endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, "OIDC userinfo request failed");
      throw new Error(
        `OIDC userinfo request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      sub: string;
      email: string;
      name?: string;
      groups?: string[];
      picture?: string;
      email_verified?: boolean;
    };

    if (!(data.sub && data.email)) {
      throw new Error("OIDC userinfo response missing sub or email");
    }

    logger.info(
      { sub: data.sub, email: data.email },
      "OIDC userinfo retrieved"
    );

    return {
      sub: data.sub,
      email: data.email,
      name: data.name,
      groups: data.groups,
      picture: data.picture,
      emailVerified: data.email_verified,
    };
  }

  /**
   * Decode an ID token's payload (without signature verification).
   * For display/debugging purposes only. In production, use a JWT library
   * with proper signature verification against the JWKS.
   */
  decodeIdToken(idToken: string): Record<string, unknown> {
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    const payload = parts[1];
    if (!payload) {
      throw new Error("Invalid JWT payload");
    }

    const decoded = Buffer.from(payload, "base64url").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  }

  /**
   * Clear the cached discovery document (useful for testing or rotation).
   */
  clearDiscoveryCache(): void {
    this.discoveryCache = null;
  }
}
