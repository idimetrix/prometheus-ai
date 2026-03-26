import type { SkillPack } from "./ecommerce";

/**
 * Auth Skill Pack
 *
 * Patterns for OAuth integration, JWT handling, session management,
 * role-based access control, and identity provider federation.
 */

export const AUTH_SKILL_PACK: SkillPack = {
  id: "skill-pack-auth",
  name: "Authentication & Authorization",
  description:
    "OAuth patterns, JWT handling, session management, RBAC, and identity provider federation",
  category: "skill-pack",
  tags: [
    "auth",
    "oauth",
    "jwt",
    "sessions",
    "rbac",
    "sso",
    "security",
    "identity",
  ],

  patterns: [
    {
      name: "OAuth 2.0 / OpenID Connect",
      description:
        "OAuth 2.0 Authorization Code flow with PKCE for secure third-party authentication",
      context:
        "Users authenticate via external identity providers (Google, GitHub, Microsoft)",
      implementation: `
- Use Authorization Code flow with PKCE (never Implicit flow)
- OAuthProvider table: id, name, clientId, clientSecret (encrypted), scopes, discoveryUrl
- OAuthState table: id, state, codeVerifier, redirectUri, expiresAt (CSRF protection)
- Flow: redirect to IdP -> user consents -> callback with code -> exchange for tokens
- Store refresh tokens encrypted at rest, never expose to client
- Use the id_token for identity, access_token for API calls
- Token refresh: background refresh before expiry, handle refresh failures gracefully
- Support multiple providers: Google, GitHub, GitLab, Microsoft, Okta, Auth0
- Validate the id_token signature using the IdP's JWKS endpoint
`,
    },
    {
      name: "JWT Token Management",
      description:
        "Issue, validate, and rotate short-lived JWTs with refresh token rotation",
      context:
        "Stateless authentication for API access with secure token lifecycle",
      implementation: `
- Access tokens: short-lived (15 min), signed with RS256, contain userId, orgId, roles
- Refresh tokens: longer-lived (7 days), stored in DB, single-use with rotation
- RefreshToken table: id, userId, tokenHash, familyId, expiresAt, revokedAt
- Token rotation: on refresh, issue new access + refresh, invalidate old refresh
- Refresh token family: if a revoked token is reused, invalidate the entire family (detect theft)
- Claims: sub (userId), org (orgId), roles, iat, exp, jti (unique token ID)
- JWKS endpoint: publish public keys for token verification by services
- Never store JWTs in localStorage — use httpOnly secure cookies or in-memory
- Token blacklist: Redis set of revoked jti values for immediate invalidation
`,
    },
    {
      name: "Session Management",
      description:
        "Server-side session handling with secure cookie-based transport",
      context: "Track authenticated user sessions with security controls",
      implementation: `
- Session table: id, userId, ipAddress, userAgent, createdAt, lastActiveAt, expiresAt
- Session ID: cryptographically random 256-bit value, stored as httpOnly secure SameSite cookie
- Absolute timeout: sessions expire after 24 hours regardless of activity
- Idle timeout: sessions expire after 30 minutes of inactivity
- Concurrent session limit: max N active sessions per user (configurable per plan)
- Session revocation: revoke by ID, revoke all for user, revoke all except current
- Sliding window: extend session on each authenticated request
- Fingerprinting: store IP + User-Agent hash, flag if it changes mid-session
- Graceful logout: clear session server-side and client-side cookies
`,
    },
    {
      name: "Role-Based Access Control (RBAC)",
      description: "Hierarchical role system with granular permission grants",
      context: "Different users need different levels of access to resources",
      implementation: `
- Role table: id, orgId, name, description, isSystem (built-in roles cannot be deleted)
- Permission table: id, resource, action, description
- RolePermission table: roleId, permissionId (many-to-many)
- UserRole table: userId, orgId, roleId
- Built-in roles: owner, admin, member, viewer, guest
- Permission format: "resource:action" (e.g., "project:create", "session:delete")
- Hierarchical: owner > admin > member > viewer (higher includes lower permissions)
- Middleware: checkPermission("project:create") — checks user's roles for the org
- Custom roles: orgs on Team/Enterprise plans can create custom role definitions
- Resource-level permissions: per-project role overrides for fine-grained access
`,
    },
    {
      name: "Multi-Factor Authentication (MFA)",
      description: "TOTP-based two-factor authentication with recovery codes",
      context: "Add a second authentication factor for enhanced security",
      implementation: `
- MFADevice table: id, userId, type (totp|webauthn), secret (encrypted), name, verifiedAt
- RecoveryCode table: id, userId, codeHash, usedAt
- TOTP setup: generate secret, show QR code, verify with initial code before enabling
- Recovery codes: generate 10 single-use backup codes on MFA enrollment
- Login flow: password -> if MFA enabled -> prompt for TOTP code -> verify -> issue session
- Remember device: optional "trust this device" for 30 days (store device fingerprint)
- WebAuthn/Passkeys: support FIDO2 hardware keys and platform authenticators
- Enforcement: org admins can require MFA for all members
- Rate limit TOTP attempts: max 5 failed attempts, then lockout for 15 minutes
`,
    },
  ],

  agentHints: {
    architect:
      "Design auth with OAuth 2.0 + PKCE for external providers. JWT access tokens (RS256, 15 min) + refresh token rotation. RBAC with hierarchical roles. MFA as opt-in with org-level enforcement.",
    frontend_coder:
      "Implement login/signup flows with provider buttons. Store tokens in httpOnly cookies (not localStorage). Handle token refresh transparently. Build MFA enrollment with QR code display.",
    backend_coder:
      "Auth middleware on every route. Refresh token rotation with family-based revocation. JWKS endpoint for distributed verification. Encrypt secrets at rest. Rate-limit auth endpoints.",
    test_engineer:
      "Test token expiry and refresh flows. Test refresh token reuse detection. Test RBAC permission checks. Test MFA enrollment and verification. Test session timeout behavior.",
    security_auditor:
      "Verify tokens are not in localStorage. Check refresh token rotation. Validate PKCE on OAuth flows. Ensure secrets are encrypted at rest. Audit rate limiting on auth endpoints.",
  },
};
