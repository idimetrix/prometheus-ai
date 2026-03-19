import { createLogger } from "@prometheus/logger";

const logger = createLogger("auth:saml-provider");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SAMLConfig {
  /** The ACS (Assertion Consumer Service) callback URL */
  callbackUrl: string;
  /** The IdP's X.509 certificate for response validation */
  certificate: string;
  /** The SP entity ID (audience URI) */
  entityId: string;
  /** The IdP SSO URL where auth requests are sent */
  ssoUrl: string;
}

export interface SAMLUser {
  email: string;
  firstName: string;
  groups: string[];
  lastName: string;
  nameId: string;
}

export interface SAMLAuthRequest {
  /** The full redirect URL including the SAMLRequest parameter */
  redirectUrl: string;
  /** The generated request ID for correlation */
  requestId: string;
}

// ---------------------------------------------------------------------------
// SAML 2.0 SSO Provider
// ---------------------------------------------------------------------------

/**
 * SAML 2.0 SSO provider stub.
 *
 * Generates SAML AuthnRequest URLs, validates SAML responses, and produces
 * SP metadata XML. In production, wire this up to `@boxyhq/saml-jackson` for
 * full XML signature verification and schema validation. This implementation
 * provides the correct interface and data flow without a real XML crypto stack.
 */
export class SAMLProvider {
  private readonly config: SAMLConfig;
  private readonly logger;
  /** In-flight request IDs for replay protection */
  private readonly pendingRequests = new Map<
    string,
    { issuedAt: Date; relayState?: string }
  >();

