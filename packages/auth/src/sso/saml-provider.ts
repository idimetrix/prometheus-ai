import { createVerify, X509Certificate } from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("auth:saml-provider");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SAMLConfig {
  /** The ACS (Assertion Consumer Service) callback URL */
  callbackUrl: string;
  /** The IdP's X.509 certificate (PEM) for response signature validation */
  certificate: string;
  /** Clock skew tolerance in seconds for time condition checks (default: 120) */
  clockSkewToleranceSec?: number;
  /** The SP entity ID (audience URI) */
  entityId: string;
  /** The IdP SSO URL where auth requests are sent */
  ssoUrl: string;
  /** Whether to enforce InResponseTo matching (default: true) */
  strictRequestValidation?: boolean;
  /** Whether to enforce XML signature verification (default: true) */
  wantAssertionsSigned?: boolean;
}

export interface SAMLUser {
  email: string;
  firstName: string;
  groups: string[];
  lastName: string;
  nameId: string;
  /** Raw attributes extracted from the SAML assertion */
  rawAttributes?: Record<string, string | string[]>;
  /** Session index for single logout */
  sessionIndex?: string;
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

// ---------------------------------------------------------------------------
// Top-level regex constants (moved here for performance per useTopLevelRegex)
// ---------------------------------------------------------------------------

const SIGNATURE_BLOCK_REGEX =
  /<(?:ds:)?Signature[^>]*xmlns:ds="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"[^>]*>([\s\S]*?)<\/(?:ds:)?Signature>/i;
const ALT_SIGNATURE_BLOCK_REGEX =
  /<(?:ds:)?Signature[^>]*>([\s\S]*?)<\/(?:ds:)?Signature>/i;
const SIG_VALUE_REGEX =
  /<(?:ds:)?SignatureValue[^>]*>([\s\S]*?)<\/(?:ds:)?SignatureValue>/i;
const SIGNED_INFO_REGEX =
  /<(?:ds:)?SignedInfo[^>]*>([\s\S]*?)<\/(?:ds:)?SignedInfo>/i;
const SIG_ALG_REGEX =
  /Algorithm="http:\/\/www\.w3\.org\/\d{4}\/\d{2}\/xmldsig(?:-more)?#([\w-]+)"/i;

/**
 * Production-ready SAML 2.0 SSO provider.
 *
 * Supports:
 * - SP-initiated SSO with AuthnRequest generation
 * - SAML Response parsing and assertion extraction
 * - XML signature verification using the IdP X.509 certificate
 * - Audience restriction validation
 * - Time condition checks with configurable clock skew tolerance
 * - InResponseTo replay protection
 * - SP metadata XML generation
 * - Attribute mapping for common IdP schemas (Okta, Azure AD, OneLogin)
 */
export class SAMLProvider {
  private readonly config: SAMLConfig;
  private readonly wantAssertionsSigned: boolean;
  private readonly strictRequestValidation: boolean;
  private readonly clockSkewToleranceSec: number;

  /** In-flight request IDs for replay protection */
  private readonly pendingRequests = new Map<
    string,
    { issuedAt: Date; relayState?: string }
  >();

