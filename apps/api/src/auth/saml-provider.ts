import { randomBytes } from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("auth:saml");

// Top-level regex patterns for SAML XML parsing
const NOT_BEFORE_REGEX = /NotBefore="([^"]+)"/;
const NOT_ON_OR_AFTER_REGEX = /NotOnOrAfter="([^"]+)"/;
const SESSION_INDEX_REGEX = /SessionIndex="([^"]+)"/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SAMLConfig {
  /** Assertion Consumer Service URL (where IdP posts SAML response) */
  callbackUrl: string;
  /** IdP X.509 signing certificate (PEM-encoded) */
  certificate: string;
  /** Identity Provider entity ID / issuer URL */
  issuer: string;
  /** SP private key for signing requests (PEM-encoded, optional) */
  privateKey?: string;
}

export interface SAMLUserProfile {
  attributes: Record<string, string>;
  email: string;
  firstName?: string;
  groups?: string[];
  lastName?: string;
  nameId: string;
}

interface SAMLResponseClaims {
  attributes: Record<string, string | string[]>;
  audience: string;
  issuer: string;
  nameId: string;
  notBefore?: string;
  notOnOrAfter?: string;
  sessionIndex?: string;
}

// ---------------------------------------------------------------------------
// SAML Provider
// ---------------------------------------------------------------------------

export class SAMLProvider {
  private readonly config: SAMLConfig;

  constructor(config: SAMLConfig) {
    if (!config.issuer) {
      throw new Error("SAML issuer is required");
    }
    if (!config.callbackUrl) {
      throw new Error("SAML callbackUrl is required");
    }
    if (!config.certificate) {
      throw new Error("SAML certificate is required");
    }
    this.config = config;
    logger.info({ issuer: config.issuer }, "SAML provider initialized");
  }

  /**
   * Generate a SAML AuthnRequest URL for initiating SSO login.
   *
   * The relayState parameter is an opaque string forwarded by the IdP
   * back to the SP after authentication (e.g., the original URL the
   * user was trying to access).
   */
  generateLoginUrl(relayState?: string): string {
    const requestId = `_${randomBytes(16).toString("hex")}`;
    const issueInstant = new Date().toISOString();

    const authnRequest = [
      "<samlp:AuthnRequest",
      '  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      '  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      `  ID="${requestId}"`,
      '  Version="2.0"',
      `  IssueInstant="${issueInstant}"`,
      `  AssertionConsumerServiceURL="${this.config.callbackUrl}"`,
      '  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">',
      `  <saml:Issuer>${this.config.callbackUrl}</saml:Issuer>`,
      "  <samlp:NameIDPolicy",
      '    Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"',
      '    AllowCreate="true" />',
      "</samlp:AuthnRequest>",
    ].join("\n");

    const encodedRequest = Buffer.from(authnRequest).toString("base64");

    const params = new URLSearchParams({
      SAMLRequest: encodedRequest,
    });

    if (relayState) {
      params.set("RelayState", relayState);
    }

    const loginUrl = `${this.config.issuer}/sso/saml?${params.toString()}`;

    logger.info(
      { requestId, issuer: this.config.issuer },
      "SAML login URL generated"
    );

    return loginUrl;
  }

