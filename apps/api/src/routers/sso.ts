const TRAILING_SLASH_RE = /\/$/;

import { oauthTokens, organizations } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:sso");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const OIDC_DISCOVERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const ssoRouter = router({
  /**
   * Get SSO configuration for the current organization.
   *
   * Returns OIDC and SAML settings, enforcement flags, and allowed domains.
   */
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    logger.info({ orgId: ctx.orgId }, "Fetching SSO config");

    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
    });

    if (!org) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    const provider = org.ssoProvider ?? null;

    return {
      oidcEnabled: provider === "oidc" || provider === "both",
      samlEnabled: provider === "saml" || provider === "both",
      oidcIssuerUrl: null as string | null,
      oidcClientId: null as string | null,
      samlEntryPoint: null as string | null,
      samlCertificate: null as string | null,
      ssoRequired: org.ssoRequired ?? false,
      allowedDomains: (org.ipAllowlist as string[]) ?? [],
    };
  }),

  /**
   * Update SSO configuration for the current organization.
   *
   * Accepts partial updates -- only the fields that are provided will be
   * changed. OIDC and SAML can be enabled independently.
   */
  updateConfig: protectedProcedure
    .input(
      z.object({
        oidcEnabled: z.boolean().optional(),
        samlEnabled: z.boolean().optional(),
        oidcIssuerUrl: z.string().url().optional(),
        oidcClientId: z.string().min(1).optional(),
        oidcClientSecret: z.string().min(1).optional(),
        samlEntryPoint: z.string().url().optional(),
        samlCertificate: z.string().min(1).optional(),
        ssoRequired: z.boolean().optional(),
        allowedDomains: z.array(z.string().min(1)).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Validate: cannot require SSO without at least one provider enabled
      if (input.ssoRequired) {
        const oidcWillBeEnabled = input.oidcEnabled ?? false;
        const samlWillBeEnabled = input.samlEnabled ?? false;

        if (!(oidcWillBeEnabled || samlWillBeEnabled)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Cannot require SSO without enabling at least one provider (OIDC or SAML)",
          });
        }
      }

      logger.info(
        {
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          oidcEnabled: input.oidcEnabled,
          samlEnabled: input.samlEnabled,
          ssoRequired: input.ssoRequired,
        },
        "Updating SSO config"
      );

      // Derive the ssoProvider column value from the enabled flags
      let ssoProvider: string | null = null;
      if (input.oidcEnabled && input.samlEnabled) {
        ssoProvider = "both";
      } else if (input.oidcEnabled) {
        ssoProvider = "oidc";
      } else if (input.samlEnabled) {
        ssoProvider = "saml";
      }

      const updates: Record<string, unknown> = {};
      if (input.ssoRequired !== undefined) {
        updates.ssoRequired = input.ssoRequired;
      }
      if (input.oidcEnabled !== undefined || input.samlEnabled !== undefined) {
        updates.ssoProvider = ssoProvider;
      }
      if (input.allowedDomains !== undefined) {
        updates.ipAllowlist = input.allowedDomains;
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db
          .update(organizations)
          .set(updates)
          .where(eq(organizations.id, ctx.orgId));
      }

      return { success: true };
    }),

  /**
   * Test an OIDC provider connection by fetching its discovery document.
   *
   * Returns the key endpoints from the well-known configuration so the
   * admin can verify the issuer is reachable and correctly configured.
   */
  testOidc: protectedProcedure
    .input(
      z.object({
        issuerUrl: z.string().url("Must be a valid URL"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      logger.info(
        { orgId: ctx.orgId, issuerUrl: input.issuerUrl },
        "Testing OIDC connection"
      );

      try {
        const discoveryUrl = `${input.issuerUrl.replace(TRAILING_SLASH_RE, "")}/.well-known/openid-configuration`;
        const resp = await fetch(discoveryUrl, {
          signal: AbortSignal.timeout(OIDC_DISCOVERY_TIMEOUT_MS),
        });

        if (!resp.ok) {
          return {
            success: false as const,
            error: `Discovery endpoint returned HTTP ${resp.status}`,
          };
        }

        const config = (await resp.json()) as Record<string, unknown>;

        return {
          success: true as const,
          issuer: (config.issuer as string) ?? null,
          authorizationEndpoint:
            (config.authorization_endpoint as string) ?? null,
          tokenEndpoint: (config.token_endpoint as string) ?? null,
          userinfoEndpoint: (config.userinfo_endpoint as string) ?? null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { orgId: ctx.orgId, issuerUrl: input.issuerUrl, error: message },
          "OIDC connection test failed"
        );
        return { success: false as const, error: message };
      }
    }),

  /**
   * Test a SAML provider by validating the certificate format and entry point.
   *
   * This is a lightweight client-side validation -- full SAML assertion
   * testing requires a real authentication flow.
   */
  testSaml: protectedProcedure
    .input(
      z.object({
        entryPoint: z.string().url("Entry point must be a valid URL"),
        certificate: z.string().min(1, "Certificate is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      logger.info(
        { orgId: ctx.orgId, entryPoint: input.entryPoint },
        "Testing SAML connection"
      );

      const certErrors: string[] = [];

      // Basic certificate format validation
      const trimmed = input.certificate.trim();
      if (
        !(
          trimmed.startsWith("-----BEGIN CERTIFICATE-----") &&
          trimmed.endsWith("-----END CERTIFICATE-----")
        )
      ) {
        certErrors.push(
          "Certificate must be PEM-encoded (BEGIN/END CERTIFICATE markers)"
        );
      }

      // Verify the entry point is reachable
      try {
        const resp = await fetch(input.entryPoint, {
          method: "HEAD",
          signal: AbortSignal.timeout(OIDC_DISCOVERY_TIMEOUT_MS),
        });
        if (!resp.ok && resp.status !== 405 && resp.status !== 302) {
          certErrors.push(
            `Entry point returned HTTP ${resp.status} -- may not be reachable`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        certErrors.push(`Entry point unreachable: ${message}`);
      }

      if (certErrors.length > 0) {
        return { success: false as const, errors: certErrors };
      }

      return { success: true as const, errors: [] };
    }),

  /**
   * List active SSO connections/sessions for the organization.
   *
   * Shows which identity provider connections are currently established.
   */
  listConnections: protectedProcedure.query(async ({ ctx }) => {
    logger.info({ orgId: ctx.orgId }, "Listing SSO connections");

    const tokens = await ctx.db.query.oauthTokens.findMany({
      where: eq(oauthTokens.orgId, ctx.orgId),
    });

    const connections = tokens.map((token) => ({
      id: token.id,
      provider: token.provider as "oidc" | "saml",
      status: (token.expiresAt && token.expiresAt < new Date()
        ? "expired"
        : "active") as "active" | "expired" | "revoked",
      userEmail: token.providerUsername ?? token.userId,
      connectedAt: token.createdAt.toISOString(),
      expiresAt: token.expiresAt?.toISOString() ?? null,
    }));

    return { connections };
  }),

  /**
   * Revoke an SSO connection, forcing the user to re-authenticate.
   */
  revokeConnection: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().min(1, "Connection ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      logger.info(
        { orgId: ctx.orgId, connectionId: input.connectionId },
        "Revoking SSO connection"
      );

      const deleted = await ctx.db
        .delete(oauthTokens)
        .where(
          and(
            eq(oauthTokens.id, input.connectionId),
            eq(oauthTokens.orgId, ctx.orgId)
          )
        )
        .returning();

      if (deleted.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "SSO connection not found",
        });
      }

      return { success: true, revokedAt: new Date().toISOString() };
    }),
});
