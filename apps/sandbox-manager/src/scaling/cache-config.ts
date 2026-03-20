/**
 * Edge Caching Configuration.
 *
 * Provides CDN and caching policy configuration for static assets,
 * model artifacts, and API responses across the Prometheus platform.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:cache-config");

/** Cache control header configuration */
export interface CachePolicy {
  /** Browser TTL in seconds */
  browserTtlSeconds: number;
  /** Cache-Control header value */
  cacheControl: string;
  /** CDN TTL in seconds */
  cdnTtlSeconds: number;
  /** Whether to use stale-while-revalidate */
  staleWhileRevalidate: boolean;
  /** Stale-while-revalidate window in seconds */
  staleWindowSeconds: number;
  /** Vary header values */
  vary: string[];
}

/** Per-endpoint API cache configuration */
export interface APICachePolicy extends CachePolicy {
  endpoint: string;
  /** Whether the response varies by auth */
  varyByAuth: boolean;
  /** Whether the response varies by org */
  varyByOrg: boolean;
}

export class CacheConfiguration {
  /**
   * Get cache headers for static assets (JS, CSS, images, fonts).
   * These are immutable with content hashing, so they can be cached aggressively.
   */
  getStaticAssetConfig(): CachePolicy {
    const config: CachePolicy = {
      cacheControl: "public, max-age=31536000, immutable",
      cdnTtlSeconds: 31_536_000, // 1 year
      browserTtlSeconds: 31_536_000,
      staleWhileRevalidate: false,
      staleWindowSeconds: 0,
      vary: ["Accept-Encoding"],
    };

    logger.debug({ config }, "Static asset cache config");
    return config;
  }

  /**
   * Get cache configuration for model artifacts (weights, embeddings).
   * These are large, rarely change, but need versioned invalidation.
   */
  getModelArtifactConfig(): CachePolicy {
    const config: CachePolicy = {
      cacheControl: "public, max-age=86400, stale-while-revalidate=3600",
      cdnTtlSeconds: 86_400, // 24 hours
      browserTtlSeconds: 3600, // 1 hour browser cache
      staleWhileRevalidate: true,
      staleWindowSeconds: 3600,
      vary: ["Accept-Encoding", "Accept"],
    };

    logger.debug({ config }, "Model artifact cache config");
    return config;
  }

  /**
   * Get per-endpoint cache policy for API responses.
   * Returns appropriate caching rules based on the endpoint pattern.
   */
  getAPIResponseConfig(endpoint: string): APICachePolicy {
    // Health/status endpoints: short cache, public
    if (endpoint.startsWith("/health") || endpoint.startsWith("/ready")) {
      return {
        endpoint,
        cacheControl: "public, max-age=5, stale-while-revalidate=10",
        cdnTtlSeconds: 5,
        browserTtlSeconds: 5,
        staleWhileRevalidate: true,
        staleWindowSeconds: 10,
        vary: [],
        varyByAuth: false,
        varyByOrg: false,
      };
    }

    // Public API docs: medium cache
    if (endpoint.startsWith("/docs") || endpoint.startsWith("/openapi")) {
      return {
        endpoint,
        cacheControl: "public, max-age=3600, stale-while-revalidate=600",
        cdnTtlSeconds: 3600,
        browserTtlSeconds: 3600,
        staleWhileRevalidate: true,
        staleWindowSeconds: 600,
        vary: ["Accept"],
        varyByAuth: false,
        varyByOrg: false,
      };
    }

    // Model listing/metadata: short cache, varies by org
    if (endpoint.startsWith("/models") || endpoint.startsWith("/api/models")) {
      return {
        endpoint,
        cacheControl: "private, max-age=60, stale-while-revalidate=30",
        cdnTtlSeconds: 60,
        browserTtlSeconds: 60,
        staleWhileRevalidate: true,
        staleWindowSeconds: 30,
        vary: ["Authorization", "Accept"],
        varyByAuth: true,
        varyByOrg: true,
      };
    }

    // User-specific data: private, no CDN cache
    if (
      endpoint.startsWith("/api/user") ||
      endpoint.startsWith("/api/sessions")
    ) {
      return {
        endpoint,
        cacheControl: "private, no-cache",
        cdnTtlSeconds: 0,
        browserTtlSeconds: 0,
        staleWhileRevalidate: false,
        staleWindowSeconds: 0,
        vary: ["Authorization"],
        varyByAuth: true,
        varyByOrg: true,
      };
    }

    // Default: private with short cache
    return {
      endpoint,
      cacheControl: "private, max-age=30, stale-while-revalidate=15",
      cdnTtlSeconds: 30,
      browserTtlSeconds: 30,
      staleWhileRevalidate: true,
      staleWindowSeconds: 15,
      vary: ["Authorization", "Accept"],
      varyByAuth: true,
      varyByOrg: false,
    };
  }

  /**
   * Build a complete Cache-Control header string from a policy.
   */
  buildCacheControlHeader(policy: CachePolicy): string {
    let header = policy.cacheControl;
    if (
      policy.staleWhileRevalidate &&
      policy.staleWindowSeconds > 0 &&
      !header.includes("stale-while-revalidate")
    ) {
      header += `, stale-while-revalidate=${policy.staleWindowSeconds}`;
    }
    return header;
  }
}
