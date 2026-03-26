import { createLogger } from "@prometheus/logger";
import { z } from "zod";

const logger = createLogger("enterprise-config");

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const licenseTierSchema = z.enum(["community", "team", "enterprise"]);

const licenseSchema = z.object({
  key: z.string().min(1, "License key is required"),
  tier: licenseTierSchema,
  seats: z.number().int().positive("Seats must be a positive integer"),
  expiresAt: z.coerce.date(),
  features: z.array(z.string()),
});

const ssoProviderSchema = z.enum(["saml", "oidc"]);

const ssoSchema = z.object({
  enabled: z.boolean().default(false),
  provider: ssoProviderSchema,
  issuer: z.string().url("SSO issuer must be a valid URL"),
  certificate: z.string().min(1, "SSO certificate is required"),
  callbackUrl: z.string().url("SSO callback must be a valid URL"),
});

const auditExportFormatSchema = z.enum(["json", "csv", "siem"]);

const auditSchema = z.object({
  enabled: z.boolean().default(true),
  retentionDays: z.number().int().min(1).max(3650).default(365),
  exportFormat: auditExportFormatSchema.default("json"),
  webhookUrl: z.string().url().optional(),
});

const securitySchema = z.object({
  ipAllowlist: z.array(z.string()).default([]),
  mfaRequired: z.boolean().default(false),
  sessionTimeout: z.number().int().min(300).max(86_400).default(3600),
  dataEncryptionKey: z
    .string()
    .min(32, "Encryption key must be at least 32 characters"),
});

const customizationSchema = z.object({
  logo: z.string().default(""),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Primary color must be a hex color")
    .default("#6366f1"),
  appName: z.string().default("Prometheus"),
  domain: z.string().default(""),
});

export const enterpriseConfigSchema = z.object({
  license: licenseSchema,
  sso: ssoSchema,
  audit: auditSchema,
  security: securitySchema,
  customization: customizationSchema,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LicenseTier = z.infer<typeof licenseTierSchema>;
export type SSOProvider = z.infer<typeof ssoProviderSchema>;
export type AuditExportFormat = z.infer<typeof auditExportFormatSchema>;
export type EnterpriseConfig = z.infer<typeof enterpriseConfigSchema>;

// ---------------------------------------------------------------------------
// Feature flags per tier
// ---------------------------------------------------------------------------

const TIER_FEATURES: Record<LicenseTier, Set<string>> = {
  community: new Set(["basic_agents", "public_projects", "community_support"]),
  team: new Set([
    "basic_agents",
    "public_projects",
    "community_support",
    "private_projects",
    "team_collaboration",
    "api_keys",
    "webhooks",
    "priority_support",
    "custom_models",
  ]),
  enterprise: new Set([
    "basic_agents",
    "public_projects",
    "community_support",
    "private_projects",
    "team_collaboration",
    "api_keys",
    "webhooks",
    "priority_support",
    "custom_models",
    "sso_saml",
    "sso_oidc",
    "audit_logs",
    "ip_allowlist",
    "mfa_enforcement",
    "data_encryption",
    "custom_branding",
    "sla_guarantee",
    "dedicated_support",
    "air_gapped_deployment",
    "compliance_reports",
  ]),
};

// ---------------------------------------------------------------------------
// Enterprise Config Manager
// ---------------------------------------------------------------------------

export class EnterpriseConfigManager {
  private config: EnterpriseConfig | null = null;

  /**
   * Load and validate enterprise configuration from environment or file.
   */
  load(rawConfig: unknown): EnterpriseConfig {
    const parsed = enterpriseConfigSchema.parse(rawConfig);
    this.config = parsed;

    logger.info(
      {
        tier: parsed.license.tier,
        seats: parsed.license.seats,
        ssoEnabled: parsed.sso.enabled,
        auditEnabled: parsed.audit.enabled,
        features: parsed.license.features.length,
      },
      "Enterprise configuration loaded"
    );

    return parsed;
  }

  /**
   * Get the current enterprise configuration.
   */
  get(): EnterpriseConfig | null {
    return this.config;
  }

  /**
   * Check if a feature is available in the current license tier.
   */
  hasFeature(feature: string): boolean {
    if (!this.config) {
      return false;
    }
    const tierFeatures = TIER_FEATURES[this.config.license.tier];
    return (
      tierFeatures.has(feature) ||
      this.config.license.features.includes(feature)
    );
  }

  /**
   * Check if the license is still valid (not expired).
   */
  isLicenseValid(): boolean {
    if (!this.config) {
      return false;
    }
    return new Date() < this.config.license.expiresAt;
  }

  /**
   * Check if SSO is enabled and properly configured.
   */
  isSSOEnabled(): boolean {
    if (!this.config) {
      return false;
    }
    return (
      this.config.sso.enabled &&
      this.hasFeature(`sso_${this.config.sso.provider}`)
    );
  }

  /**
   * Check if an IP address is in the allowlist.
   * Returns true if the allowlist is empty (no restrictions).
   */
  isIPAllowed(ip: string): boolean {
    if (!this.config) {
      return true;
    }
    const { ipAllowlist } = this.config.security;
    if (ipAllowlist.length === 0) {
      return true;
    }

    return ipAllowlist.some((allowed) => {
      // Support CIDR notation
      if (allowed.includes("/")) {
        return matchCIDR(ip, allowed);
      }
      return ip === allowed;
    });
  }

  /**
   * Get the remaining seat count.
   */
  remainingSeats(currentUsers: number): number {
    if (!this.config) {
      return 0;
    }
    return Math.max(0, this.config.license.seats - currentUsers);
  }

  /**
   * Get days until license expiration.
   */
  daysUntilExpiry(): number {
    if (!this.config) {
      return 0;
    }
    const diff = this.config.license.expiresAt.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  }

  /**
   * Get customization settings for the UI.
   */
  getCustomization(): EnterpriseConfig["customization"] | null {
    if (!this.config) {
      return null;
    }
    return this.config.customization;
  }

  /**
   * Get the audit configuration.
   */
  getAuditConfig(): EnterpriseConfig["audit"] | null {
    if (!this.config) {
      return null;
    }
    return this.config.audit;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple CIDR matching for IP allowlist checks.
 */
function matchCIDR(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split("/");
  if (!(range && bits)) {
    return false;
  }

  const mask = Number.parseInt(bits, 10);
  if (Number.isNaN(mask) || mask < 0 || mask > 32) {
    return false;
  }

  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);
  if (ipNum === null || rangeNum === null) {
    return false;
  }

  const maskBits = (-1 << (32 - mask)) >>> 0;
  return (ipNum & maskBits) === (rangeNum & maskBits);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let num = 0;
  for (const part of parts) {
    const octet = Number.parseInt(part, 10);
    if (Number.isNaN(octet) || octet < 0 || octet > 255) {
      return null;
    }
    num = (num << 8) + octet;
  }
  return num >>> 0;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const enterpriseConfig = new EnterpriseConfigManager();