  constructor(config: SAMLConfig) {
    this.config = config;
    this.logger = logger;

    this.logger.info(
      { entityId: config.entityId, ssoUrl: config.ssoUrl },
      "SAML provider initialized"
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate a SAML AuthnRequest redirect URL.
   *
   * The IdP will redirect the user back to `callbackUrl` with a SAMLResponse
   * after authentication. An optional `relayState` value is forwarded through
   * the flow so the SP can restore application state (e.g., the original URL
   * the user was trying to access).
   */
  getAuthUrl(relayState?: string): string {
    const requestId = `_${generateId()}`;
    const issueInstant = new Date().toISOString();

    // Store the request for later validation
    this.pendingRequests.set(requestId, {
      issuedAt: new Date(),
      relayState,
    });

    // Prune requests older than 10 minutes to prevent memory leaks
    this.pruneExpiredRequests();

    // Build a minimal AuthnRequest XML
    const authnRequest = [
      '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      '  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      `  ID="${requestId}"`,
      '  Version="2.0"',
      `  IssueInstant="${issueInstant}"`,
      `  AssertionConsumerServiceURL="${escapeXml(this.config.callbackUrl)}"`,
      '  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">',
      `  <saml:Issuer>${escapeXml(this.config.entityId)}</saml:Issuer>`,
      "  <samlp:NameIDPolicy",
      '    Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"',
      '    AllowCreate="true" />',
      "</samlp:AuthnRequest>",
    ].join("\n");

    // Base64 encode per the HTTP-Redirect binding spec
    const encoded = encodeBase64(authnRequest);
    const params = new URLSearchParams({ SAMLRequest: encoded });

    if (relayState) {
      params.set("RelayState", relayState);
    }

    const redirectUrl = `${this.config.ssoUrl}?${params.toString()}`;

    this.logger.info(
      { requestId, relayState: relayState ?? null },
      "SAML AuthnRequest generated"
    );

    return redirectUrl;
  }

  /**
   * Validate a SAML response and extract user information.
   *
   * In production, this must:
   *  1. Verify the XML signature against the IdP certificate
   *  2. Check the InResponseTo matches a pending request ID
   *  3. Validate audience restriction matches our entity ID
   *  4. Check assertion time conditions (NotBefore / NotOnOrAfter)
   *
   * This stub performs basic Base64 decoding and attribute extraction.
   * Use `@boxyhq/saml-jackson` for production-grade validation.
   */
  validateResponse(samlResponse: string): SAMLUser {
    const xml = decodeBase64(samlResponse);

    this.logger.debug("Validating SAML response");

    // -----------------------------------------------------------------------
    // 1. Extract InResponseTo and verify it matches a pending request
    // -----------------------------------------------------------------------
    const inResponseTo = extractAttribute(xml, "InResponseTo");
    if (inResponseTo) {
      const pending = this.pendingRequests.get(inResponseTo);
      if (pending) {
        this.pendingRequests.delete(inResponseTo);
      } else {
        this.logger.warn(
          { inResponseTo },
          "SAML response references unknown request ID"
        );
      }
    }

    // -----------------------------------------------------------------------
    // 2. Verify audience matches our entity ID
    // -----------------------------------------------------------------------
    const audience = extractElementText(xml, "Audience");
    if (audience && audience !== this.config.entityId) {
      const error = `Audience mismatch: expected ${this.config.entityId}, got ${audience}`;
      this.logger.error({ audience }, error);
      throw new SAMLValidationError(error);
    }

    // -----------------------------------------------------------------------
    // 3. Check time conditions
    // -----------------------------------------------------------------------
    const notOnOrAfter = extractAttribute(xml, "NotOnOrAfter");
    if (notOnOrAfter) {
      const expiry = new Date(notOnOrAfter);
      if (expiry < new Date()) {
        const error = "SAML assertion has expired";
        this.logger.error({ notOnOrAfter }, error);
        throw new SAMLValidationError(error);
      }
    }

    // -----------------------------------------------------------------------
    // 4. Extract status — reject if not Success
    // -----------------------------------------------------------------------
    const statusCode = extractAttribute(xml, "Value");
    if (
      statusCode &&
      !statusCode.includes("status:Success") &&
      !statusCode.includes("Success")
    ) {
      const error = `SAML authentication failed with status: ${statusCode}`;
      this.logger.error({ statusCode }, error);
      throw new SAMLValidationError(error);
    }

    // -----------------------------------------------------------------------
    // 5. Extract user attributes
    // -----------------------------------------------------------------------
    const nameId =
      extractElementText(xml, "NameID") ??
      extractElementText(xml, "saml:NameID");
    if (!nameId) {
      throw new SAMLValidationError("Missing NameID in SAML response");
    }

    const email =
      extractSAMLAttribute(xml, "email") ??
      extractSAMLAttribute(xml, "Email") ??
      extractSAMLAttribute(
        xml,
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
      ) ??
      nameId;

    const firstName =
      extractSAMLAttribute(xml, "firstName") ??
      extractSAMLAttribute(xml, "FirstName") ??
      extractSAMLAttribute(xml, "givenName") ??
      extractSAMLAttribute(
        xml,
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"
      ) ??
      "";

    const lastName =
      extractSAMLAttribute(xml, "lastName") ??
      extractSAMLAttribute(xml, "LastName") ??
      extractSAMLAttribute(xml, "surname") ??
      extractSAMLAttribute(
        xml,
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"
      ) ??
      "";

    const groups =
      extractSAMLAttributeValues(xml, "groups") ??
      extractSAMLAttributeValues(xml, "memberOf") ??
      extractSAMLAttributeValues(
        xml,
        "http://schemas.xmlsoap.org/claims/Group"
      ) ??
      [];

    const user: SAMLUser = {
      email,
      firstName,
      lastName,
      groups,
      nameId,
    };

    this.logger.info(
      { email: user.email, groups: user.groups },
      "SAML user authenticated"
    );

    return user;
  }

  /**
   * Generate SP metadata XML that can be provided to the IdP for configuration.
   *
   * This metadata document describes:
   *  - The SP entity ID
   *  - The ACS endpoint (where to POST SAML responses)
   *  - Supported name ID formats
   */
  getMetadataXml(): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"',
      `  entityID="${escapeXml(this.config.entityId)}">`,
      "  <md:SPSSODescriptor",
      '    AuthnRequestsSigned="false"',
      '    WantAssertionsSigned="true"',
      '    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
      "    <md:NameIDFormat>",
      "      urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      "    </md:NameIDFormat>",
      "    <md:AssertionConsumerService",
      '      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
      `      Location="${escapeXml(this.config.callbackUrl)}"`,
      '      index="0"',
      '      isDefault="true" />',
      "  </md:SPSSODescriptor>",
      "</md:EntityDescriptor>",
    ].join("\n");
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Remove pending requests older than 10 minutes to prevent unbounded
   * memory growth from abandoned auth flows.
   */
  private pruneExpiredRequests(): void {
    const maxAge = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();

    for (const [id, request] of this.pendingRequests) {
      if (now - request.issuedAt.getTime() > maxAge) {
        this.pendingRequests.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class SAMLValidationError extends Error {
  override readonly name = "SAMLValidationError";
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Generate a random alphanumeric ID for SAML request correlation */
function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(32);
  crypto.getRandomValues(randomValues);
  for (const byte of randomValues) {
    result += chars[byte % chars.length];
  }
  return result;
}

/** Base64-encode a string (browser + Node.js compatible) */
function encodeBase64(input: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "utf-8").toString("base64");
  }
  return btoa(input);
}

/** Base64-decode a string (browser + Node.js compatible) */
function decodeBase64(input: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "base64").toString("utf-8");
  }
  return atob(input);
}

/** Escape special XML characters */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Extract the text content of an XML element by tag name.
 * This is a lightweight regex-based approach; production code should use
 * a proper XML parser.
 */
function extractElementText(xml: string, tagName: string): string | undefined {
  const escapedTag = escapeRegex(tagName);
  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escapedTag}[^>]*>([^<]*)</(?:[\\w-]+:)?${escapedTag}>`,
    "i"
  );
  const match = regex.exec(xml);
  return match?.[1]?.trim();
}

/**
 * Extract an XML attribute value by attribute name from any element.
 */
function extractAttribute(xml: string, attrName: string): string | undefined {
  const escapedAttr = escapeRegex(attrName);
  const regex = new RegExp(`${escapedAttr}="([^"]*)"`, "i");
  const match = regex.exec(xml);
  return match?.[1];
}