  /**
   * Validate a SAML response from the Identity Provider.
   *
   * In production, this would perform full XML signature verification
   * against the IdP certificate, validate timestamps, audience, etc.
   * This implementation provides the structural parsing and validation
   * framework.
   */
  validateResponse(samlResponse: string): SAMLUserProfile {
    if (!samlResponse) {
      throw new Error("SAML response is empty");
    }

    let decoded: string;
    try {
      decoded = Buffer.from(samlResponse, "base64").toString("utf-8");
    } catch {
      throw new Error("Failed to decode SAML response");
    }

    // Parse claims from the SAML assertion
    const claims = this.parseAssertionClaims(decoded);

    // Validate issuer matches configured IdP
    if (claims.issuer && claims.issuer !== this.config.issuer) {
      throw new Error(
        `SAML issuer mismatch: expected ${this.config.issuer}, got ${claims.issuer}`
      );
    }

    // Validate time constraints
    if (claims.notOnOrAfter) {
      const expiry = new Date(claims.notOnOrAfter);
      if (new Date() > expiry) {
        throw new Error("SAML assertion has expired");
      }
    }

    if (claims.notBefore) {
      const notBefore = new Date(claims.notBefore);
      if (new Date() < notBefore) {
        throw new Error("SAML assertion is not yet valid");
      }
    }

    // Extract user profile from attributes
    const attributes = claims.attributes;
    const email = this.extractAttribute(attributes, [
      "email",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      "urn:oid:0.9.2342.19200300.100.1.3",
    ]);

    if (!email) {
      throw new Error("SAML response missing email attribute");
    }

    const firstName = this.extractAttribute(attributes, [
      "firstName",
      "givenName",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
      "urn:oid:2.5.4.42",
    ]);

    const lastName = this.extractAttribute(attributes, [
      "lastName",
      "surname",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
      "urn:oid:2.5.4.4",
    ]);

    const groupsRaw = attributes.groups ?? attributes.memberOf;
    let groups: string[] | undefined;
    if (Array.isArray(groupsRaw)) {
      groups = groupsRaw;
    } else if (groupsRaw) {
      groups = [groupsRaw];
    }

    // Flatten attributes to string values
    const flatAttributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes)) {
      flatAttributes[key] = Array.isArray(value) ? value.join(",") : value;
    }

    const profile: SAMLUserProfile = {
      nameId: claims.nameId,
      email,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      groups,
      attributes: flatAttributes,
    };

    logger.info(
      { nameId: profile.nameId, email: profile.email },
      "SAML response validated"
    );

    return profile;
  }

  /**
   * Generate SP metadata XML for the Identity Provider.
   */
  generateMetadata(): string {
    return [
      '<?xml version="1.0"?>',
      "<md:EntityDescriptor",
      '  xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"',
      `  entityID="${this.config.callbackUrl}">`,
      "  <md:SPSSODescriptor",
      '    AuthnRequestsSigned="false"',
      '    WantAssertionsSigned="true"',
      '    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
      "    <md:NameIDFormat>",
      "      urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      "    </md:NameIDFormat>",
      "    <md:AssertionConsumerService",
      '      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
      `      Location="${this.config.callbackUrl}"`,
      '      index="0"',
      '      isDefault="true" />',
      "  </md:SPSSODescriptor>",
      "</md:EntityDescriptor>",
    ].join("\n");
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private parseAssertionClaims(xml: string): SAMLResponseClaims {
    // Extract key fields using regex-based parsing.
    // A production implementation would use a proper XML/SAML library
    // with signature verification.
    const nameId = this.extractXmlValue(xml, "NameID") ?? "";
    const issuer = this.extractXmlValue(xml, "Issuer") ?? "";
    const audience = this.extractXmlValue(xml, "Audience") ?? "";

    const notBeforeMatch = xml.match(NOT_BEFORE_REGEX);
    const notOnOrAfterMatch = xml.match(NOT_ON_OR_AFTER_REGEX);
    const sessionIndexMatch = xml.match(SESSION_INDEX_REGEX);

    // Extract attributes from AttributeStatement
    const attributes: Record<string, string | string[]> = {};
    const attrRegex =
      /<(?:saml:)?Attribute\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:saml:)?Attribute>/g;
    let match = attrRegex.exec(xml);
    while (match) {
      const attrName = match[1];
      const attrBlock = match[2];
      if (attrName && attrBlock) {
        const values: string[] = [];
        const valueRegex =
          /<(?:saml:)?AttributeValue[^>]*>([^<]*)<\/(?:saml:)?AttributeValue>/g;
        let valueMatch = valueRegex.exec(attrBlock);
        while (valueMatch) {
          if (valueMatch[1]) {
            values.push(valueMatch[1]);
          }
          valueMatch = valueRegex.exec(attrBlock);
        }
        const firstValue = values[0];
        attributes[attrName] =
          values.length === 1 && firstValue ? firstValue : values;
      }
      match = attrRegex.exec(xml);
    }

    return {
      nameId,
      attributes,
      issuer,
      audience,
      notBefore: notBeforeMatch?.[1],
      notOnOrAfter: notOnOrAfterMatch?.[1],
      sessionIndex: sessionIndexMatch?.[1],
    };
  }

  private extractXmlValue(xml: string, tag: string): string | null {
    const regex = new RegExp(
      `<(?:saml:|samlp:)?${tag}[^>]*>([^<]*)</(?:saml:|samlp:)?${tag}>`
    );
    const match = regex.exec(xml);
    return match?.[1] ?? null;
  }

  private extractAttribute(
    attributes: Record<string, string | string[]>,
    keys: string[]
  ): string | null {
    for (const key of keys) {
      const value = attributes[key];
      if (value) {
        return Array.isArray(value) ? (value[0] ?? null) : value;
      }
    }
    return null;
  }
}