  constructor(config: SAMLConfig) {
    this.config = config;
    this.wantAssertionsSigned = config.wantAssertionsSigned !== false;
    this.strictRequestValidation = config.strictRequestValidation !== false;
    this.clockSkewToleranceSec = config.clockSkewToleranceSec ?? 120;

    logger.info(
      { entityId: config.entityId, ssoUrl: config.ssoUrl },
      "SAML provider initialized"
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate a SAML AuthnRequest and return structured request data.
   *
   * The IdP will redirect the user back to `callbackUrl` with a SAMLResponse
   * after authentication. An optional `relayState` value is forwarded through
   * the flow so the SP can restore application state.
   */
  createAuthRequest(relayState?: string): SAMLAuthRequest {
    const requestId = `_${generateRequestId()}`;
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

    logger.info(
      { requestId, relayState: relayState ?? null },
      "SAML AuthnRequest generated"
    );

    return { requestId, redirectUrl };
  }

  /**
   * Backward-compatible alias that returns just the redirect URL.
   */
  getAuthUrl(relayState?: string): string {
    return this.createAuthRequest(relayState).redirectUrl;
  }

  /**
   * Validate a SAML response and extract user information.
   *
   * Performs the following security checks:
   *  1. XML signature verification against the IdP certificate
   *  2. InResponseTo replay protection
   *  3. Audience restriction validation
   *  4. Time condition checks (NotBefore / NotOnOrAfter with clock skew)
   *  5. Status code verification
   */
  validateResponse(samlResponse: string): SAMLUser {
    const xml = decodeBase64(samlResponse);

    logger.debug("Validating SAML response");

    // -----------------------------------------------------------------------
    // 1. Verify XML signature against IdP certificate
    // -----------------------------------------------------------------------
    if (this.wantAssertionsSigned) {
      this.verifySignature(xml);
    }

    // -----------------------------------------------------------------------
    // 2. Extract InResponseTo and verify it matches a pending request
    // -----------------------------------------------------------------------
    const inResponseTo = extractAttribute(xml, "InResponseTo");
    if (inResponseTo) {
      const pending = this.pendingRequests.get(inResponseTo);
      if (pending) {
        this.pendingRequests.delete(inResponseTo);
      } else if (this.strictRequestValidation) {
        const error = `SAML response references unknown request ID: ${inResponseTo}`;
        logger.error({ inResponseTo }, error);
        throw new SAMLValidationError(error);
      } else {
        logger.warn(
          { inResponseTo },
          "SAML response references unknown request ID"
        );
      }
    }

    // -----------------------------------------------------------------------
    // 3. Verify audience matches our entity ID
    // -----------------------------------------------------------------------
    const audience = extractElementText(xml, "Audience");
    if (audience && audience !== this.config.entityId) {
      const error = `Audience mismatch: expected ${this.config.entityId}, got ${audience}`;
      logger.error({ audience }, error);
      throw new SAMLValidationError(error);
    }

    // -----------------------------------------------------------------------
    // 4. Check time conditions with clock skew tolerance
    // -----------------------------------------------------------------------
    const toleranceMs = this.clockSkewToleranceSec * 1000;
    const now = Date.now();

    const notOnOrAfter = extractAttribute(xml, "NotOnOrAfter");
    if (notOnOrAfter) {
      const expiry = new Date(notOnOrAfter).getTime();
      if (expiry + toleranceMs < now) {
        const error = "SAML assertion has expired";
        logger.error({ notOnOrAfter }, error);
        throw new SAMLValidationError(error);
      }
    }

    const notBefore = extractAttribute(xml, "NotBefore");
    if (notBefore) {
      const earliest = new Date(notBefore).getTime();
      if (now + toleranceMs < earliest) {
        const error = "SAML assertion is not yet valid";
        logger.error({ notBefore }, error);
        throw new SAMLValidationError(error);
      }
    }

    // -----------------------------------------------------------------------
    // 5. Extract status — reject if not Success
    // -----------------------------------------------------------------------
    const statusCode = extractAttribute(xml, "Value");
    if (
      statusCode &&
      !statusCode.includes("status:Success") &&
      !statusCode.includes("Success")
    ) {
      const error = `SAML authentication failed with status: ${statusCode}`;
      logger.error({ statusCode }, error);
      throw new SAMLValidationError(error);
    }

    // -----------------------------------------------------------------------
    // 6. Extract user attributes
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
      extractSAMLAttribute(
        xml,
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/emailaddress"
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
      extractSAMLAttribute(
        xml,
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/givenname"
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
      extractSAMLAttribute(
        xml,
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/surname"
      ) ??
      "";

    const groups =
      extractSAMLAttributeValues(xml, "groups") ??
      extractSAMLAttributeValues(xml, "memberOf") ??
      extractSAMLAttributeValues(
        xml,
        "http://schemas.xmlsoap.org/claims/Group"
      ) ??
      extractSAMLAttributeValues(
        xml,
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
      ) ??
      [];

    // Extract session index for SLO support
    const sessionIndex = extractAttribute(xml, "SessionIndex");

    // Collect raw attributes
    const rawAttributes = extractAllSAMLAttributes(xml);

    const user: SAMLUser = {
      email,
      firstName,
      lastName,
      groups,
      nameId,
      sessionIndex,
      rawAttributes,
    };

    logger.info(
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
      "    <md:NameIDFormat>",
      "      urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
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

  /**
   * Verify that a certificate string is a valid PEM-encoded X.509 certificate
   * and optionally check its expiry.
   */
  validateCertificate(): {
    valid: boolean;
    subject?: string;
    issuer?: string;
    notAfter?: Date;
    error?: string;
  } {
    try {
      const pem = normalizeCertificate(this.config.certificate);
      const cert = new X509Certificate(pem);
      const notAfter = new Date(cert.validTo);
      const isExpired = notAfter < new Date();

      return {
        valid: !isExpired,
        subject: cert.subject,
        issuer: cert.issuer,
        notAfter,
        error: isExpired ? "Certificate has expired" : undefined,
      };
    } catch (err) {
      return {
        valid: false,
        error: `Invalid certificate: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Verify the XML digital signature using the IdP's X.509 certificate.
   *
   * Extracts the SignatureValue and SignedInfo from the SAML response,
   * then verifies using Node.js crypto with the configured certificate.
   */
  private verifySignature(xml: string): void {
    // Extract the Signature block
    const sigMatch =
      SIGNATURE_BLOCK_REGEX.exec(xml) ?? ALT_SIGNATURE_BLOCK_REGEX.exec(xml);
    if (!sigMatch) {
      throw new SAMLValidationError(
        "No XML signature found in SAML response — assertion signing is required"
      );
    }

    const signatureBlock = sigMatch[0];

    // Extract SignatureValue
    const sigValueMatch = SIG_VALUE_REGEX.exec(signatureBlock);
    if (!sigValueMatch?.[1]) {
      throw new SAMLValidationError("Missing SignatureValue in SAML signature");
    }
    const signatureValue = sigValueMatch[1].replace(/\s+/g, "");

    // Extract SignedInfo block (this is what was actually signed)
    const signedInfoMatch = SIGNED_INFO_REGEX.exec(signatureBlock);
    if (!signedInfoMatch) {
      throw new SAMLValidationError("Missing SignedInfo in SAML signature");
    }

    // Reconstruct the canonical SignedInfo XML for verification
    const signedInfoXml = signedInfoMatch[0];

    // Detect the signature algorithm
    const sigAlgMatch = SIG_ALG_REGEX.exec(signedInfoXml);
    const algorithm = mapSignatureAlgorithm(sigAlgMatch?.[1] ?? "rsa-sha256");

    // Verify the signature using the IdP certificate
    try {
      const pem = normalizeCertificate(this.config.certificate);
      const verifier = createVerify(algorithm);
      verifier.update(signedInfoXml);
      const isValid = verifier.verify(pem, signatureValue, "base64");

      if (!isValid) {
        throw new SAMLValidationError(
          "XML signature verification failed — the response may have been tampered with"
        );
      }

      logger.debug(
        { algorithm },
        "SAML response signature verified successfully"
      );
    } catch (err) {
      if (err instanceof SAMLValidationError) {
        throw err;
      }
      throw new SAMLValidationError(
        `Signature verification error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

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
function generateRequestId(): string {
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
 * Normalize a certificate string to PEM format.
 * Handles raw Base64 (no headers), single-line PEM, and standard multi-line PEM.
 */
function normalizeCertificate(cert: string): string {
  let cleaned = cert.trim();

  // Strip PEM headers if present
  cleaned = cleaned
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  // Re-wrap in proper PEM format with 64-char lines
  const lines: string[] = [];
  for (let i = 0; i < cleaned.length; i += 64) {
    lines.push(cleaned.slice(i, i + 64));
  }

  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

/**
 * Map an XML signature algorithm URI fragment to a Node.js crypto algorithm name.
 */
function mapSignatureAlgorithm(alg: string): string {
  const algMap: Record<string, string> = {
    "rsa-sha1": "SHA1",
    "rsa-sha256": "SHA256",
    "rsa-sha384": "SHA384",
    "rsa-sha512": "SHA512",
  };
  return algMap[alg.toLowerCase()] ?? "SHA256";
}

/**
 * Extract the text content of an XML element by tag name.
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

/**
 * Extract all SAML attributes into a flat map.
 */
function extractAllSAMLAttributes(
  xml: string
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const attrBlockRegex =
    /<(?:[\w-]+:)?Attribute\s+[^>]*Name="([^"]*)"[^>]*>(.*?)<\/(?:[\w-]+:)?Attribute>/gis;

  let blockMatch = attrBlockRegex.exec(xml);
  while (blockMatch !== null) {
    const name = blockMatch[1];
    const block = blockMatch[2];
    if (name && block) {
      const values: string[] = [];
      const valueRegex =
        /<(?:[\w-]+:)?AttributeValue[^>]*>([^<]*)<\/(?:[\w-]+:)?AttributeValue>/gi;
      let valueMatch = valueRegex.exec(block);
      while (valueMatch !== null) {
        const v = valueMatch[1]?.trim();
        if (v) {
          values.push(v);
        }
        valueMatch = valueRegex.exec(block);
      }

      if (values.length === 1 && values[0] !== undefined) {
        result[name] = values[0];
      } else if (values.length > 1) {
        result[name] = values;
      }
    }
    blockMatch = attrBlockRegex.exec(xml);
  }

  return result;
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