/**
 * Extract a SAML attribute value by its Name or FriendlyName.
 * Looks for `<saml:Attribute Name="..."><saml:AttributeValue>...</saml:AttributeValue></saml:Attribute>`
 */
function extractSAMLAttribute(
  xml: string,
  attributeName: string
): string | undefined {
  const escapedName = escapeRegex(attributeName);
  const regex = new RegExp(
    `<(?:[\\w-]+:)?Attribute[^>]*(?:Name|FriendlyName)="${escapedName}"[^>]*>\\s*<(?:[\\w-]+:)?AttributeValue[^>]*>([^<]*)</`,
    "i"
  );
  const match = regex.exec(xml);
  return match?.[1]?.trim() || undefined;
}

/**
 * Extract multiple SAML attribute values (e.g., group memberships).
 */
function extractSAMLAttributeValues(
  xml: string,
  attributeName: string
): string[] | undefined {
  const escapedName = escapeRegex(attributeName);
  const blockRegex = new RegExp(
    `<(?:[\\w-]+:)?Attribute[^>]*(?:Name|FriendlyName)="${escapedName}"[^>]*>(.*?)</(?:[\\w-]+:)?Attribute>`,
    "is"
  );
  const blockMatch = blockRegex.exec(xml);
  if (!blockMatch?.[1]) {
    return undefined;
  }

  const values: string[] = [];
  const valueRegex =
    /<(?:[\w-]+:)?AttributeValue[^>]*>([^<]*)<\/(?:[\w-]+:)?AttributeValue>/gi;
  let valueMatch = valueRegex.exec(blockMatch[1]);
  while (valueMatch !== null) {
    const v = valueMatch[1]?.trim();
    if (v) {
      values.push(v);
    }
    valueMatch = valueRegex.exec(blockMatch[1]);
  }

  return values.length > 0 ? values : undefined;
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
